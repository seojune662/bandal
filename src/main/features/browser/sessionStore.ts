import { chmod, writeFile } from 'node:fs/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Cookie,
  CookiesGetFilter,
  CookiesSetDetails,
  Event as ElectronEvent
} from 'electron'
import { BROWSING_PARTITION } from './webviewPolicy'

export const BROWSER_SESSION_FILE_NAME = 'browser-session-cookies.enc'
export const RESTORED_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60

const SNAPSHOT_FORMAT = 'bandal-browser-session-cookies'
const SNAPSHOT_VERSION = 1
const DEFAULT_AUTO_PERSIST_MS = 5 * 60 * 1_000

type SameSite = Cookie['sameSite']

export interface BrowserSessionLike {
  cookies: {
    get(filter: CookiesGetFilter): Promise<Cookie[]>
    set(details: CookiesSetDetails): Promise<void>
    remove(url: string, name: string): Promise<void>
    flushStore(): Promise<void>
  }
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface BrowserSessionAppLike {
  on(
    event: 'before-quit',
    listener: (event: ElectronEvent) => void
  ): unknown
  removeListener(
    event: 'before-quit',
    listener: (event: ElectronEvent) => void
  ): unknown
  quit(): void
}

export interface BrowserSessionStoreDeps {
  session: BrowserSessionLike
  safeStorage: SafeStorageLike
  userDataPath: string
  app?: BrowserSessionAppLike
  now?: () => number
  autoPersistIntervalMs?: number
  logger?: Pick<Console, 'warn'>
}

export interface BrowserSessionStore {
  restore(): Promise<void>
  persist(): Promise<void>
  startAutoPersist(): void
  dispose(): void
  listSites(): Promise<{ origin: string; cookieCount: number }[]>
  clear(origin: string | null): Promise<{ ok: true }>
}

interface StoredSessionCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite: SameSite
}

interface SessionCookieSnapshot {
  format: typeof SNAPSHOT_FORMAT
  version: typeof SNAPSHOT_VERSION
  savedAt: number
  cookies: StoredSessionCookie[]
}

/** The persisted set is defined by Chromium's missing-expiry representation. */
export function isSessionCookie(cookie: Pick<Cookie, 'expirationDate'>): boolean {
  return cookie.expirationDate === undefined
}

function normalizedDomain(domain: string | undefined): string {
  const value = domain?.replace(/^\.+/, '').trim() ?? ''
  if (value.length === 0) throw new TypeError('Cookie domain is missing')
  return value
}

/**
 * Builds the exact URL Electron needs for cookies.set/remove. Cookie domains
 * are commonly returned with a leading dot, while URL hostnames never are.
 */
export function cookieUrl(
  cookie: Pick<Cookie, 'domain' | 'path' | 'secure'>
): string {
  const domain = normalizedDomain(cookie.domain)
  const authority = domain.includes(':') && !domain.startsWith('[')
    ? `[${domain}]`
    : domain
  const url = new URL(`${cookie.secure === true ? 'https' : 'http'}://${authority}`)

  // A decrypted snapshot is untrusted input. Do not let URL punctuation in a
  // forged domain silently change the host, credentials, or port.
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new TypeError('Cookie domain is not a hostname')
  }

  url.pathname = cookie.path?.startsWith('/') === true ? cookie.path : '/'
  return url.toString()
}

export function cookieOrigin(
  cookie: Pick<Cookie, 'domain' | 'path' | 'secure'>
): string {
  return new URL(cookieUrl(cookie)).origin
}

function isSameSite(value: unknown): value is SameSite {
  return (
    value === 'unspecified' ||
    value === 'no_restriction' ||
    value === 'lax' ||
    value === 'strict'
  )
}

