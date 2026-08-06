import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Cookie, CookiesSetDetails } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  BROWSER_SESSION_FILE_NAME,
  RESTORED_COOKIE_TTL_SECONDS,
  cookieUrl,
  createBrowserSessionStore,
  isSessionCookie
} from '../../../src/main/features/browser/sessionStore'
import type {
  BrowserSessionLike,
  SafeStorageLike
} from '../../../src/main/features/browser/sessionStore'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-browser-session-'))
  temporaryDirectories.push(directory)
  return directory
}

function cookie(overrides: Partial<Cookie> = {}): Cookie {
  return {
    name: 'sid',
    value: 'session-secret',
    domain: '.example.edu',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    sameSite: 'lax',
    session: true,
    ...overrides
  }
}

function xorBuffer(input: Buffer): Buffer {
  return Buffer.from(input.map((byte) => byte ^ 0xa5))
}

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => xorBuffer(Buffer.from(plainText, 'utf8')),
    decryptString: (encrypted) => xorBuffer(encrypted).toString('utf8')
  }
}

interface FakeSession {
  session: BrowserSessionLike
  setCalls: CookiesSetDetails[]
  removeCalls: { url: string; name: string }[]
  flushCount(): number
  current(): Cookie[]
}

function fakeSession(initial: Cookie[]): FakeSession {
  let currentCookies = [...initial]
  const setCalls: CookiesSetDetails[] = []
  const removeCalls: { url: string; name: string }[] = []
  let flushes = 0

  return {
    session: {
      cookies: {
        async get() {
          return [...currentCookies]
        },
        async set(details) {
          setCalls.push(details)
        },
        async remove(url, name) {
          removeCalls.push({ url, name })
          currentCookies = currentCookies.filter(
            (item) => item.name !== name || cookieUrl(item) !== url
          )
        },
        async flushStore() {
          flushes += 1
        }
      }
    },
    setCalls,
    removeCalls,
    flushCount: () => flushes,
    current: () => [...currentCookies]
  }
}

function snapshotPath(userDataPath: string): string {
  return join(userDataPath, BROWSER_SESSION_FILE_NAME)
}

function decryptedSnapshot(
  userDataPath: string,
  safeStorage: SafeStorageLike
): Record<string, unknown> {
  return JSON.parse(
    safeStorage.decryptString(readFileSync(snapshotPath(userDataPath)))
  ) as Record<string, unknown>
}

describe('session cookie selection and encrypted persistence', () => {
  test('selects only cookies without expirationDate and leaves persistent cookies alone', async () => {
    const userDataPath = temporaryUserData()
    const safeStorage = fakeSafeStorage()
    const fake = fakeSession([
      cookie(),
      cookie({
        name: 'remembered',
        value: 'persistent-secret',
        expirationDate: 2_000_000_000,
        session: false
      }),
      cookie({
        name: 'expiry-wins',
        expirationDate: 2_000_000_001,
        session: true
      })
    ])
    const store = createBrowserSessionStore({
      session: fake.session,
      safeStorage,
      userDataPath,
      now: () => 1_700_000_000_000
    })

    await store.persist()

    const encrypted = readFileSync(snapshotPath(userDataPath))
    expect(encrypted.toString('utf8')).not.toContain('session-secret')
    expect(encrypted.toString('utf8')).not.toContain('persistent-secret')
    const snapshot = decryptedSnapshot(userDataPath, safeStorage)
    expect(snapshot['format']).toBe('bandal-browser-session-cookies')
    expect(snapshot['version']).toBe(1)
    expect(snapshot['cookies']).toEqual([
      expect.objectContaining({ name: 'sid', value: 'session-secret' })
    ])
    expect(statSync(snapshotPath(userDataPath)).mode & 0o777).toBe(0o600)
    expect(fake.setCalls).toHaveLength(0)
    expect(fake.removeCalls).toHaveLength(0)
  })

  test('uses missing expirationDate rather than the advisory session flag', () => {
    expect(isSessionCookie(cookie({ session: false }))).toBe(true)
    expect(
      isSessionCookie(cookie({ session: true, expirationDate: 2_000_000_000 }))
    ).toBe(false)
  })

  test('does not create a plaintext fallback when safeStorage is unavailable', async () => {
    const userDataPath = temporaryUserData()
    const warnings = { warn: vi.fn() }
    const store = createBrowserSessionStore({
      session: fakeSession([cookie()]).session,
      safeStorage: fakeSafeStorage(false),
      userDataPath,
      logger: warnings
    })

    await store.persist()

    expect(existsSync(snapshotPath(userDataPath))).toBe(false)
    expect(warnings.warn).toHaveBeenCalledOnce()
  })
})

