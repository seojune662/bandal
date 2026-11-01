/**
 * Google Drive through its REST API (design 2.5, spec 저장소 루트): the
 * folder a Bandal client made and marked as the root. Under the
 * `drive.file` scope the app sees only what Bandal clients of this Cloud
 * project made, so one listing of everything visible is the whole tree.
 * Remote changes come from `changes.list`, polled every 30 s while a window
 * is in use and every 5 minutes otherwise. The token is kept encrypted with
 * safeStorage, never in a plain file.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../../lib/atomicWrite'
import { runtimeSafeStorage, type SafeStorageLike } from '../../lib/safeStorageGate'
import { createSessionStore } from '../account/sessionStore'
import { authorize, googleClient, granted, tokenRequest } from '../google/oauth'
import { contentRef, isSpecPath } from './format'
import type { ProviderStatus, SyncProvider } from './icloud'
import type { RootSnapshot } from './pull'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const DRIVE_TOKEN_FILE = 'gdrive-token.enc'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,parents,md5Checksum,size,modifiedTime,createdTime,trashed'
/** Drive takes a multipart upload up to 5 MB; anything larger goes in a resumable session. */
const MULTIPART_MAX = 5 * 1024 * 1024
/**
 * Larger files move in 4 MiB pieces (a multiple of the 256 KiB Drive asks
 * for), each with its own 2 minutes: a slow link still gets there, and a
 * cut-off upload goes on from what Drive has.
 */
const PIECE = 4 * 1024 * 1024
const PIECE_MS = 2 * 60_000
const OFFLINE = 'Google Drive에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
const POLL = {
  activeMs: 30_000,
  idleMs: 5 * 60_000,
  /** In use: a window has focus and the keyboard or mouse moved in the last 5 minutes. */
  idleAfterSeconds: 5 * 60,
  tickMs: 5_000
}

interface DriveFile { id: string; name: string; mimeType: string; parents?: string[]; md5Checksum?: string; size?: string; modifiedTime?: string; createdTime?: string; trashed?: boolean }
interface Token { refresh: string; access: string; expires: number; account: string | null }

export interface DriveProvider extends SyncProvider {
  /** The Google account signed in for sync, or null. */
  account(): string | null
  signedIn(): boolean
  signIn(): Promise<void>
  /**
   * Forgets the token here. It is not revoked: a revoke withdraws every scope
   * this Cloud project holds for the account, which would also cut off Gmail
   * and the iPad's sync.
   */
  signOut(): Promise<void>
  /** The Bandal folder the spec picks, which becomes this provider's root; `make` makes one when there is none. */
  findRoot(make: boolean): Promise<string | null>
}

export interface DriveOptions {
  /** `<profile>/sync`: the encrypted token and the cache of downloaded files. */
  dir: string
  /** The bound root folder from state.json; null until a connect finds one. */
  root: string | null
  /** Whether a Bandal window has focus, and seconds since the last keyboard or mouse input. */
  activity(): { focused: boolean; idleSeconds: number }
  encryptor?: SafeStorageLike
  timing?: Partial<typeof POLL>
}

const md5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('hex')
/** ISO times and ids order the same everywhere, unlike a locale compare (the iPad must pick the same root). */
const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const query = (params: Record<string, string>): string => new URLSearchParams(params).toString()
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' }
/** The root's mark (spec v2.5): in public `properties` every client of the project sees, and in `appProperties` only the client that wrote it sees. */
const ROOT_MARK = { bandalRoot: '2' }

/** A failed request, said for people; `status` stays for the code. */
async function failure(response: Response): Promise<Error & { status: number }> {
  const body = await response.json().catch(() => ({})) as { error?: { errors?: { reason?: string }[] } }
  const reason = body.error?.errors?.[0]?.reason ?? ''
  const text = response.status === 429 || /ratelimitexceeded/i.test(reason) ? 'Google Drive 요청이 많아 잠시 쉬었다가 이어서 동기화해요.'
    : reason === 'storageQuotaExceeded' ? 'Google Drive 저장 공간이 부족해요.'
      : response.status >= 500 ? 'Google Drive가 잠시 응답하지 않아요. 잠시 뒤 이어서 동기화해요.'
        : `Google Drive 요청이 실패했어요 (${response.status}${reason ? ` ${reason}` : ''}).`
  return Object.assign(new Error(text), { status: response.status })
}