function storedCookie(cookie: Cookie): StoredSessionCookie | null {
  if (cookie.domain === undefined) return null

  const domain = cookie.domain
  const path = cookie.path?.startsWith('/') === true ? cookie.path : '/'
  const hostOnly = cookie.hostOnly ?? !domain.startsWith('.')
  const result: StoredSessionCookie = {
    name: cookie.name,
    value: cookie.value,
    domain,
    path,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    hostOnly,
    sameSite: cookie.sameSite
  }

  // Validate that it will be restorable before writing it to the snapshot.
  cookieUrl(result)
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoredCookie(value: unknown): StoredSessionCookie {
  if (!isRecord(value)) throw new TypeError('Invalid cookie snapshot entry')
  if (
    typeof value['name'] !== 'string' ||
    typeof value['value'] !== 'string' ||
    typeof value['domain'] !== 'string' ||
    typeof value['path'] !== 'string' ||
    typeof value['secure'] !== 'boolean' ||
    typeof value['httpOnly'] !== 'boolean' ||
    typeof value['hostOnly'] !== 'boolean' ||
    !isSameSite(value['sameSite'])
  ) {
    throw new TypeError('Invalid cookie snapshot entry')
  }

  const cookie: StoredSessionCookie = {
    name: value['name'],
    value: value['value'],
    domain: value['domain'],
    path: value['path'],
    secure: value['secure'],
    httpOnly: value['httpOnly'],
    hostOnly: value['hostOnly'],
    sameSite: value['sameSite']
  }
  cookieUrl(cookie)
  return cookie
}

function parseSnapshot(plainText: string): SessionCookieSnapshot {
  const value: unknown = JSON.parse(plainText)
  if (
    !isRecord(value) ||
    value['format'] !== SNAPSHOT_FORMAT ||
    value['version'] !== SNAPSHOT_VERSION ||
    typeof value['savedAt'] !== 'number' ||
    !Number.isFinite(value['savedAt']) ||
    !Array.isArray(value['cookies'])
  ) {
    throw new TypeError('Invalid browser session snapshot')
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    savedAt: value['savedAt'],
    cookies: value['cookies'].map(parseStoredCookie)
  }
}

function restoreDetails(
  cookie: StoredSessionCookie,
  expirationDate: number
): CookiesSetDetails {
  const details: CookiesSetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expirationDate,
    sameSite: cookie.sameSite
  }

  // Passing domain creates a domain cookie. Omitting it is what preserves a
  // host-only cookie; a leading dot is stripped because Chromium re-adds its
  // canonical domain-cookie marker itself.
  if (!cookie.hostOnly) details.domain = normalizedDomain(cookie.domain)
  return details
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}

function normalizedRequestedOrigin(origin: string): string {
  const parsed = new URL(origin)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Browser session origin must use HTTP or HTTPS')
  }
  return parsed.origin
}

