/**
 * The signed-in person's Bandal workspace, read from their Google Drive sync
 * root. It uses the desktop's own parser and merge:
 * - `src/main/features/sync/format.ts` and `merge.ts`.
 * - `node:crypto`/`node:zlib` are replaced by the async-prepared shims in
 *   `web-app/shims`.
 * So every course, document, note and drawing resolves exactly as a desktop
 * pulling the same root would see it.
 *
 * Read-only: nothing here writes to Drive (web app phase 1). Writing would
 * make this browser a sync device with its own seq, clock and files
 * (spec 식별자와 시간).
 */
import { contentRef, isSpecPath, readRoot, type InkObject, type ParsedFile, type RemoteFile } from '../src/main/features/sync/format'
import { isAlive, merge, type Entity, type MergedState } from '../src/main/features/sync/merge'
import type { Course } from '../src/shared/types/course'
import type { Drive, DriveFile } from './drive'
import { prepareDigest } from './shims/node-crypto'
import { prepareGunzip } from './shims/node-zlib'

export interface WebDoc {
  id: string
  courseId: string
  /** Course-relative path: `rel_path/name` with collision renames applied. */
  relPath: string
  type: 'pdf' | 'md'
  /** PDF bytes' sha256: the document revision the renderer pins drawings to. */
  pdf: string | null
  /** Root path of the note snapshot holding the winning text. */
  noteFile: string | null
  size: number
  mtime: number
  addedAt: number
}

export interface Workspace {
  rootId: string
  courses: Course[]
  docs: Map<string, WebDoc>
  ink: Map<string, InkObject[]>
  files: Map<string, DriveFile>
  /** Files the spec rejects whole; every device ignores them alike. */
  errors: string[]
  /** Documents and drawings still waiting for something (a PDF, an asset) to arrive. */
  waiting: number
  devices: { name: string; platform: string | null; lastSeen: number | null }[]
}

export type LoadResult =
  | { status: 'ready'; workspace: Workspace }
  | { status: 'no-root' }
  | { status: 'blocked'; reason: NonNullable<MergedState['blocked']> }

export const docKey = (courseId: string, relPath: string): string => `${courseId}\u0000${relPath}`

const text = (entity: Entity | undefined, key: string): string | null => {
  const value = entity?.fields.get(key)?.value
  return typeof value === 'string' ? value : null
}
const latest = (entity: Entity): number => Math.max(0, ...[...entity.fields.values()].map(register => register.t))
const earliest = (entity: Entity): number => Math.min(...[...entity.fields.values()].map(register => register.t), Number.MAX_SAFE_INTEGER)
const COURSE_COLORS = new Set(['gold', 'green', 'blue', 'pink', 'violet', 'orange', 'red'])

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]!)
  }))
}

/**
 * Lists the root, reads every metadata, ink and note file, and merges. Files
 * are kept by md5 in `cache`, so a refresh only downloads what changed.
 */
export async function loadWorkspace(drive: Drive, cache: Map<string, { md5: string; bytes: Uint8Array }>, progress: (done: number, total: number) => void): Promise<LoadResult> {
  const rootId = await drive.findRoot()
  if (rootId === null) return { status: 'no-root' }
  const files = await drive.listRoot(rootId)
  const wanted = [...files.entries()].filter(([path]) => isSpecPath(path) && contentRef(path) === null)
  const content: ParsedFile[] = [...files.keys()].map(contentRef).filter((ref): ref is NonNullable<typeof ref> => ref !== null)
  const remote: RemoteFile[] = []
  let done = 0
  progress(0, wanted.length)
  await pool(wanted, 8, async ([path, file]) => {
    const version = file.md5Checksum ?? `${file.modifiedTime}:${file.size}`
    let cached = cache.get(path)
    if (cached?.md5 !== version) {
      cached = { md5: version, bytes: await drive.download(file) }
      cache.set(path, cached)
    }
    if (path.endsWith('.json.gz')) await prepareGunzip(cached.bytes)
    else if (path.endsWith('.md')) await prepareDigest(cached.bytes)
    remote.push({ path, bytes: cached.bytes })
    progress(++done, wanted.length)
  })
  for (const path of cache.keys()) if (!files.has(path)) cache.delete(path)

  const read = readRoot(remote)
  const merged = merge([...read.parsed, ...content])
  if (merged.blocked !== null) return { status: 'blocked', reason: merged.blocked }
  return { status: 'ready', workspace: model(rootId, merged, files, read.errors) }
}

