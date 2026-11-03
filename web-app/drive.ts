/**
 * Read-only Google Drive access for the web app. It mirrors the desktop
 * provider (`src/main/features/sync/drive.ts`):
 * - The same root lookup (spec 저장소 루트, v2.5/v2.6).
 * - The same path layout: one folder per path, and for files at one path the
 *   last changed one wins.
 * This client never creates, changes or trashes anything in Drive.
 */
const API = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,parents,md5Checksum,size,modifiedTime,createdTime,trashed'

export interface DriveFile { id: string; name: string; mimeType: string; parents?: string[]; md5Checksum?: string; size?: string; modifiedTime?: string; createdTime?: string; trashed?: boolean }
export interface DriveAccount { email: string | null; name: string | null; photo: string | null }

export class DriveError extends Error {
  constructor(readonly code: 'unauthorized' | 'rate_limited' | 'offline' | 'unavailable' | 'failed', readonly status = 0) { super(code) }
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const query = (params: Record<string, string>): string => new URLSearchParams(params).toString()

export function createDrive(token: () => string) {
  async function call(url: string, timeoutMs = 30_000): Promise<Response> {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token()}` }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch {
      throw new DriveError('offline')
    }
    if (response.ok) return response
    if (response.status === 401) throw new DriveError('unauthorized', 401)
    if (response.status === 429 || response.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(await response.clone().text().catch(() => ''))) throw new DriveError('rate_limited', response.status)
    if (response.status >= 500) throw new DriveError('unavailable', response.status)
    throw new DriveError('failed', response.status)
  }
  const json = async <T>(url: string): Promise<T> => (await call(url)).json() as Promise<T>

  async function folders(q: string): Promise<DriveFile[]> {
    return (await json<{ files: DriveFile[] }>(`${API}/files?${query({ q: `${q} and mimeType = '${FOLDER}' and trashed = false`, spaces: 'drive', pageSize: '100', fields: `files(${FIELDS})` })}`)).files
  }
  async function hasMarker(folder: string): Promise<boolean> {
    const found = await json<{ files: DriveFile[] }>(`${API}/files?${query({ q: `'${folder}' in parents and name = 'bandal.json' and trashed = false`, spaces: 'drive', fields: 'files(id)' })}`)
    return found.files.length > 0
  }

  return {
    async account(): Promise<DriveAccount> {
      const about = await json<{ user?: { emailAddress?: string; displayName?: string; photoLink?: string } }>(`${API}/about?fields=user(emailAddress,displayName,photoLink)`)
      return { email: about.user?.emailAddress ?? null, name: about.user?.displayName ?? null, photo: about.user?.photoLink ?? null }
    },

    /** The root folder the spec picks, or null when this account has none. Never makes one. */
    async findRoot(): Promise<string | null> {
      const started = new Set<string>()
      const look = async (found: DriveFile[]): Promise<DriveFile[]> => {
        await Promise.all(found.map(async folder => { if (await hasMarker(folder.id)) started.add(folder.id) }))
        return found
      }
      const marked = await look(await folders(`(properties has { key='bandalRoot' and value='2' } or appProperties has { key='bandalRoot' and value='2' })`))
      const found = marked.length > 0 ? marked : (await look(await folders(`name = 'Bandal'`))).filter(folder => started.has(folder.id))
      const [chosen] = [...found].sort((a, b) => Number(started.has(b.id)) - Number(started.has(a.id)) || order(a.createdTime ?? '', b.createdTime ?? '') || order(a.id, b.id))
      return chosen?.id ?? null
    },

    /** Everything visible under `drive.file` that is not in the trash, laid out under `root` by path. */
    async listRoot(root: string): Promise<Map<string, DriveFile>> {
      const all = new Map<string, DriveFile>()
      let page = ''
      do {
        const result = await json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${query({
          q: 'trashed = false', spaces: 'drive', pageSize: '1000', fields: `nextPageToken,files(${FIELDS})`, ...(page ? { pageToken: page } : {})
        })}`)
        for (const file of result.files) all.set(file.id, file)
        page = result.nextPageToken ?? ''
      } while (page)
      const paths = new Map<string, string | null>([[root, '']])
      const pathOf = (id: string, depth = 0): string | null => {
        const known = paths.get(id)
        if (known !== undefined) return known
        const file = all.get(id), parent = file?.parents?.[0]
        const above = file && parent && depth < 16 ? pathOf(parent, depth + 1) : null
        const path = above === null || !file ? null : above === '' ? file.name : `${above}/${file.name}`
        paths.set(id, path)
        return path
      }
      const byPath = new Map<string, DriveFile>()
      for (const file of all.values()) {
        if (file.mimeType === FOLDER) continue
        const path = pathOf(file.id)
        if (path === null || path === '') continue
        const other = byPath.get(path)
        if (!other || (file.modifiedTime ?? '') > (other.modifiedTime ?? '')) byPath.set(path, file)
      }
      return byPath
    },

    async download(file: DriveFile): Promise<Uint8Array> {
      const size = Number(file.size)
      // About a minute per 10 MB on a slow link, at least 30 seconds.
      const timeout = Math.max(30_000, Number.isFinite(size) ? Math.ceil(size / (10 * 1024 * 1024)) * 60_000 : 120_000)
      return new Uint8Array(await (await call(`${API}/files/${encodeURIComponent(file.id)}?alt=media`, timeout)).arrayBuffer())
    }
  }
}

export type Drive = ReturnType<typeof createDrive>
