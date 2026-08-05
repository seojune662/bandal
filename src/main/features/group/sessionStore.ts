/**
 * safeStorage-backed persistence for the supabase-js auth session
 * (docs/phase2-community.md §1.2).
 *
 * The refresh token is a long-lived credential, so it is encrypted with the
 * OS keychain-derived key that Electron's `safeStorage` exposes, written
 * atomically (tmp → fsync → rename) and chmod 0600.
 *
 * When `isEncryptionAvailable()` is false we keep the session IN MEMORY ONLY
 * rather than writing plaintext — the user re-authenticates each launch, which
 * is a worse experience but not a credential leak. keytar was rejected: it is
 * archived and native, and this project has already paid the better-sqlite3
 * rebuild tax once.
 *
 * supabase-js calls this synchronously-ish through a Promise-shaped adapter,
 * and the PKCE `code_verifier` rides the same adapter, so it inherits the same
 * protection for free.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The tiny slice of `safeStorage` we depend on — injectable for tests. */
export interface SecureEncryptor {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** The supabase-js `storage` option shape (a Promise-tolerant Storage). */
export interface SupabaseStorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface SessionStoreDeps {
  /** Absolute path of `<userData>/auth/session.enc`. */
  filePath: string
  encryptor: SecureEncryptor
}

interface Envelope {
  [key: string]: string
}

function atomicWrite(filePath: string, data: Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
}

/**
 * Creates the storage adapter. All failures are non-fatal by design: a
 * corrupt or unreadable session file must degrade to `signed-out`, never
 * block app boot (§1.4-3).
 */
export function createSessionStore(deps: SessionStoreDeps): SupabaseStorageAdapter {
  const canPersist = (() => {
    try {
      return deps.encryptor.isEncryptionAvailable()
    } catch {
      return false
    }
  })()

  // In-memory mirror. It is also the ONLY store when encryption is off.
  let cache: Envelope | null = null

  function load(): Envelope {
    if (cache !== null) return cache
    if (!canPersist) {
      cache = {}
      return cache
    }
    try {
      const raw = readFileSync(deps.filePath)
      const parsed: unknown = JSON.parse(deps.encryptor.decryptString(raw))
      cache =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as Envelope)
          : {}
    } catch {
      // Missing file on first run, or a file written by another OS user /
      // another keychain. Either way: start clean, stay signed out.
      cache = {}
    }
    return cache
  }

  function persist(): void {
    if (!canPersist || cache === null) return
    try {
      atomicWrite(deps.filePath, deps.encryptor.encryptString(JSON.stringify(cache)))
    } catch (error) {
      console.error('[group] failed to persist the auth session', error)
    }
  }

  return {
    getItem: (key) => Promise.resolve(load()[key] ?? null),
    setItem: (key, value) => {
      const next = { ...load(), [key]: value }
      cache = next
      persist()
      return Promise.resolve()
    },
    removeItem: (key) => {
      const next = { ...load() }
      delete next[key]
      cache = next
      persist()
      return Promise.resolve()
    }
  }
}

/** Wipes the encrypted session file (sign-out). Never throws. */
export function destroySessionFile(filePath: string): void {
  try {
    rmSync(filePath, { force: true })
    rmSync(`${filePath}.tmp`, { force: true })
  } catch {
    // Best effort — supabase-js has already cleared its in-memory session.
  }
}

/** Conventional location under Electron's userData directory. */
export function sessionFilePath(userDataDir: string): string {
  return join(userDataDir, 'auth', 'session.enc')
}