function model(rootId: string, merged: MergedState, files: Map<string, DriveFile>, errors: string[]): Workspace {
  const courses: Course[] = []
  for (const [id, entity] of merged.courses) {
    if (!isAlive(entity)) continue
    const name = text(entity, 'name')?.trim()
    if (!name) continue
    const sort = entity.fields.get('sort')?.value, archived = entity.fields.get('archived')?.value
    const color = text(entity, 'color')?.trim() ?? ''
    const created = new Date(earliest(entity)).toISOString(), updated = new Date(latest(entity)).toISOString()
    courses.push({
      id, name, slug: id, color: COURSE_COLORS.has(color) ? color : 'gold', folderPath: 'Google Drive › Bandal', source: 'managed', missing: false,
      archived: archived === true, groupId: null, sortOrder: typeof sort === 'number' && Number.isFinite(sort) ? sort : 0, createdAt: created, updatedAt: updated
    })
  }
  courses.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))
  const liveCourses = new Set(courses.map(course => course.id))
  const renamed = new Map(merged.renames.map(rename => [rename.id, rename.name]))
  const waiting = new Set(merged.waiting.docs)
  const docs = new Map<string, WebDoc>()
  const sizeOf = (path: string | null): number => Number(path === null ? 0 : files.get(path)?.size ?? 0) || 0
  const place = (doc: WebDoc): void => {
    const key = docKey(doc.courseId, doc.relPath)
    // Collision renames already make live paths unique; a clash left over is a device's bug, keep the smaller id.
    const other = docs.get(key)
    if (!other || doc.id < other.id) docs.set(key, doc)
  }
  for (const [id, entity] of merged.docs) {
    if (!isAlive(entity) || waiting.has(id)) continue
    const courseId = text(entity, 'course_id'), folder = text(entity, 'rel_path'), type = text(entity, 'type')
    const name = renamed.get(id) ?? text(entity, 'name')
    if (!courseId || !liveCourses.has(courseId) || folder === null || !name || (type !== 'pdf' && type !== 'md')) continue
    const pdf = type === 'pdf' ? text(entity, 'pdf_sha256') : null
    const noteFile = type === 'md' ? merged.notes.get(id)?.file ?? null : null
    if (type === 'md' && noteFile === null) continue
    place({
      id, courseId, relPath: folder ? `${folder}/${name}` : name, type, pdf, noteFile,
      size: sizeOf(type === 'pdf' ? `pdf/${pdf}.pdf` : noteFile), mtime: latest(entity), addedAt: earliest(entity)
    })
  }
  for (const copy of merged.conflictCopies) {
    if (!liveCourses.has(copy.course_id)) continue
    const parent = merged.docs.get(copy.of)
    const stamp = parent ? latest(parent) : 0
    place({ id: copy.id, courseId: copy.course_id, relPath: copy.rel_path ? `${copy.rel_path}/${copy.name}` : copy.name, type: 'md', pdf: null, noteFile: copy.file, size: sizeOf(copy.file), mtime: stamp, addedAt: stamp })
  }
  const waitingInk = new Set(merged.waiting.ink)
  const ink = new Map<string, InkObject[]>()
  for (const [id, { value }] of merged.ink) {
    if (waitingInk.has(id) || value.object.del) continue
    const list = ink.get(value.doc)
    if (list) list.push(value.object)
    else ink.set(value.doc, [value.object])
  }
  for (const list of ink.values()) list.sort((a, b) => (a.created ?? a.t) - (b.created ?? b.t) || (a.id < b.id ? -1 : 1))
  const devices = [...merged.devices.values()].map(device => ({ name: device.name, platform: device.platform, lastSeen: device.last_seen }))
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  return { rootId, courses, docs, ink, files, errors, waiting: merged.waiting.docs.length + merged.waiting.ink.length + merged.waiting.copies.length, devices }
}
