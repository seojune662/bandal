import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Google Drive's REST API in memory, for the calls the sync provider makes:
 * files.list (the few `q` forms it uses), files.create / update (metadata,
 * multipart and resumable), alt=media, changes, about, and the token endpoint.
 */
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'

interface Stored {
  id: string; name: string; mimeType: string; parents: string[]; createdTime: string; modifiedTime: string
  trashed: boolean; properties?: Record<string, string>; appProperties?: Record<string, string>; bytes?: Buffer
}
/** A folder's marks as this client reads them. Real Drive shows `appProperties` to every client of the project (measured, spec v2.6); a test leaves them out to stand for a folder without that mark. */
type Marks = Pick<Stored, 'properties' | 'appProperties'>

export const fakeEncryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`enc:${text}`),
  decryptString: (bytes: Buffer) => bytes.toString().slice(4)
}

/** A signed-in profile: the token file the provider would have written after a sign-in. */
export function seedToken(dir: string, token: { access?: string; expires?: number; account?: string } = {}): void {
  mkdirSync(dir, { recursive: true })
  const saved = { refresh: 'refresh-1', access: token.access ?? 'access-1', expires: token.expires ?? Date.now() + 3_600_000, account: token.account ?? 'me@example.com' }
  writeFileSync(join(dir, 'gdrive-token.enc'), fakeEncryptor.encryptString(JSON.stringify({ token: JSON.stringify(saved) })))
}

