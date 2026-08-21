import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CREDENTIALS_FILE_NAME,
  createCredentialStore,
  normalizeCredentialOrigin
} from '../../../src/main/features/credentials'
import type { CredentialSafeStorage } from '../../../src/main/features/credentials'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-credentials-'))
  temporaryDirectories.push(directory)
  return directory
}

function xor(input: Buffer): Buffer {
  return Buffer.from(input.map((byte) => byte ^ 0xa7))
}

function fakeSafeStorage(available = true): CredentialSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => xor(Buffer.from(plainText, 'utf8')),
    decryptString: (encrypted) => xor(encrypted).toString('utf8')
  }
}

function countingSafeStorage(): CredentialSafeStorage & { touches(): number } {
  let touches = 0
  const inner = fakeSafeStorage()
  return {
    touches: () => touches,
    isEncryptionAvailable: () => {
      touches += 1
      return inner.isEncryptionAvailable()
    },
    encryptString: (value) => {
      touches += 1
      return inner.encryptString(value)
    },
    decryptString: (value) => {
      touches += 1
      return inner.decryptString(value)
    }
  }
}

function credentialPath(userDataPath: string): string {
  return join(userDataPath, CREDENTIALS_FILE_NAME)
}

describe('credential encryption boundary', () => {
  test('reports unavailable, rejects saving, and creates no plaintext fallback', () => {
    const userDataPath = temporaryUserData()
    const store = createCredentialStore({
      userDataPath,
      safeStorage: fakeSafeStorage(false)
    })

    expect(store.availability()).toEqual({
      state: 'unavailable',
      reason: expect.any(String)
    })
    expect(() => store.save({
      origin: 'https://portal.example.edu/login',
      username: 'student',
      password: 'do-not-write-me'
    })).toThrow(/encryption/i)
    expect(existsSync(credentialPath(userDataPath))).toBe(false)
    expect(existsSync(`${credentialPath(userDataPath)}.tmp`)).toBe(false)
  })

  test('does not touch the keychain when no encrypted file exists', () => {
    const userDataPath = temporaryUserData()
    const safeStorage = countingSafeStorage()
    const store = createCredentialStore({ userDataPath, safeStorage })

    expect(store.list()).toEqual([])
    expect(store.resolve('https://portal.example.edu')).toBeNull()
    expect(store.forget('https://portal.example.edu')).toEqual({ ok: true })
    expect(safeStorage.touches()).toBe(0)
  })

  test('writes only an encrypted 0600 envelope and defaults auto-submit off', () => {
    const userDataPath = temporaryUserData()
    const safeStorage = fakeSafeStorage()
    const store = createCredentialStore({
      userDataPath,
      safeStorage,
      now: () => Date.parse('2026-08-09T01:02:03.000Z')
    })

    const saved = store.save({
      origin: 'https://PORTAL.example.edu:443/login?next=%2F#form',
      username: 'student-number',
      password: 'private-password'
    })

    expect(saved).toEqual({
      origin: 'https://portal.example.edu',
      username: 'student-number',
      autoSubmit: false,
      updatedAt: '2026-08-09T01:02:03.000Z'
    })
    const raw = readFileSync(credentialPath(userDataPath))
    expect(raw.toString('utf8')).not.toContain('student-number')
    expect(raw.toString('utf8')).not.toContain('private-password')
    expect(statSync(credentialPath(userDataPath)).mode & 0o777).toBe(0o600)
  })
})

describe('credential parsing and summaries', () => {
  test('quarantines a one-time decryption failure and recovers on the next save', () => {
    const userDataPath = temporaryUserData()
    const path = credentialPath(userDataPath)
    const encryptedBytes = Buffer.from('corrupt encrypted bytes')
    writeFileSync(path, encryptedBytes)
    const timestamp = '2026-08-22T03:04:05.000Z'
    writeFileSync(`${path}.corrupt-${timestamp}`, Buffer.from('older quarantine'))
    let decryptions = 0
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createCredentialStore({
      userDataPath,
      now: () => Date.parse(timestamp),
      safeStorage: {
        ...fakeSafeStorage(),
        decryptString: (encrypted) => {
          decryptions += 1
          if (decryptions === 1) {
            throw new Error('temporary keychain failure with secret detail')
          }
          return fakeSafeStorage().decryptString(encrypted)
        }
      }
    })

    const availability = store.availability()
    expect(() => store.list()).not.toThrow()
    expect(store.list()).toEqual([])
    expect(existsSync(path)).toBe(false)
    const quarantinedName = `${CREDENTIALS_FILE_NAME}.corrupt-${timestamp}-1`
    const quarantinedPath = join(userDataPath, quarantinedName)
    expect(readdirSync(userDataPath)).toContain(quarantinedName)
    expect(readFileSync(quarantinedPath)).toEqual(encryptedBytes)
    expect(availability).toEqual({
      state: 'unavailable',
      reason: `저장된 데이터를 읽지 못해 격리했습니다: ${quarantinedName}`
    })
    expect(warning).toHaveBeenCalledWith(
      `[credentials] 복호화 실패 — 격리: ${quarantinedPath}`
    )
    expect(warning.mock.calls.flat().join(' ')).not.toContain('secret detail')

    store.save({
      origin: 'https://portal.example.edu',
      username: 'student',
      password: 'new-secret'
    })

    expect(existsSync(path)).toBe(true)
    expect(store.list()).toHaveLength(1)
    expect(store.availability()).toEqual({ state: 'ready' })
  })

  test('list returns summaries without a password field', () => {
    const store = createCredentialStore({
      userDataPath: temporaryUserData(),
      safeStorage: fakeSafeStorage()
    })
    store.save({
      origin: 'https://portal.example.edu',
      username: 'student',
      password: 'secret'
    })

    const listed = store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('password')
    expect(Object.keys(listed[0] ?? {})).toEqual([
      'origin',
      'username',
      'autoSubmit',
      'updatedAt'
    ])
  })

  test('metadata-only save keeps the main-only password and changes auto-submit', () => {
    const store = createCredentialStore({
      userDataPath: temporaryUserData(),
      safeStorage: fakeSafeStorage()
    })
    store.save({
      origin: 'https://portal.example.edu',
      username: 'student',
      password: 'secret'
    })

    const updated = store.save({
      origin: 'https://portal.example.edu/path-is-ignored',
      username: 'student',
      password: '',
      autoSubmit: true
    })

    expect(updated.autoSubmit).toBe(true)
    expect(store.resolve('https://portal.example.edu')).toEqual({
      username: 'student',
      password: 'secret',
      autoSubmit: true
    })
  })

  test('normalizes to scheme and host while preserving a non-default port', () => {
    expect(normalizeCredentialOrigin('https://EXAMPLE.edu:8443/a?b#c')).toBe(
      'https://example.edu:8443'
    )
    expect(() => normalizeCredentialOrigin('http://example.edu')).toThrow()
  })
})