export function createDriveProvider(options: DriveOptions): DriveProvider {
  const timing = { ...POLL, ...options.timing }
  const store = createSessionStore({ filePath: join(options.dir, DRIVE_TOKEN_FILE), encryptor: options.encryptor ?? runtimeSafeStorage() })
  const cacheDir = join(options.dir, 'gdrive-cache')
  let token: Token | null = null, needsAuth = false, root = options.root
  let refreshing: Promise<string> | null = null, catching: Promise<boolean> | null = null, signingIn: AbortController | null = null
  /** Upload sessions cut off this run, by path and bytes: the next try of the same bytes goes on from what Drive has. */
  const sessions = new Map<string, { location: string; digest: string }>()
  /** Every file and folder Bandal clients made that is not in the trash, by id; null until listed. */
  let files: Map<string, DriveFile> | null = null, pageToken = ''
  let layoutOf: { root: string; byPath: Map<string, DriveFile>; folders: Map<string, string> } | null = null
  // Read once: a profile that never signed in has no file, so the keychain is never asked.
  const loaded = store.getItem('token').then(raw => {
    try {
      const saved = JSON.parse(raw ?? 'null') as Token | null
      if (typeof saved?.refresh === 'string' && typeof saved.access === 'string') token = saved
    } catch {
      // An unreadable token is no token: sign in again.
    }
  })

  async function access(): Promise<string> {
    await loaded
    const current = token
    if (current === null || needsAuth) throw new Error('Google Drive 연결이 끊겼어요. 다시 연결해 주세요.')
    if (current.expires > Date.now() + 60_000) return current.access
    refreshing ??= (async () => {
      const { ok, result } = await tokenRequest(new URLSearchParams({ refresh_token: current.refresh, grant_type: 'refresh_token' })).catch(() => {
        throw new Error(OFFLINE)
      })
      // Signed out or in again meanwhile: that session's token stands, whatever this one's answer was.
      if (token?.refresh !== current.refresh) throw new Error('Google Drive 계정이 바뀌었어요.')
      if (!ok || !result.access_token) {
        if (result.error === 'invalid_grant') needsAuth = true
        throw new Error(result.error === 'invalid_grant' ? 'Google Drive 연결이 끊겼어요. 다시 연결해 주세요.' : 'Google Drive 인증을 새로 고치지 못했어요.')
      }
      token = { ...current, access: result.access_token, expires: Date.now() + (result.expires_in ?? 3600) * 1000 }
      await store.setItem('token', JSON.stringify(token))
      return token.access
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /** A request with the bearer; `ok` also takes the statuses a caller handles (a resumable upload's 308). */
  async function call(url: string, init: RequestInit = {}, options: { timeoutMs?: number; ok?: number[] } = {}, retried = false): Promise<Response> {
    const bearer = await access()
    let response: Response
    try {
      // A resumable upload's 308 is an answer, not a redirect to follow.
      response = await fetch(url, { ...init, redirect: options.ok?.includes(308) ? 'manual' : 'follow', headers: { ...init.headers, Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) })
    } catch {
      throw new Error(OFFLINE)
    }
    if (response.status === 401 && !retried && token !== null) {
      // The access token died early: refresh once.
      token = { ...token, expires: 0 }
      return call(url, init, options, true)
    }
    if (!response.ok && !options.ok?.includes(response.status)) throw await failure(response)
    return response
  }
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => (await call(url, init)).json() as Promise<T>

  /** A cached copy no file has any more (the file was rewritten or removed). */
  const forget = (old: DriveFile | undefined, next?: DriveFile): void => {
    if (old?.md5Checksum && old.md5Checksum !== next?.md5Checksum && /^[0-9a-f]{32}$/.test(old.md5Checksum)) rmSync(join(cacheDir, old.md5Checksum), { force: true })
  }
  const upsert = (file: DriveFile): void => {
    if (files === null) return
    forget(files.get(file.id), file.trashed ? undefined : file)
    if (file.trashed) files.delete(file.id)
    else files.set(file.id, file)
    layoutOf = null
  }

  /** Brings the listing up to date; true when anything changed. Concurrent callers share one round. */
  function catchUp(): Promise<boolean> {
    catching ??= (async () => {
      if (files === null) {
        // The token first, so nothing that changes during the listing is missed.
        const start = await json<{ startPageToken: string }>(`${API}/changes/startPageToken`)
        const all = new Map<string, DriveFile>()
        let page = ''
        do {
          const result = await json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${query({
            q: 'trashed = false', spaces: 'drive', pageSize: '1000', fields: `nextPageToken,files(${FIELDS})`, ...(page ? { pageToken: page } : {})
          })}`)
          for (const file of result.files) all.set(file.id, file)
          page = result.nextPageToken ?? ''
        } while (page)
        files = all
        pageToken = start.startPageToken
        layoutOf = null
        prune(all)
        return true
      }
      let changed = false, page = pageToken
      for (;;) {
        const result = await json<{ changes: { fileId: string; removed?: boolean; file?: DriveFile }[]; nextPageToken?: string; newStartPageToken?: string }>(`${API}/changes?${query({
          pageToken: page, spaces: 'drive', includeRemoved: 'true', pageSize: '1000', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`
        })}`).catch((error: unknown) => {
          // A page token Drive no longer takes: list everything again next time.
          if ([400, 404, 410].includes((error as { status?: number }).status ?? 0)) files = null
          throw error
        })
        for (const change of result.changes) {
          changed = true
          if (change.file && !change.removed) upsert(change.file)
          else {
            forget(files?.get(change.fileId))
            files?.delete(change.fileId)
            layoutOf = null
          }
        }
        if (result.newStartPageToken) {
          pageToken = result.newStartPageToken
          return changed
        }
        page = result.nextPageToken ?? ''
        if (!page) return changed
      }
    })().finally(() => {
      catching = null
    })
    return catching
  }

  /** Paths under the root. Folders of one path are one folder; of files at one path, the last changed one counts (design P10). */
  function layout(top: string) {
    if (layoutOf?.root === top) return layoutOf
    const all = files ?? new Map<string, DriveFile>()
    const paths = new Map<string, string | null>([[top, '']])
    const pathOf = (id: string, depth = 0): string | null => {
      const known = paths.get(id)
      if (known !== undefined) return known
      const file = all.get(id), parent = file?.parents?.[0]
      const above = file && parent && depth < 16 ? pathOf(parent, depth + 1) : null
      const path = above === null || !file ? null : above === '' ? file.name : `${above}/${file.name}`
      paths.set(id, path)
      return path
    }
    const byPath = new Map<string, DriveFile>(), folders = new Map<string, string>()
    for (const file of all.values()) {
      const path = pathOf(file.id)
      if (path === null || path === '') continue
      if (file.mimeType === FOLDER) {
        const known = folders.get(path), other = known === undefined ? undefined : all.get(known)
        if (!other || (file.createdTime ?? '') < (other.createdTime ?? '')) folders.set(path, file.id)
      } else {
        const other = byPath.get(path)
        if (!other || (file.modifiedTime ?? '') > (other.modifiedTime ?? '')) byPath.set(path, file)
      }
    }
    layoutOf = { root: top, byPath, folders }
    return layoutOf
  }

  const bound = (): string => {
    if (root === null) throw new Error('Google Drive의 반달 폴더에 아직 연결하지 않았어요.')
    return root
  }

  /** Downloaded metadata, ink and notes by md5, so a restart reads only what changed; PDFs and images are not kept twice. */
  const cachePath = (path: string, file: DriveFile): string | null =>
    contentRef(path) === null && file.md5Checksum && /^[0-9a-f]{32}$/.test(file.md5Checksum) ? join(cacheDir, file.md5Checksum) : null
  function prune(all: Map<string, DriveFile>): void {
    try {
      const live = new Set([...all.values()].map(file => file.md5Checksum))
      for (const name of readdirSync(cacheDir)) if (!live.has(name)) rmSync(join(cacheDir, name), { force: true })
    } catch {
      // No cache yet.
    }
  }

  async function read(path: string): Promise<Uint8Array> {
    const file = layout(bound()).byPath.get(path)
    if (!file) throw new Error(`${path} is not in Google Drive`)
    const cached = cachePath(path, file)
    if (cached !== null && existsSync(cached)) return readFileSync(cached)
    const bytes = await download(file)
    // Changed again since the listing: the next pass reads the newer one.
    if (file.md5Checksum && md5(bytes) !== file.md5Checksum) throw new Error(`${path} changed while it was read`)
    keep(cached, bytes)
    return bytes
  }
  const keep = (cached: string | null, bytes: Uint8Array): void => {
    if (cached === null) return
    mkdirSync(cacheDir, { recursive: true })
    writeFileAtomic(cached, Buffer.from(bytes))
  }

  /** A large file in pieces, each with its own time. */
  async function download(file: DriveFile): Promise<Uint8Array> {
    const url = `${API}/files/${file.id}?alt=media`, size = Number(file.size)
    if (!Number.isSafeInteger(size) || size <= PIECE) return new Uint8Array(await (await call(url, {}, { timeoutMs: 10 * 60_000 })).arrayBuffer())
    const bytes = new Uint8Array(size)
    for (let start = 0; start < size; start += PIECE) {
      const end = Math.min(start + PIECE, size) - 1
      const piece = new Uint8Array(await (await call(url, { headers: { Range: `bytes=${start}-${end}` } }, { timeoutMs: PIECE_MS })).arrayBuffer())
      if (piece.length !== end - start + 1) throw new Error(`${file.name} changed while it was read`)
      bytes.set(piece, start)
    }
    return bytes
  }

  async function upload(path: string, url: string, method: 'POST' | 'PATCH', metadata: object, bytes: Uint8Array): Promise<DriveFile> {
    const params = `fields=${FIELDS}&uploadType=`
    if (bytes.length <= MULTIPART_MAX) {
      const boundary = randomUUID()
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ])
      return (await call(`${url}?${params}multipart`, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, { timeoutMs: 10 * 60_000 })).json() as Promise<DriveFile>
    }
    // A session cut off earlier this run goes on; a new run starts over.
    const digest = md5(bytes)
    let location = sessions.get(path)?.digest === digest ? sessions.get(path)!.location : undefined, offset = 0
    if (location !== undefined) {
      const status = await call(location, { method: 'PUT', headers: { 'Content-Range': `bytes */${bytes.length}` } }, { ok: [308, 404, 410] }).catch(() => null)
      if (status?.ok) return sessions.delete(path), status.json() as Promise<DriveFile>
      if (status?.status === 308) offset = Number(/bytes=0-(\d+)/.exec(status.headers.get('range') ?? '')?.[1] ?? -1) + 1
      else location = undefined
    }
    if (location === undefined) {
      const session = await call(`${url}?${params}resumable`, {
        method, headers: { ...JSON_HEADERS, 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(metadata)
      })
      location = session.headers.get('location') ?? ''
      // The bearer goes only to Google's upload endpoint.
      if (!location.startsWith(`${UPLOAD}/`)) throw new Error('Google Drive가 업로드를 받지 않았어요.')
      sessions.set(path, { location, digest })
    }
    for (;;) {
      const end = Math.min(offset + PIECE, bytes.length)
      const response = await call(location, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: bytes.subarray(offset, end) },
        { timeoutMs: PIECE_MS, ok: [308] })
      if (response.ok) {
        sessions.delete(path)
        return response.json() as Promise<DriveFile>
      }
      offset = Number(/bytes=0-(\d+)/.exec(response.headers.get('range') ?? '')?.[1] ?? -1) + 1
    }
  }

  /** The folder at `parts` under the root, made where missing. */
  async function folder(top: string, parts: string[]): Promise<string> {
    let parent = top
    for (let index = 0; index < parts.length; index++) {
      const known = layout(top).folders.get(parts.slice(0, index + 1).join('/'))
      if (known !== undefined) {
        parent = known
        continue
      }
      const made = await json<DriveFile>(`${API}/files?fields=${FIELDS}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: parts[index], mimeType: FOLDER, parents: [parent] }) })
      upsert(made)
      parent = made.id
    }
    return parent
  }

  return {
    async status(): Promise<ProviderStatus> {
      await loaded
      return token === null || needsAuth ? 'needs-auth' : 'ready'
    },
    async list(): Promise<RootSnapshot> {
      const top = bound()
      await catchUp()
      if (!files?.has(top)) throw new Error('Google Drive에서 반달 폴더를 찾지 못했어요. 연결을 해제한 뒤 다시 연결해 주세요.')
      const entries = [...layout(top).byPath].filter(([path]) => isSpecPath(path))
        .map(([path, file]) => ({ path, version: file.md5Checksum ?? file.modifiedTime ?? file.id }))
      return { entries, read }
    },
    async write(path, bytes) {
      if (!isSpecPath(path)) throw new Error(`${path} is not a sync path`)
      const top = bound()
      if (files === null) await catchUp()
      // Only this device's files and content-named ones are ever written: one at a path is ours to replace.
      const existing = layout(top).byPath.get(path)
      const parts = path.split('/'), name = parts.pop()!
      const file = existing
        ? await upload(path, `${UPLOAD}/files/${existing.id}`, 'PATCH', {}, bytes)
        : await upload(path, `${UPLOAD}/files`, 'POST', { name, parents: [await folder(top, parts)] }, bytes)
      // What this device just wrote is not read back: the poll will report it as a change.
      if (file.md5Checksum === md5(bytes)) keep(cachePath(path, file), bytes)
      upsert(file)
    },
    watch(onChange) {
      let last = Date.now(), focused = false
      const timer = setInterval(() => {
        const now = options.activity()
        // Coming back to the window checks at once (spec "포그라운드 진입 시").
        const back = now.focused && !focused
        focused = now.focused
        const every = now.focused && now.idleSeconds < timing.idleAfterSeconds ? timing.activeMs : timing.idleMs
        if (!back && Date.now() - last < every) return
        last = Date.now()
        // A failed check waits for the next one; the engine's own passes report errors.
        void catchUp().then(changed => {
          if (changed) onChange()
        }, () => {})
      }, timing.tickMs)
      timer.unref()
      return () => clearInterval(timer)
    },
    account: () => token?.account ?? null,
    signedIn: () => token !== null,
    async signIn() {
      if (!googleClient().clientId) throw new Error('이 빌드에는 Google 연결 설정이 없어요.')
      signingIn?.abort()
      const controller = new AbortController()
      signingIn = controller
      try {
        const grant = await authorize({ scope: DRIVE_SCOPE, label: 'Google Drive', signal: controller.signal })
        const { ok, result } = await tokenRequest(grant).catch(() => {
          throw new Error(OFFLINE)
        })
        if (!ok || !result.access_token || !result.refresh_token) throw new Error('Google Drive 연결을 마치지 못했어요. 다시 시도해 주세요.')
        if (!granted(result, DRIVE_SCOPE)) throw new Error('Google Drive 접근을 허용해 주세요. 반달은 반달이 만든 파일에만 접근해요.')
        // drive.file can read the account's address; without it the screen simply shows none.
        const about = await fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(30_000) })
          .then(response => (response.ok ? response.json() : {}), () => ({})) as { user?: { emailAddress?: string } }
        if (controller.signal.aborted) throw new Error('Google Drive 연결을 취소했어요.')
        await loaded
        const next: Token = { refresh: result.refresh_token, access: result.access_token, expires: Date.now() + (result.expires_in ?? 3600) * 1000, account: about.user?.emailAddress ?? null }
        // Another account sees other files: list again.
        if (token?.account !== next.account) files = null
        token = next
        needsAuth = false
        await store.setItem('token', JSON.stringify(next))
      } finally {
        if (signingIn === controller) signingIn = null
      }
    },
    async signOut() {
      signingIn?.abort()
      await loaded
      token = null
      needsAuth = false
      files = null
      root = null
      await store.removeItem('token')
      rmSync(cacheDir, { recursive: true, force: true })
    },
    async findRoot(make) {
      const folders = async (q: string): Promise<DriveFile[]> => (await json<{ files: DriveFile[] }>(`${API}/files?${query({
        q: `${q} and mimeType = '${FOLDER}' and trashed = false`, spaces: 'drive', pageSize: '100', fields: `files(${FIELDS})`
      })}`)).files
      const started = new Set<string>()
      const look = async (found: DriveFile[]): Promise<DriveFile[]> => {
        for (const folder of found) {
          const marker = await json<{ files: DriveFile[] }>(`${API}/files?${query({ q: `'${folder.id}' in parents and name = 'bandal.json' and trashed = false`, spaces: 'drive', fields: 'files(id)' })}`)
          if (marker.files.length > 0) started.add(folder.id)
        }
        return found
      }
      // A marked folder wherever it is, under any name. With none, a root another client made before v2.5
      // (its mark private to that client): a "Bandal" folder that holds bandal.json.
      const candidates = async (): Promise<DriveFile[]> => {
        const marked = await look(await folders(`(properties has { key='bandalRoot' and value='2' } or appProperties has { key='bandalRoot' and value='2' })`))
        return marked.length > 0 ? marked : (await look(await folders(`name = 'Bandal'`))).filter(folder => started.has(folder.id))
      }
      let found = await candidates(), made: string | null = null
      if (found.length === 0 && !make) return null
      if (found.length === 0) {
        const folder = await json<DriveFile>(`${API}/files?fields=${FIELDS}`, {
          method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: 'Bandal', mimeType: FOLDER, parents: ['root'], properties: ROOT_MARK, appProperties: ROOT_MARK })
        })
        made = folder.id
        upsert(folder)
        // Another device may have made one at the same moment: each takes the same, earliest one.
        found = await candidates()
      }
      const [chosen] = [...found].sort((a, b) => Number(started.has(b.id)) - Number(started.has(a.id)) ||
        order(a.createdTime ?? '', b.createdTime ?? '') || order(a.id, b.id))
      // A listing that lags behind the folder just made still has that folder.
      const id = chosen?.id ?? made
      if (!id) throw new Error('Google Drive에 반달 폴더를 만들지 못했어요.')
      // The empty folder made a moment ago lost to an earlier one: out of the person's way.
      if (made !== null && made !== id) await call(`${API}/files/${made}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ trashed: true }) }).catch(() => {})
      if (chosen) upsert(chosen)
      root = id
      return root
    }
  }
}