export function createFakeDrive() {
  const files = new Map<string, Stored>()
  const log: { fileId: string; file: ReturnType<typeof meta> }[] = []
  const sessions = new Map<string, { id: string | null; metadata: Record<string, unknown>; received: Buffer }>()
  const calls: string[] = []
  let ids = 0, clock = 0
  const state = {
    revoked: false, hideRootsOnce: false, refreshes: 0, uploads: { multipart: 0, resumable: 0 }, media: 0, pieces: 0, ranges: 0,
    /** Scope a sign-in grants; a refresh waits on this gate when set. */
    grantScope: 'https://www.googleapis.com/auth/drive.file', refreshGate: null as Promise<void> | null,
    /** The next upload piece is cut off mid-way (a dropped connection). */
    cutNextPiece: false
  }
  const valid = new Set(['access-1'])
  const time = () => new Date(Date.UTC(2026, 10, 1) + clock++ * 1000).toISOString()
  const md5 = (bytes: Buffer) => createHash('md5').update(bytes).digest('hex')
  const meta = (file: Stored) => ({
    id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, createdTime: file.createdTime, modifiedTime: file.modifiedTime,
    trashed: file.trashed, ...(file.bytes ? { md5Checksum: md5(file.bytes), size: String(file.bytes.length) } : {})
  })
  const touched = (file: Stored) => log.push({ fileId: file.id, file: meta(file) })
  function put(fields: Partial<Stored> & { name: string; parents: string[] }): Stored {
    const now = time()
    const file: Stored = { id: `f${++ids}`, mimeType: 'application/octet-stream', createdTime: now, modifiedTime: now, trashed: false, ...fields }
    files.set(file.id, file)
    touched(file)
    return file
  }
  function update(id: string, fields: Partial<Stored>): Stored {
    const file = files.get(id)!
    Object.assign(file, fields, { modifiedTime: time() })
    touched(file)
    return file
  }
  /** `q` cut at `separator` outside brackets. */
  function split(q: string, separator: string): string[] {
    const parts: string[] = []
    let depth = 0, start = 0
    for (let i = 0; i < q.length; i++) {
      if ('({'.includes(q[i]!)) depth++
      else if (')}'.includes(q[i]!)) depth--
      else if (depth === 0 && q.startsWith(separator, i)) { parts.push(q.slice(start, i)); start = i + separator.length; i = start - 1 }
    }
    return [...parts, q.slice(start)]
  }
  /** `name = 'x'`, `mimeType = 'x'`, `'id' in parents`, `trashed = false`, `(app)properties has { key='k' and value='v' }`, joined by `and`, or by `or` in brackets. */
  function matches(file: Stored, q: string): boolean {
    return split(q, ' and ').every(clause => {
      if (clause.startsWith('(')) return split(clause.slice(1, -1), ' or ').some(part => matches(file, part))
      let m = /^name = '(.*)'$/.exec(clause)
      if (m) return file.name === m[1]
      if ((m = /^mimeType = '(.*)'$/.exec(clause))) return file.mimeType === m[1]
      if ((m = /^'(.*)' in parents$/.exec(clause))) return file.parents.includes(m[1] === 'root' ? 'ROOT' : m[1]!)
      if (clause === 'trashed = false') return !file.trashed
      if ((m = /^(properties|appProperties) has \{ key='(.*)' and value='(.*)' \}$/.exec(clause))) return file[m[1] as keyof Marks]?.[m[2]!] === m[3]
      throw new Error(`fake drive: ${clause}`)
    })
  }
  function multipart(body: Buffer, type: string): { metadata: Record<string, unknown>; bytes: Buffer } {
    const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(type)![1]}`)
    const first = body.indexOf('\r\n\r\n') + 4, second = body.indexOf(boundary, first)
    const metadata = JSON.parse(body.subarray(first, second - 2).toString()) as Record<string, unknown>
    const start = body.indexOf('\r\n\r\n', second) + 4, end = body.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary, Buffer.from('--')]), start)
    return { metadata, bytes: body.subarray(start, end) }
  }
  const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
  function write(id: string | null, metadata: Record<string, unknown>, bytes: Buffer) {
    if (id === null) return json(meta(put({ name: String(metadata.name), parents: metadata.parents as string[], bytes })))
    return json(meta(update(id, { bytes })))
  }

  async function fetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input)), method = init.method ?? 'GET'
    calls.push(`${method} ${url.origin}${url.pathname}${url.searchParams.has('alt') ? '?alt=media' : ''}${url.searchParams.has('uploadType') ? `?${url.searchParams.get('uploadType')}` : ''}`)
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const access = `access-${valid.size + 1}`
      if ((init.body as URLSearchParams).get('grant_type') === 'authorization_code') {
        valid.add(access)
        return json({ access_token: access, refresh_token: `refresh-${valid.size}`, expires_in: 3600, scope: state.grantScope })
      }
      state.refreshes++
      await state.refreshGate
      if (state.revoked) return json({ error: 'invalid_grant' }, { status: 400 })
      valid.add(access)
      return json({ access_token: access, expires_in: 3600 })
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') return new Response('')
    const bearer = new Headers(init.headers).get('authorization')?.replace('Bearer ', '') ?? ''
    if (!valid.has(bearer)) return json({ error: { errors: [{ reason: 'authError' }] } }, { status: 401 })
    const body = init.body === undefined || init.body === null ? Buffer.alloc(0) : Buffer.from(init.body as Uint8Array | string)
    const path = url.pathname.replace('/drive/v3', '').replace('/upload', '')
    const upload = url.origin + url.pathname.split('/files')[0] === UPLOAD
    if (path === '/about') return json({ user: { emailAddress: 'me@example.com' } })
    if (path === '/changes/startPageToken') return json({ startPageToken: String(log.length) })
    if (path === '/changes') {
      const from = Number(url.searchParams.get('pageToken')), size = Number(url.searchParams.get('pageSize') ?? 1000)
      const page = log.slice(from, from + size).map(change => ({ fileId: change.fileId, removed: false, file: change.file }))
      return json(from + size < log.length ? { changes: page, nextPageToken: String(from + size) } : { changes: page, newStartPageToken: String(log.length) })
    }
    const id = /^\/files\/([^/]+)$/.exec(path)?.[1] ?? null
    if (method === 'PUT') {
      // Resumable pieces: `bytes a-b/n` appends, `bytes */n` asks how much arrived; 308 until the last piece.
      const session = sessions.get(url.searchParams.get('upload_id')!)!
      const range = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(new Headers(init.headers).get('content-range') ?? '')!
      const total = Number(range[3])
      if (range[1] !== undefined) {
        state.pieces++
        if (Number(range[1]) !== session.received.length) return json({}, { status: 400 })
        if (state.cutNextPiece) {
          state.cutNextPiece = false
          session.received = Buffer.concat([session.received, body.subarray(0, body.length >> 1)])
          throw new TypeError('fetch failed')
        }
        session.received = Buffer.concat([session.received, body])
      }
      if (session.received.length < total) {
        return new Response(null, { status: 308, headers: session.received.length > 0 ? { range: `bytes=0-${session.received.length - 1}` } : {} })
      }
      return write(session.id, session.metadata, session.received)
    }
    if (upload) {
      const kind = url.searchParams.get('uploadType')!
      if (kind === 'multipart') {
        state.uploads.multipart++
        const { metadata, bytes } = multipart(body, new Headers(init.headers).get('content-type')!)
        return write(id, metadata, bytes)
      }
      state.uploads.resumable++
      const key = String(sessions.size + 1)
      sessions.set(key, { id, metadata: JSON.parse(body.toString()) as Record<string, unknown>, received: Buffer.alloc(0) })
      return new Response('', { headers: { location: `${UPLOAD}/files?uploadType=resumable&upload_id=${key}` } })
    }
    if (path === '/files' && method === 'GET') {
      if (state.hideRootsOnce && url.searchParams.get('q')?.includes('bandalRoot')) {
        state.hideRootsOnce = false
        return json({ files: [] })
      }
      const found = [...files.values()].filter(file => matches(file, url.searchParams.get('q') ?? ''))
      const from = Number(url.searchParams.get('pageToken') ?? 0), size = Number(url.searchParams.get('pageSize') ?? 100)
      const page = found.slice(from, from + size).map(meta)
      return json(from + size < found.length ? { files: page, nextPageToken: String(from + size) } : { files: page })
    }
    if (path === '/files' && method === 'POST') {
      const metadata = JSON.parse(body.toString()) as { name: string; mimeType: string; parents: string[] } & Marks
      return json(meta(put({ ...metadata, parents: metadata.parents.map(parent => (parent === 'root' ? 'ROOT' : parent)) })))
    }
    if (id && method === 'PATCH') return json(meta(update(id, JSON.parse(body.toString()) as Partial<Stored>)))
    if (id && url.searchParams.get('alt') === 'media') {
      state.media++
      const file = files.get(id)
      if (!file?.bytes) return json({}, { status: 404 })
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
      if (!range) return new Response(new Uint8Array(file.bytes))
      state.ranges++
      return new Response(new Uint8Array(file.bytes.subarray(Number(range[1]), Number(range[2]) + 1)), { status: 206 })
    }
    throw new Error(`fake drive: ${method} ${url.href}`)
  }

  return {
    fetch, files, state, calls, valid,
    /** A root another device made: marked in `properties` by default; `{}` for a folder with no mark at all. */
    folder: (name = 'Bandal', parent = 'ROOT', marks: Marks = { properties: { bandalRoot: '2' } }) => put({ name, parents: [parent], mimeType: FOLDER, ...marks }),
    file: (name: string, parent: string, bytes: Buffer) => put({ name, parents: [parent], bytes }),
    pathOf(id: string): string {
      const file = files.get(id)!
      return file.parents[0] === 'ROOT' ? file.name : `${this.pathOf(file.parents[0]!)}/${file.name}`
    },
    trash: (id: string) => update(id, { trashed: true })
  }
}

export type FakeDrive = ReturnType<typeof createFakeDrive>
export { API as DRIVE_API, FOLDER }