describe('cookieUrl', () => {
  test('reconstructs scheme, dotted domain, and path', () => {
    expect(
      cookieUrl({ domain: '.etl.snu.ac.kr', secure: true, path: '/login/sso' })
    ).toBe('https://etl.snu.ac.kr/login/sso')
    expect(
      cookieUrl({ domain: 'portal.example.edu', secure: false, path: '/' })
    ).toBe('http://portal.example.edu/')
  })

  test('normalizes a missing/invalid path and supports IPv6 hosts', () => {
    expect(cookieUrl({ domain: 'localhost', secure: false })).toBe(
      'http://localhost/'
    )
    expect(cookieUrl({ domain: '::1', secure: false, path: '/auth' })).toBe(
      'http://[::1]/auth'
    )
  })

  test('rejects an empty domain or URL punctuation masquerading as a domain', () => {
    expect(() => cookieUrl({ domain: '.', secure: true, path: '/' })).toThrow()
    expect(() =>
      cookieUrl({ domain: 'example.edu@evil.test', secure: true, path: '/' })
    ).toThrow()
  })
})

describe('restoration', () => {
  test('restores host-only/domain cookies with SameSite and a 30-day expiry', async () => {
    const userDataPath = temporaryUserData()
    const safeStorage = fakeSafeStorage()
    const source = fakeSession([
      cookie({
        name: 'host',
        domain: 'portal.example.edu',
        path: '/sso',
        hostOnly: true,
        sameSite: 'strict'
      }),
      cookie({
        name: 'domain',
        domain: '.example.edu',
        hostOnly: false,
        sameSite: 'no_restriction'
      })
    ])
    await createBrowserSessionStore({
      session: source.session,
      safeStorage,
      userDataPath
    }).persist()

    const target = fakeSession([])
    const now = 1_700_000_000_000
    const store = createBrowserSessionStore({
      session: target.session,
      safeStorage,
      userDataPath,
      now: () => now
    })

    await expect(store.restore()).resolves.toBeUndefined()

    expect(target.setCalls).toHaveLength(2)
    expect(target.setCalls[0]).toEqual({
      url: 'https://portal.example.edu/sso',
      name: 'host',
      value: 'session-secret',
      path: '/sso',
      secure: true,
      httpOnly: true,
      expirationDate: now / 1_000 + RESTORED_COOKIE_TTL_SECONDS,
      sameSite: 'strict'
    })
    expect(target.setCalls[1]).toEqual(
      expect.objectContaining({
        url: 'https://example.edu/',
        domain: 'example.edu',
        sameSite: 'no_restriction'
      })
    )
    expect(target.flushCount()).toBe(1)
    expect(existsSync(snapshotPath(userDataPath))).toBe(false)
  })

  test.each([
    ['decryption failure', Buffer.from('not-valid-ciphertext'), true],
    ['damaged JSON', null, false]
  ])('does not throw on %s and discards the file', async (_label, bytes, failDecrypt) => {
    const userDataPath = temporaryUserData()
    const baseStorage = fakeSafeStorage()
    const safeStorage: SafeStorageLike = failDecrypt
      ? {
          ...baseStorage,
          decryptString() {
            throw new Error('keychain failure')
          }
        }
      : baseStorage
    const contents = bytes ?? baseStorage.encryptString('{"broken":')
    writeFileSync(snapshotPath(userDataPath), contents, { mode: 0o600 })
    const warnings = { warn: vi.fn() }
    const store = createBrowserSessionStore({
      session: fakeSession([]).session,
      safeStorage,
      userDataPath,
      logger: warnings
    })

    await expect(store.restore()).resolves.toBeUndefined()

    expect(existsSync(snapshotPath(userDataPath))).toBe(false)
    expect(warnings.warn).toHaveBeenCalled()
  })
})

describe('site listing and clearing', () => {
  test('groups by origin and clears only the requested origin before refreshing the snapshot', async () => {
    const userDataPath = temporaryUserData()
    const safeStorage = fakeSafeStorage()
    const fake = fakeSession([
      cookie({ name: 'a-root', domain: '.a.edu' }),
      cookie({
        name: 'a-path',
        domain: '.a.edu',
        path: '/course',
        expirationDate: 2_000_000_000,
        session: false
      }),
      cookie({ name: 'b', domain: 'b.edu', secure: false, hostOnly: true })
    ])
    const store = createBrowserSessionStore({
      session: fake.session,
      safeStorage,
      userDataPath
    })

    await expect(store.listSites()).resolves.toEqual([
      { origin: 'http://b.edu', cookieCount: 1 },
      { origin: 'https://a.edu', cookieCount: 2 }
    ])

    await expect(store.clear('https://a.edu/settings')).resolves.toEqual({ ok: true })
    expect(fake.removeCalls).toEqual([
      { url: 'https://a.edu/', name: 'a-root' },
      { url: 'https://a.edu/course', name: 'a-path' }
    ])
    expect(fake.current().map((item) => item.name)).toEqual(['b'])
    expect(decryptedSnapshot(userDataPath, safeStorage)['cookies']).toEqual([
      expect.objectContaining({ name: 'b' })
    ])

    await expect(store.clear(null)).resolves.toEqual({ ok: true })
    expect(fake.current()).toEqual([])
    expect(decryptedSnapshot(userDataPath, safeStorage)['cookies']).toEqual([])
  })
})
