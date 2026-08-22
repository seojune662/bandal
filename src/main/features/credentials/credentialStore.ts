import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { basename, join } from 'node:path'
import type {
  CredentialsAvailability,
  SaveLoginInput,
  SavedLoginSummary
} from '../../../shared/types/credentials'
import { quarantineFile, writeFileAtomic } from '../../lib/atomicWrite'

export const CREDENTIALS_FILE_NAME = 'saved-logins.enc'

const ENVELOPE_FORMAT = 'bandal-saved-logins'
const ENVELOPE_VERSION = 1
const ENCRYPTION_UNAVAILABLE_REASON =
  'OS-backed encryption is unavailable; saved logins are disabled.'

export interface CredentialSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface CredentialStoreDeps {
  safeStorage: CredentialSafeStorage
  userDataPath: string
  now?: () => number
}

export interface ResolvedLogin {
  username: string
  password: string
  autoSubmit: boolean
}

export interface CredentialStore {
  availability(): CredentialsAvailability
  list(): SavedLoginSummary[]
  save(input: SaveLoginInput): SavedLoginSummary
  forget(origin: string): { ok: true }
  /** Main-process internal only. Never expose this method through IPC. */
  resolve(origin: string): ResolvedLogin | null
}

interface StoredLogin extends ResolvedLogin {
  origin: string
  updatedAt: string
}

