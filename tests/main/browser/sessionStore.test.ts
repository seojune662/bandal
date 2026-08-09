import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Cookie, Event as ElectronEvent } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  LEGACY_BROWSER_SESSION_FILE_NAME,
  cookieUrl,
  createBrowserSessionStore
} from '../../../src/main/features/browser/sessionStore'
import type {
  BrowserSessionAppLike,
  BrowserSessionLike
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
    value: 'secret',
    domain: '.example.edu',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    sameSite: 'lax',
    session: false,
    expirationDate: 2_000_000_000,
    ...overrides
  }
}

interface FakeSession {
  session: BrowserSessionLike
  removeCalls: { url: string; name: string }[]
  flushStorageData: ReturnType<typeof vi.fn<() => void>>
  flushStore: ReturnType<typeof vi.fn<() => Promise<void>>>
  current(): Cookie[]
}

function fakeSession(initial: Cookie[]): FakeSession {
  let currentCookies = [...initial]
  const removeCalls: { url: string; name: string }[] = []
  const flushStorageData = vi.fn<() => void>()
  const flushStore = vi.fn(async () => undefined)

  return {
    session: {
      flushStorageData,
      cookies: {
        async get() {
          return [...currentCookies]
        },
        async remove(url, name) {
          removeCalls.push({ url, name })
          currentCookies = currentCookies.filter(
            (item) => item.name !== name || cookieUrl(item) !== url
          )
        },
        flushStore
      }
    },
    removeCalls,
    flushStorageData,
    flushStore,
    current: () => [...currentCookies]
  }
}

function fakeApp(): BrowserSessionAppLike & {
  beforeQuit(): ((event: ElectronEvent) => void) | undefined
  quit: ReturnType<typeof vi.fn<() => void>>
} {
  let listener: ((event: ElectronEvent) => void) | undefined
  const quit = vi.fn<() => void>()
  return {
    beforeQuit: () => listener,
    quit,
    on(_event, next) {
      listener = next
    },
    removeListener(_event, current) {
      if (listener === current) listener = undefined
    }
  }
}

describe('cookieUrl', () => {
  test('reconstructs scheme, dotted domain, path, and IPv6 hosts', () => {
    expect(
      cookieUrl({ domain: '.etl.snu.ac.kr', secure: true, path: '/login/sso' })
    ).toBe('https://etl.snu.ac.kr/login/sso')
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

describe('native persistent cookie storage', () => {
  test('flushes Chromium cookies and site storage before allowing a graceful quit', async () => {
    const fake = fakeSession([])
    const app = fakeApp()
    const store = createBrowserSessionStore({ session: fake.session, app })
    store.startFlushOnQuit()
    store.startFlushOnQuit()

    const preventDefault = vi.fn()
    app.beforeQuit()?.({ preventDefault } as unknown as ElectronEvent)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    expect(fake.flushStorageData).toHaveBeenCalledOnce()
    expect(fake.flushStore).toHaveBeenCalledOnce()

    // The second quit is the continuation after flushing and is not blocked.
    app.beforeQuit()?.({ preventDefault } as unknown as ElectronEvent)
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  test('logs a flush failure but still lets the app finish quitting', async () => {
    const fake = fakeSession([])
    fake.flushStore.mockRejectedValueOnce(new Error('disk unavailable'))
    const app = fakeApp()
    const logger = { warn: vi.fn() }
    const store = createBrowserSessionStore({
      session: fake.session,
      app,
      logger
    })
    store.startFlushOnQuit()

    app.beforeQuit()?.({ preventDefault: vi.fn() } as unknown as ElectronEvent)

    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    expect(logger.warn).toHaveBeenCalledWith(
      '[browser-session] Persistent cookies could not be flushed'
    )
  })

  test('removes the deprecated snapshot instead of restoring session cookies', () => {
    const userDataPath = temporaryUserData()
    const snapshotPath = join(
      userDataPath,
      LEGACY_BROWSER_SESSION_FILE_NAME
    )
    writeFileSync(snapshotPath, 'legacy encrypted cookie data')

    createBrowserSessionStore({
      session: fakeSession([]).session,
      userDataPath
    })

    expect(existsSync(snapshotPath)).toBe(false)
  })
})

describe('site listing and clearing', () => {
  test('groups by origin and clears only the requested origin before flushing', async () => {
    const fake = fakeSession([
      cookie({ name: 'a-root', domain: '.a.edu' }),
      cookie({ name: 'a-path', domain: '.a.edu', path: '/course' }),
      cookie({ name: 'b', domain: 'b.edu', secure: false, hostOnly: true })
    ])
    const store = createBrowserSessionStore({ session: fake.session })

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
    expect(fake.flushStore).toHaveBeenCalledOnce()
  })

  test('clears all cookie types without changing their expiration', async () => {
    const fake = fakeSession([
      cookie(),
      cookie({ name: 'session-only', session: true, expirationDate: undefined })
    ])
    const store = createBrowserSessionStore({ session: fake.session })

    await store.clear(null)

    expect(fake.current()).toEqual([])
    expect(fake.flushStore).toHaveBeenCalledOnce()
  })
})