function buildBrowserSessionStore(
  deps: BrowserSessionStoreDeps
): BrowserSessionStore {
  const snapshotPath = join(deps.userDataPath, BROWSER_SESSION_FILE_NAME)
  const now = deps.now ?? Date.now
  const logger = deps.logger ?? console
  const intervalMs = deps.autoPersistIntervalMs ?? DEFAULT_AUTO_PERSIST_MS

  let encryptionAvailable: boolean | undefined
  let warnedUnavailable = false
  let restorePromise: Promise<void> | undefined
  let persistQueue: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setInterval> | undefined
  let listeningForQuit = false
  let finalizingQuit = false
  let allowQuit = false

  const canEncrypt = (): boolean => {
    if (encryptionAvailable === undefined) {
      try {
        encryptionAvailable = deps.safeStorage.isEncryptionAvailable()
      } catch {
        encryptionAvailable = false
      }
    }
    if (!encryptionAvailable && !warnedUnavailable) {
      warnedUnavailable = true
      logger.warn(
        '[browser-session] OS-backed encryption is unavailable; session cookie persistence is disabled'
      )
    }
    return encryptionAvailable
  }

  const discardSnapshot = (): void => {
    try {
      unlinkSync(snapshotPath)
    } catch (error: unknown) {
      if (!isMissingFileError(error)) {
        logger.warn('[browser-session] Could not discard the cookie snapshot')
      }
    }
  }

  const restoreSnapshot = async (): Promise<void> => {
    if (!canEncrypt()) return

    let snapshot: SessionCookieSnapshot
    try {
      // Intentionally synchronous at startup: decrypting and issuing every
      // cookies.set call happens before hardenBrowsingSession returns and the
      // host starts loading its renderer/webviews.
      const encrypted = readFileSync(snapshotPath)
      snapshot = parseSnapshot(deps.safeStorage.decryptString(encrypted))
    } catch (error: unknown) {
      if (isMissingFileError(error)) return
      logger.warn(
        '[browser-session] Cookie snapshot was unreadable and has been discarded'
      )
      discardSnapshot()
      return
    }

    const expirationDate = now() / 1_000 + RESTORED_COOKIE_TTL_SECONDS
    const pending = snapshot.cookies.map((cookie) => {
      try {
        return deps.session.cookies.set(restoreDetails(cookie, expirationDate))
      } catch (error: unknown) {
        return Promise.reject(error)
      }
    })
    const results = await Promise.allSettled(pending)
    if (results.some((result) => result.status === 'rejected')) {
      logger.warn('[browser-session] One or more session cookies could not be restored')
      return
    }

    try {
      // Restored cookies now carry a 30-day expiry. Flush them before removing
      // the one-use encrypted handoff so a crash cannot lose the restoration.
      await deps.session.cookies.flushStore()
      discardSnapshot()
    } catch {
      logger.warn('[browser-session] Restored cookies could not be flushed to disk')
    }
  }

  const writeSnapshot = async (): Promise<void> => {
    if (!canEncrypt()) return

    let wroteEncryptedSnapshot = false
    try {
      const cookies = await deps.session.cookies.get({})
      const sessionCookies: StoredSessionCookie[] = []
      for (const cookie of cookies) {
        if (!isSessionCookie(cookie)) continue
        const stored = storedCookie(cookie)
        if (stored !== null) sessionCookies.push(stored)
      }

      const snapshot: SessionCookieSnapshot = {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        savedAt: now(),
        cookies: sessionCookies
      }
      const encrypted = deps.safeStorage.encryptString(JSON.stringify(snapshot))

      // mode applies on creation; chmod also tightens an already-existing file.
      await writeFile(snapshotPath, encrypted, { mode: 0o600 })
      wroteEncryptedSnapshot = true
      await chmod(snapshotPath, 0o600)
    } catch {
      // Never retain a newly-written file if its required permissions could not
      // be confirmed. If writing failed earlier, keep the last good backup.
      if (wroteEncryptedSnapshot) discardSnapshot()
      logger.warn('[browser-session] Session cookies could not be persisted')
    }
  }

  const restore = (): Promise<void> => {
    restorePromise ??= restoreSnapshot()
    return restorePromise
  }

  const persist = (): Promise<void> => {
    const operation = persistQueue.then(async () => {
      if (restorePromise !== undefined) await restorePromise
      await writeSnapshot()
    })
    // writeSnapshot is deliberately non-throwing, but keeping a healed queue
    // makes the serialization robust if that implementation changes later.
    persistQueue = operation.catch(() => undefined)
    return operation
  }

  const stopAutoPersist = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const beforeQuit = (event: ElectronEvent): void => {
    if (allowQuit) return
    event.preventDefault()
    if (finalizingQuit) return

    finalizingQuit = true
    stopAutoPersist()
    void persist().finally(() => {
      allowQuit = true
      deps.app?.quit()
    })
  }

  return {
    restore,
    persist,

    startAutoPersist(): void {
      if (!canEncrypt()) return
      if (timer === undefined) {
        timer = setInterval(() => {
          void persist()
        }, intervalMs)
        timer.unref?.()
      }
      if (deps.app !== undefined && !listeningForQuit) {
        deps.app.on('before-quit', beforeQuit)
        listeningForQuit = true
      }
    },

    dispose(): void {
      stopAutoPersist()
      if (deps.app !== undefined && listeningForQuit) {
        deps.app.removeListener('before-quit', beforeQuit)
        listeningForQuit = false
      }
    },

    async listSites(): Promise<{ origin: string; cookieCount: number }[]> {
      await restore()
      const counts = new Map<string, number>()
      for (const cookie of await deps.session.cookies.get({})) {
        try {
          const origin = cookieOrigin(cookie)
          counts.set(origin, (counts.get(origin) ?? 0) + 1)
        } catch {
          logger.warn('[browser-session] Ignored a cookie with an invalid domain')
        }
      }
      return [...counts.entries()]
        .map(([origin, cookieCount]) => ({ origin, cookieCount }))
        .sort((left, right) => left.origin.localeCompare(right.origin))
    },

    async clear(origin: string | null): Promise<{ ok: true }> {
      await restore()
      const requestedOrigin = origin === null
        ? null
        : normalizedRequestedOrigin(origin)
      const removals: Promise<void>[] = []

      for (const cookie of await deps.session.cookies.get({})) {
        try {
          if (
            requestedOrigin === null ||
            cookieOrigin(cookie) === requestedOrigin
          ) {
            removals.push(
              deps.session.cookies.remove(cookieUrl(cookie), cookie.name)
            )
          }
        } catch {
          logger.warn('[browser-session] Ignored a cookie with an invalid domain')
        }
      }

      await Promise.all(removals)
      await deps.session.cookies.flushStore()
      if (canEncrypt()) {
        await persist()
      } else {
        // A stale snapshot must never resurrect cookies after an explicit clear.
        discardSnapshot()
      }
      return { ok: true }
    }
  }
}

let defaultStore: BrowserSessionStore | undefined

/**
 * Production calls use Electron lazily so importing this module in Vitest does
 * not require an Electron runtime. Supplying deps creates an isolated store for
 * unit tests; no-argument calls share the app-wide browsing-session store.
 */
export function createBrowserSessionStore(): BrowserSessionStore
export function createBrowserSessionStore(
  deps: BrowserSessionStoreDeps
): BrowserSessionStore
export function createBrowserSessionStore(
  deps?: BrowserSessionStoreDeps
): BrowserSessionStore {
  if (deps !== undefined) return buildBrowserSessionStore(deps)
  if (defaultStore !== undefined) return defaultStore

  // Main is emitted as CommonJS by electron-vite. Keeping this require inside
  // the no-argument branch is the Electron-free test seam.
  const electron = require('electron') as typeof import('electron')
  defaultStore = buildBrowserSessionStore({
    session: electron.session.fromPartition(BROWSING_PARTITION),
    safeStorage: electron.safeStorage,
    userDataPath: electron.app.getPath('userData'),
    app: electron.app
  })
  return defaultStore
}