interface CredentialEnvelope {
  format: typeof ENVELOPE_FORMAT
  version: typeof ENVELOPE_VERSION
  logins: StoredLogin[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Canonical https scheme + host (+ non-default port), with no URL tail. */
export function normalizeCredentialOrigin(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') {
    throw new TypeError('Saved login origin must use HTTPS')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('Saved login origin must not contain URL credentials')
  }
  return parsed.origin
}

function parseLogin(value: unknown): StoredLogin {
  if (!isRecord(value)) throw new TypeError('Invalid saved login entry')
  if (
    typeof value['origin'] !== 'string' ||
    typeof value['username'] !== 'string' ||
    typeof value['password'] !== 'string' ||
    typeof value['autoSubmit'] !== 'boolean' ||
    typeof value['updatedAt'] !== 'string'
  ) {
    throw new TypeError('Invalid saved login entry')
  }

  const origin = normalizeCredentialOrigin(value['origin'])
  if (origin !== value['origin']) {
    throw new TypeError('Saved login origin is not canonical')
  }
  if (!Number.isFinite(Date.parse(value['updatedAt']))) {
    throw new TypeError('Invalid saved login timestamp')
  }
  return {
    origin,
    username: value['username'],
    password: value['password'],
    autoSubmit: value['autoSubmit'],
    updatedAt: value['updatedAt']
  }
}

function parseEnvelope(plainText: string): StoredLogin[] {
  const value: unknown = JSON.parse(plainText)
  if (
    !isRecord(value) ||
    value['format'] !== ENVELOPE_FORMAT ||
    value['version'] !== ENVELOPE_VERSION ||
    !Array.isArray(value['logins'])
  ) {
    throw new TypeError('Invalid saved login file')
  }

  const logins = value['logins'].map(parseLogin)
  if (new Set(logins.map((login) => login.origin)).size !== logins.length) {
    throw new TypeError('Duplicate saved login origin')
  }
  return logins
}

function summary(login: StoredLogin): SavedLoginSummary {
  return {
    origin: login.origin,
    username: login.username,
    autoSubmit: login.autoSubmit,
    updatedAt: login.updatedAt
  }
}

function buildCredentialStore(deps: CredentialStoreDeps): CredentialStore {
  const filePath = join(deps.userDataPath, CREDENTIALS_FILE_NAME)
  const now = deps.now ?? Date.now
  let encryptionAvailable: boolean | undefined
  let cache: StoredLogin[] | undefined
  let quarantineReason: string | null = null

  const canEncrypt = (): boolean => {
    if (encryptionAvailable === undefined) {
      try {
        encryptionAvailable = deps.safeStorage.isEncryptionAvailable()
      } catch {
        encryptionAvailable = false
      }
    }
    return encryptionAvailable
  }

  const discard = (): void => {
    try {
      rmSync(filePath, { force: true })
      rmSync(`${filePath}.tmp`, { force: true })
    } catch {
      // Best effort. A later load still treats any unreadable file as empty.
    }
  }

  const quarantine = (): string => {
    const quarantinePath = quarantineFile(filePath, new Date(now())) ?? filePath
    quarantineReason =
      `저장된 데이터를 읽지 못해 격리했습니다: ${basename(quarantinePath)}`
    return quarantinePath
  }

  const load = (): StoredLogin[] => {
    if (cache !== undefined) return cache

    // This plain fs check must precede every safeStorage call. On macOS even
    // checking availability may open the keychain UI; a first-run student has
    // no encrypted file to read and must not see that prompt at app launch.
    if (!existsSync(filePath)) {
      cache = []
      return cache
    }
    if (!canEncrypt()) {
      cache = []
      return cache
    }

    try {
      cache = parseEnvelope(
        deps.safeStorage.decryptString(readFileSync(filePath))
      )
    } catch {
      cache = []
      const quarantinePath = quarantine()
      console.warn(`[credentials] 복호화 실패 — 격리: ${quarantinePath}`)
    }
    return cache
  }

  const persist = (logins: StoredLogin[]): void => {
    if (logins.length === 0) {
      discard()
      cache = []
      quarantineReason = null
      return
    }

    const envelope: CredentialEnvelope = {
      format: ENVELOPE_FORMAT,
      version: ENVELOPE_VERSION,
      logins
    }
    try {
      const encrypted = deps.safeStorage.encryptString(JSON.stringify(envelope))
      mkdirSync(deps.userDataPath, { recursive: true, mode: 0o700 })
      writeFileAtomic(filePath, encrypted, { mode: 0o600 })
      chmodSync(filePath, 0o600)
      cache = logins
      quarantineReason = null
    } catch {
      throw new Error('Saved login could not be persisted')
    }
  }

  return {
    availability(): CredentialsAvailability {
      if (
        quarantineReason === null &&
        cache === undefined &&
        existsSync(filePath) &&
        canEncrypt()
      ) {
        load()
      }
      if (quarantineReason !== null) {
        return { state: 'unavailable', reason: quarantineReason }
      }
      return canEncrypt()
        ? { state: 'ready' }
        : { state: 'unavailable', reason: ENCRYPTION_UNAVAILABLE_REASON }
    },

    list(): SavedLoginSummary[] {
      if (!existsSync(filePath) && cache === undefined) return []
      return load()
        .map(summary)
        .sort((left, right) => left.origin.localeCompare(right.origin))
    },

    save(input: SaveLoginInput): SavedLoginSummary {
      if (!canEncrypt()) {
        throw new Error(ENCRYPTION_UNAVAILABLE_REASON)
      }

      const origin = normalizeCredentialOrigin(input.origin)
      const current = load()
      const existing = current.find((login) => login.origin === origin)
      const password = input.password === '' && existing !== undefined
        ? existing.password
        : input.password
      if (password === '') {
        throw new TypeError('A password is required for a new saved login')
      }

      const login: StoredLogin = {
        origin,
        username: input.username,
        password,
        autoSubmit: input.autoSubmit ?? false,
        updatedAt: new Date(now()).toISOString()
      }
      persist([
        ...current.filter((item) => item.origin !== origin),
        login
      ])
      return summary(login)
    },

    forget(origin: string): { ok: true } {
      let normalized: string
      try {
        normalized = normalizeCredentialOrigin(origin)
      } catch {
        return { ok: true }
      }
      if (!existsSync(filePath) && cache === undefined) return { ok: true }

      const current = load()
      const next = current.filter((login) => login.origin !== normalized)
      if (next.length !== current.length) persist(next)
      return { ok: true }
    },

    resolve(origin: string): ResolvedLogin | null {
      let normalized: string
      try {
        normalized = normalizeCredentialOrigin(origin)
      } catch {
        return null
      }
      if (!existsSync(filePath) && cache === undefined) return null

      const login = load().find((item) => item.origin === normalized)
      return login === undefined
        ? null
        : {
            username: login.username,
            password: login.password,
            autoSubmit: login.autoSubmit
          }
    }
  }
}

let defaultStore: CredentialStore | undefined

export function createCredentialStore(
  deps?: CredentialStoreDeps
): CredentialStore {
  if (deps !== undefined) return buildCredentialStore(deps)
  if (defaultStore !== undefined) return defaultStore

  // Lazy require keeps unit tests Electron-free. Construction does not touch
  // safeStorage; decryption is deferred until an encrypted file actually exists.
  const electron = require('electron') as typeof import('electron')
  defaultStore = buildCredentialStore({
    safeStorage: electron.safeStorage,
    userDataPath: electron.app.getPath('userData')
  })
  return defaultStore
}
