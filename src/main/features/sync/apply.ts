/**
 * Applies a merged root to this profile (design 2.7, 3.2–3.6): courses, pdf
 * and md documents with their files, drawings and conflict copies.
 *
 * Every value is compared with the base, what this device last synced
 * (sync_meta, sync_docs, sync_ink). A remote value older than the base means
 * the root is missing files, not that it changed, and is ignored. A local
 * change that has not been exported yet is left alone: its export carries a t
 * larger than any remote t seen, so it wins anyway. Database writes run with
 * sync_runtime.applying set, so the outbox triggers stay quiet.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, type Stats } from 'node:fs'
import { dirname } from 'node:path'
import type { Database } from 'better-sqlite3'
import { ConflictError, NotFoundError } from '../../db/errors'
import { resolveInsideReal } from '../../db/validate'
import { writeFileAtomic } from '../../lib/atomicWrite'
import type { CoursesRepo } from '../courses/coursesRepo'
import type { MaterialsRepo } from '../materials/materialsRepo'
import { importInkObject, type AssetRef, type DrawingRow } from './adapter'
import { sha256 } from './format'
import { diskKey, type SyncDocRow } from './localDocs'
import { collisionName, isAlive, type Entity, type MergedState, type Register } from './merge'

export interface ApplyContext {
  db: Database
  courses: Pick<CoursesRepo, 'create' | 'rename' | 'setColor' | 'archive' | 'softDelete' | 'restore'>
  /** Journaled moves and the OS trash, so drawings, links and PDF identity follow a file. */
  materials: Pick<MaterialsRepo, 'move' | 'rename' | 'softDelete'>
  /** Reads a root file: `pdf/…`, `assets/…` or a note snapshot. */
  read(path: string): Promise<Uint8Array>
  platform?: NodeJS.Platform
}

export interface ApplyResult {
  /** Courses whose rows, files or drawings changed, for renderer refreshes. */
  changed: string[]
  /** Courses this pass deleted or archived: the caller stops their recordings, watchers and sessions as the IPC handlers do. */
  removed: string[]
  /** Ids left for a later pass, and why. */
  held: { id: string; reason: string }[]
}

export interface Stamped { value: unknown; t: number | null; device: string | null }
export type Base = Map<string, Stamped>
export type DocType = 'pdf' | 'md'

interface RemoteDoc {
  course_id: string
  rel_path: string
  /** File name here: a path-collision rename stands in for the synced name. */
  name: string
  type: DocType
  hash: string
  /** PDF only: the bytes `hash` was appended to, from the same event (spec v2.3); null otherwise. */
  prev: string | null
  /** Root path of the bytes, `pdf/<sha>.pdf` or a note snapshot; null until it arrives. */
  content: string | null
  /** Synced values with their stamps, the base once applied; `name` is the spec name before any collision rename. */
  fields: Record<string, Stamped>
}
type RemoteState = RemoteDoc | { deleted: Stamped }

const NOTE_ASSET = /\.\.\/\.\.\/assets\/([0-9a-f]{64})\.([a-z0-9]{1,16})/g
const HOSTILE = /[\\:*?"<>|]/g
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i
const MAX_NAME = 120
const EXTENSION: Record<DocType, RegExp> = { pdf: /\.pdf$/i, md: /\.(md|markdown)$/i }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const hasTable = (db: Database, name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
const stamped = (register: Register | null | undefined): Stamped | undefined =>
  register ? { value: register.value, t: register.t, device: register.device } : undefined
/** Every device computes a derived value the same way, so it has no stamp. */
const derived = (value: unknown): Stamped => ({ value, t: null, device: null })
export const samePlace = (a: string, b: string): boolean => diskKey(a) === diskKey(b)
export const split = (path: string): { dir: string; name: string } => {
  const slash = path.lastIndexOf('/')
  return { dir: slash < 0 ? '' : path.slice(0, slash), name: path.slice(slash + 1) }
}

/** Older than what this device already synced: the root is missing files, not changed. */
function older(next: Stamped | undefined, base: Stamped | undefined): boolean {
  if (next === undefined || base === undefined || next.t === null || base.t === null) return false
  return next.t !== base.t ? next.t < base.t : (next.device ?? '') < (base.device ?? '')
}

/**
 * One spec path segment as a name the app accepts (materials requireBasename):
 * `\ : * ? " < > |` become fullwidth, a leading dot or space and a trailing dot
 * or space go (the scanner hides dot entries, Windows drops trailing dots), at
 * most 120 characters, and a Windows device name gets a `_` in front.
 */
function localSegment(segment: string, platform: NodeJS.Platform): string {
  let name = segment.replace(HOSTILE, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0))
    .replace(/^[\s.]+/, '').replace(/[\s.]+$/, '') || '_'
  if (platform === 'win32' && WINDOWS_DEVICE.test(name)) name = `_${name}`
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf('.'), ext = dot > 0 && name.length - dot <= 17 ? name.slice(dot) : ''
    name = name.slice(0, MAX_NAME - ext.length).replace(/[\uD800-\uDBFF]$/, '') + ext
  }
  return name
}

/** Course-relative local path of a spec folder and name; the file keeps or gains its type's extension so scans track it. */
export function localPath(relPath: string, name: string, type: DocType, platform: NodeJS.Platform = process.platform): string {
  const dirs = relPath === '' ? [] : relPath.split('/').map(segment => localSegment(segment, platform))
  const file = localSegment(name, platform)
  return [...dirs, EXTENSION[type].test(file) ? file : localSegment(`${file}.${type}`, platform)].join('/')
}

/** Database writes of a remote apply: the outbox triggers stay quiet. */
function silently<T>(db: Database, write: () => T): T {
  return db.transaction(() => {
    db.prepare('UPDATE sync_runtime SET applying = 1').run()
    try {
      return write()
    } finally {
      db.prepare('UPDATE sync_runtime SET applying = 0').run()
    }
  })()
}

export function readBase(db: Database, id: string): Base {
  const rows = db.prepare('SELECT field, value_json, t, device_id FROM sync_meta WHERE entity_id = ?').all(id) as
    { field: string; value_json: string; t: number | null; device_id: string | null }[]
  return new Map(rows.map(row => [row.field, { value: JSON.parse(row.value_json) as unknown, t: row.t, device: row.device_id }]))
}

export function writeBase(db: Database, kind: 'course' | 'doc', id: string, values: Record<string, Stamped>): void {
  const upsert = db.prepare(`INSERT INTO sync_meta (kind, entity_id, field, value_json, t, device_id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (entity_id, field) DO UPDATE SET value_json = excluded.value_json, t = excluded.t, device_id = excluded.device_id`)
  for (const [field, item] of Object.entries(values)) upsert.run(kind, id, field, JSON.stringify(item.value), item.t, item.device)
}

/**
 * Per field: apply a remote change this device has not touched, settle the
 * base where both sides already agree, and skip a field changed here (its
 * export wins later) or a remote value older than the base.
 */
function threeWay(remote: Record<string, Stamped>, local: Record<string, unknown>, base: Base): { apply: Record<string, unknown>; settled: Record<string, Stamped> } {
  const apply: Record<string, unknown> = {}, settled: Record<string, Stamped> = {}
  for (const [key, next] of Object.entries(remote)) {
    const was = base.get(key)
    if (older(next, was)) continue
    if (same(local[key], next.value)) {
      if (!same(was, next)) settled[key] = next
    } else if (was !== undefined && same(local[key], was.value)) {
      apply[key] = next.value
      settled[key] = next
    }
  }
  return { apply, settled }
}

/** Folder of a course this device syncs and still shows; null otherwise. */
export function liveFolder(db: Database, courseId: string): string | null {
  const row = db.prepare(`SELECT folder_path FROM courses WHERE id = ? AND deleted_at IS NULL
    AND source = 'managed' AND workspace_kind = 'course'`).get(courseId) as { folder_path: string } | undefined
  return row?.folder_path ?? null
}

interface CourseRow { name: string; color: string; sort_order: number; archived: number; deleted_at: string | null; source: string; workspace_kind: string; folder_path: string }

function courseRemote(id: string, entity: Entity, holding: ReadonlySet<unknown>): Record<string, Stamped> {
  const remote: Record<string, Stamped> = {}
  for (const key of ['name', 'sort', 'color', 'archived']) {
    const field = stamped(entity.fields.get(key))
    // The repository trims names and colours: compare what it would store.
    if (field) remote[key] = typeof field.value === 'string' ? { ...field, value: field.value.trim() } : field
  }
  // A deleted course that still holds live documents stays (P8).
  const deleted = stamped(entity.deleted)
  if (deleted) remote.deleted = { ...deleted, value: deleted.value === true && !holding.has(id) }
  return remote
}

/**
 * `upsert` runs before documents: new courses, field changes and restores.
 * `remove` runs after them, so a course goes only once its documents went,
 * and stays while files edited here still hold it.
 */
function applyCourses(merged: MergedState, ctx: ApplyContext, result: ApplyResult, phase: 'upsert' | 'remove'): void {
  const { db } = ctx
  const holding = new Set<unknown>([...merged.docs.values()].filter(isAlive).map(doc => doc.fields.get('course_id')?.value))
  for (const copy of merged.conflictCopies) holding.add(copy.course_id)
  for (const [id, entity] of merged.courses) {
    const remote = courseRemote(id, entity, holding)
    const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined
    try {
      if (phase === 'upsert' && row === undefined) createCourse(id, remote, ctx, result)
      else if (row === undefined || row.source !== 'managed' || row.workspace_kind !== 'course') continue
      else if (phase === 'upsert') updateCourse(id, row, remote, ctx, result)
      else removeCourse(id, row, remote, ctx, result)
    } catch (error) {
      result.held.push({ id, reason: message(error) })
    }
  }
}

function createCourse(id: string, remote: Record<string, Stamped>, ctx: ApplyContext, result: ApplyResult): void {
  const name = remote.name?.value, color = remote.color?.value, sort = remote.sort?.value
  if (remote.deleted?.value !== false) return
  if (typeof name !== 'string' || name === '') {
    result.held.push({ id, reason: 'course has no name yet' })
    return
  }
  silently(ctx.db, () => {
    ctx.courses.create({ name, color: typeof color === 'string' && color !== '' ? color : 'gold' },
      { id, archived: remote.archived?.value === true, ...(typeof sort === 'number' ? { sortOrder: sort } : {}) })
    writeBase(ctx.db, 'course', id, remote)
  })
  result.changed.push(id)
}

function updateCourse(id: string, row: CourseRow, remote: Record<string, Stamped>, ctx: ApplyContext, result: ApplyResult): void {
  const { deleted, ...fields } = remote
  const local = { name: row.name, sort: row.sort_order, color: row.color, archived: row.archived === 1, deleted: row.deleted_at !== null }
  const { apply, settled } = threeWay(deleted?.value === true ? fields : remote, local, readBase(ctx.db, id))
  if (Object.keys(settled).length === 0) return
  silently(ctx.db, () => {
    if (apply.deleted === false) {
      mkdirSync(row.folder_path, { recursive: true })
      ctx.courses.restore({ courseId: id })
    }
    if (typeof apply.name === 'string') ctx.courses.rename({ courseId: id, name: apply.name })
    if (typeof apply.color === 'string') ctx.courses.setColor({ courseId: id, color: apply.color })
    // Restoring also un-archives; an archived course stays archived unless the remote says otherwise.
    const archived = apply.archived ?? (apply.deleted === false && row.archived === 1 ? true : undefined)
    if (typeof archived === 'boolean') ctx.courses.archive({ courseId: id, archived })
    if (typeof apply.sort === 'number') ctx.db.prepare('UPDATE courses SET sort_order = ? WHERE id = ?').run(apply.sort, id)
    writeBase(ctx.db, 'course', id, settled)
  })
  if (Object.keys(apply).length > 0) result.changed.push(id)
  if (apply.archived === true) result.removed.push(id)
}

function removeCourse(id: string, row: CourseRow, remote: Record<string, Stamped>, ctx: ApplyContext, result: ApplyResult): void {
  const { deleted } = remote
  if (deleted?.value !== true) return
  if (ctx.db.prepare('SELECT 1 FROM sync_docs WHERE course_id = ? AND local_hash IS NOT NULL LIMIT 1').get(id)) return
  const base = readBase(ctx.db, id)
  // A field changed here and not exported yet: its upsert outranks this delete by t once it goes, so the course stays for it.
  const local = { name: row.name, sort: row.sort_order, color: row.color, archived: row.archived === 1 }
  if (Object.entries(local).some(([key, value]) => base.has(key) && !same(base.get(key)!.value, value))) return
  const { apply, settled } = threeWay({ deleted }, { deleted: row.deleted_at !== null }, base)
  if (Object.keys(settled).length === 0) return
  silently(ctx.db, () => {
    if (apply.deleted === true) ctx.courses.softDelete({ courseId: id })
    writeBase(ctx.db, 'course', id, settled)
  })
  if (apply.deleted === true) {
    result.changed.push(id)
    result.removed.push(id)
  }
}

/** Alive documents with a place and content, conflict copies, and deletions. A document missing a field waits for it. */
function remoteDocs(merged: MergedState): Map<string, RemoteState> {
  const docs = new Map<string, RemoteState>()
  const renamed = new Map(merged.renames.map(rename => [rename.id, rename.name]))
  for (const [id, entity] of merged.docs) {
    const deleted = stamped(entity.deleted)!
    if (!isAlive(entity)) {
      docs.set(id, { deleted })
      continue
    }
    const fields: Record<string, Stamped> = { deleted, copy: derived(false) }
    for (const key of ['course_id', 'rel_path', 'name', 'type']) {
      const field = stamped(entity.fields.get(key))
      if (field) fields[key] = field
    }
    const type = fields.type?.value, { course_id, rel_path, name } = fields
    const hash = stamped(entity.fields.get(type === 'pdf' ? 'pdf_sha256' : 'md_hash'))
    if (typeof course_id?.value !== 'string' || typeof rel_path?.value !== 'string' || typeof name?.value !== 'string' ||
      (type !== 'pdf' && type !== 'md') || typeof hash?.value !== 'string') continue
    const prev = type === 'pdf' ? entity.fields.get('pdf_prev_sha256')?.value : null
    docs.set(id, {
      course_id: course_id.value, rel_path: rel_path.value, name: renamed.get(id) ?? name.value, type, hash: hash.value,
      prev: typeof prev === 'string' ? prev : null,
      content: type === 'pdf' ? `pdf/${hash.value}.pdf` : merged.notes.get(id)?.file ?? null, fields: { ...fields, hash }
    })
  }
  // A copy that stops being computed (its version is no longer a head, or a file is missing from the root) stays here:
  // the two cannot be told apart, and its text is in the root's history either way.
  for (const copy of merged.conflictCopies) {
    docs.set(copy.id, {
      course_id: copy.course_id, rel_path: copy.rel_path, name: copy.name, type: 'md', hash: copy.md_hash, prev: null, content: copy.file,
      fields: {
        course_id: derived(copy.course_id), rel_path: derived(copy.rel_path), name: derived(copy.name), type: derived('md'),
        hash: derived(copy.md_hash), deleted: derived(false), copy: derived(true)
      }
    })
  }
  return docs
}

export async function hashFile(abs: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** The local file still holds the bytes last synced: returns how it looked when checked, else null. */
async function untouchedContent(folder: string, row: SyncDocRow): Promise<Stats | null> {
  const abs = resolveInsideReal(folder, row.local_path)
  if (row.synced_hash === null || !existsSync(abs)) return null
  const info = statSync(abs)
  if (row.local_hash === row.synced_hash && info.size === row.local_size && Math.round(info.mtimeMs) === row.local_mtime) return info
  return (await hashFile(abs)) === row.synced_hash ? info : null
}

/** For writeFileAtomic: refuse to publish over a file edited after `seen`, or over one that appeared since the check. */
const unchangedSince = (abs: string, seen: Stats | null) => (): void => {
  const now = existsSync(abs) ? statSync(abs) : null
  if (seen === null ? now !== null : now === null || now.size !== seen.size || now.mtimeMs !== seen.mtimeMs) {
    throw new ConflictError(`${abs} changed while syncing`)
  }
}

/** Where the base puts this document here: its course, folder and the names it may carry (its own, or a path collision's). */
export function basePlace(base: Base, id: string, type: DocType, platform: NodeJS.Platform | undefined): { course: unknown; dir: string; names: string[] } | null {
  const rel = base.get('rel_path')?.value, name = base.get('name')?.value
  if (typeof rel !== 'string' || typeof name !== 'string') return null
  const own = split(localPath(rel, name, type, platform))
  return { course: base.get('course_id')?.value, dir: own.dir, names: [own.name, split(localPath(rel, collisionName(name, id), type, platform)).name] }
}

export function untouchedPlace(row: SyncDocRow, was: ReturnType<typeof basePlace>): boolean {
  const have = split(row.local_path)
  return was !== null && row.course_id === was.course && samePlace(have.dir, was.dir) && was.names.some(name => samePlace(have.name, name))
}

export function getRow(db: Database, id: string): SyncDocRow | undefined {
  return db.prepare('SELECT * FROM sync_docs WHERE document_id = ?').get(id) as SyncDocRow | undefined
}

function record(db: Database, id: string, courseId: string, path: string, abs: string, hash: string): void {
  const info = statSync(abs)
  db.prepare(`INSERT INTO sync_docs (document_id, course_id, local_path, local_hash, local_size, local_mtime, synced_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (document_id) DO UPDATE SET course_id = excluded.course_id, local_path = excluded.local_path, local_hash = excluded.local_hash,
      local_size = excluded.local_size, local_mtime = excluded.local_mtime, synced_hash = excluded.synced_hash, missing_since = NULL`)
    .run(id, courseId, path, hash, info.size, Math.round(info.mtimeMs), hash)
}

/**
 * D6 (spec v2.3): a page appended elsewhere to the bytes this device's drawings
 * are bound to carries the binding to the new bytes. Any other new bytes leave
 * it, so the viewer keeps protecting the drawings from the changed original.
 */
function rebind(db: Database, doc: RemoteDoc, courseId: string, path: string): void {
  if (doc.prev === null || !hasTable(db, 'pdf_document_bindings')) return
  db.prepare(`UPDATE pdf_document_bindings SET bound_sha = ?, evidence = 'sync' WHERE bound_sha = ? AND material_id =
    (SELECT material_id FROM pdf_document_aliases WHERE course_id = ? AND rel_path = ?)`).run(doc.hash, doc.prev, courseId, path)
}

/** Root asset `assets/<sha>.<ext>` in the course's `assets/` folder; the name is the content, so a file there is it. */
async function ensureAsset(ctx: ApplyContext, folder: string, sha: string, ext: string): Promise<void> {
  const relPath = `assets/${sha}.${ext}`, abs = resolveInsideReal(folder, relPath)
  if (existsSync(abs)) return
  const bytes = await ctx.read(relPath)
  if (sha256(bytes) !== sha) throw new Error(`${relPath} does not match its hash`)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileAtomic(abs, Buffer.from(bytes))
}

/** The bytes a document has here: a note's asset links point at the course's `assets/` folder, as the editor saves them. */
async function localBytes(ctx: ApplyContext, doc: RemoteDoc, folder: string): Promise<Buffer> {
  if (doc.content === null) throw new Error('content has not arrived')
  const bytes = Buffer.from(await ctx.read(doc.content))
  if (sha256(bytes) !== doc.hash) throw new Error(`${doc.content} does not match its hash`)
  if (doc.type === 'pdf') return bytes
  const text = bytes.toString('utf8'), links = [...text.matchAll(NOTE_ASSET)]
  if (links.length === 0) return bytes
  for (const [, sha, ext] of links) await ensureAsset(ctx, folder, sha!, ext!)
  return Buffer.from(text.replace(NOTE_ASSET, 'assets/$1.$2'), 'utf8')
}

/** Whether another tracked document's file is this path on disk. */
function claimed(db: Database, courseId: string, path: string, id: string): boolean {
  return (db.prepare('SELECT document_id, local_path FROM sync_docs WHERE course_id = ?').all(courseId) as { document_id: string; local_path: string }[])
    .some(other => other.document_id !== id && samePlace(other.local_path, path))
}

/** `이름 (2).확장자`: the first name that no file and no tracked document holds. */
function freePath(db: Database, courseId: string, folder: string, path: string, id: string): string {
  const { dir, name } = split(path), dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${dir === '' ? '' : `${dir}/`}${stem} (${n})${ext}`
    if (!existsSync(resolveInsideReal(folder, candidate)) && !claimed(db, courseId, candidate, id)) return candidate
  }
}

/**
 * Writes a document's bytes into a course at `preferred`, or at a free name
 * next to it when another file holds that place. A file already there with
 * these bytes and no other owner is this document: an interrupted pass, or
 * the same file added on both sides.
 */
async function arrive(id: string, doc: RemoteDoc, folder: string, bytes: Buffer, preferred: string, ctx: ApplyContext): Promise<{ path: string; abs: string; digest: string }> {
  const { db } = ctx, digest = sha256(bytes)
  let path = preferred, abs = resolveInsideReal(folder, path)
  const taken = claimed(db, doc.course_id, path, id), exists = existsSync(abs)
  const adopt = !taken && exists && (await hashFile(abs)) === digest
  if (!adopt && (exists || taken)) {
    path = freePath(db, doc.course_id, folder, path, id)
    abs = resolveInsideReal(folder, path)
  }
  if (!adopt) {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileAtomic(abs, bytes, { beforePublish: unchangedSince(abs, null) })
  }
  return { path, abs, digest }
}

/** A document this device does not have yet, or one an interrupted pass started. */
async function place(id: string, doc: RemoteDoc, pending: SyncDocRow | undefined, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const { db } = ctx
  const folder = liveFolder(db, doc.course_id)
  if (folder === null) {
    result.held.push({ id, reason: 'course is not here' })
    return
  }
  const bytes = await localBytes(ctx, doc, folder)
  let preferred = pending?.course_id === doc.course_id ? pending.local_path : localPath(doc.rel_path, doc.name, doc.type, ctx.platform)
  if (claimed(db, doc.course_id, preferred, id)) preferred = freePath(db, doc.course_id, folder, preferred, id)
  // The row comes first: a crash before the write leaves a pending row that the next pass completes.
  silently(db, () => db.prepare(`INSERT INTO sync_docs (document_id, course_id, local_path) VALUES (?, ?, ?)
    ON CONFLICT (document_id) DO UPDATE SET course_id = excluded.course_id, local_path = excluded.local_path, local_hash = NULL`)
    .run(id, doc.course_id, preferred))
  const { path, abs, digest } = await arrive(id, doc, folder, bytes, preferred, ctx)
  silently(db, () => {
    record(db, id, doc.course_id, path, abs, digest)
    writeBase(db, 'doc', id, doc.fields)
  })
  result.changed.push(doc.course_id)
}

/**
 * Into another course: the bytes arrive there first, then the row, drawings,
 * highlights and PDF identity move in one transaction, and only then does the
 * old file go to the trash.
 */
async function moveAcross(id: string, doc: RemoteDoc, row: SyncDocRow, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const { db } = ctx
  const from = liveFolder(db, row.course_id), to = liveFolder(db, doc.course_id)
  if (from === null || to === null) {
    result.held.push({ id, reason: 'course is not here' })
    return
  }
  if (!(await untouchedContent(from, row))) return
  const bytes = await localBytes(ctx, doc, to)
  const { path, abs, digest } = await arrive(id, doc, to, bytes, localPath(doc.rel_path, doc.name, doc.type, ctx.platform), ctx)
  const latest = getRow(db, id)
  if (latest?.course_id !== row.course_id || latest.local_path !== row.local_path) return
  const aliases = hasTable(db, 'pdf_document_aliases')
  silently(db, () => {
    record(db, id, doc.course_id, path, abs, digest)
    for (const table of ['pdf_drawings', 'annotations', ...(aliases ? ['pdf_document_aliases'] : [])]) {
      db.prepare(`UPDATE OR REPLACE ${table} SET course_id = ?, rel_path = ? WHERE course_id = ? AND rel_path = ?`).run(doc.course_id, path, row.course_id, row.local_path)
    }
    rebind(db, doc, doc.course_id, path)
    writeBase(db, 'doc', id, doc.fields)
  })
  await trash(row, ctx)
  result.changed.push(row.course_id, doc.course_id)
}

/** Moves a file through the materials journal toward `want`, folder and name separately; returns where it ended up. */
async function relocate(row: SyncDocRow, want: { dir: string; name: string }, was: NonNullable<ReturnType<typeof basePlace>>,
  allowed: { dir: boolean; name: boolean }, folder: string, ctx: ApplyContext): Promise<string> {
  let path = row.local_path
  const have = split(path)
  if (allowed.dir && !samePlace(have.dir, want.dir) && samePlace(have.dir, was.dir)) {
    if (want.dir !== '') mkdirSync(resolveInsideReal(folder, want.dir), { recursive: true })
    path = (await ctx.materials.move({ courseId: row.course_id, fromRelPath: path, toDirRelPath: want.dir })).relPath
  }
  const now = split(path)
  if (allowed.name && !samePlace(now.name, want.name) && was.names.some(name => samePlace(now.name, name))) {
    try {
      path = (await ctx.materials.rename({ courseId: row.course_id, relPath: path, newName: want.name })).relPath
    } catch (error) {
      // Another file holds the name here; the next pass tries again.
      if (!(error instanceof ConflictError)) throw error
    }
  }
  if (path !== row.local_path) silently(ctx.db, () => ctx.db.prepare('UPDATE sync_docs SET local_path = ? WHERE document_id = ?').run(path, row.document_id))
  return path
}

async function trash(row: Pick<SyncDocRow, 'course_id' | 'local_path'>, ctx: ApplyContext): Promise<void> {
  try {
    await ctx.materials.softDelete({ courseId: row.course_id, relPath: row.local_path })
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
  }
}

async function applyDeleted(id: string, deleted: Stamped, row: SyncDocRow | undefined, base: Base, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const { db } = ctx
  if (older(deleted, base.get('deleted'))) return
  if (row !== undefined && row.local_hash !== null) {
    const folder = liveFolder(db, row.course_id)
    const type = base.get('type')?.value === 'pdf' || /\.pdf$/i.test(row.local_path) ? 'pdf' : 'md'
    // A file moved or edited here since the last sync stays: its export brings the document back.
    if (folder === null || !untouchedPlace(row, basePlace(base, id, type, ctx.platform)) || !(await untouchedContent(folder, row))) return
    await trash(row, ctx)
    result.changed.push(row.course_id)
  } else if (row === undefined && same(base.get('deleted'), deleted)) return
  silently(db, () => {
    db.prepare('DELETE FROM sync_docs WHERE document_id = ?').run(id)
    writeBase(db, 'doc', id, { deleted })
  })
}

/** New bytes for a file untouched since the last sync; false when it was edited, moved or renamed here meanwhile. */
async function replaceContent(id: string, doc: RemoteDoc, path: string, folder: string, ctx: ApplyContext): Promise<boolean> {
  const { db } = ctx
  const before = getRow(db, id)
  if (before?.local_path !== path || !(await untouchedContent(folder, before))) return false
  const bytes = await localBytes(ctx, doc, folder)
  // Reading may have taken a while: check again right before the write, and once more at its last step.
  const latest = getRow(db, id)
  const seen = latest?.local_path === path ? await untouchedContent(folder, latest) : null
  if (seen === null) return false
  const abs = resolveInsideReal(folder, path)
  writeFileAtomic(abs, bytes, { beforePublish: unchangedSince(abs, seen) })
  silently(db, () => {
    record(db, id, doc.course_id, path, abs, sha256(bytes))
    rebind(db, doc, doc.course_id, path)
  })
  return true
}

async function applyDoc(id: string, doc: RemoteState, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const { db } = ctx
  const row = getRow(db, id), base = readBase(db, id)
  if (!('course_id' in doc)) return applyDeleted(id, doc.deleted, row, base, ctx, result)
  if (older(doc.fields.deleted, base.get('deleted'))) return
  if (row === undefined) {
    // Gone from here while the base says alive: deleted here, and that export comes first.
    if (base.get('deleted')?.value === false) return
    return place(id, doc, undefined, ctx, result)
  }
  if (row.local_hash === null) return place(id, doc, row, ctx, result)
  // Tracked here but never synced: this device's own export comes first.
  if (base.size === 0) return

  const was = basePlace(base, id, doc.type, ctx.platform)
  if (was === null || row.course_id !== was.course) return
  if (row.course_id !== doc.course_id) {
    if (untouchedPlace(row, was) && !older(doc.fields.course_id, base.get('course_id'))) await moveAcross(id, doc, row, ctx, result)
    return
  }
  const folder = liveFolder(db, row.course_id)
  if (folder === null) return
  const want = split(localPath(doc.rel_path, doc.name, doc.type, ctx.platform))
  const allowed = { dir: !older(doc.fields.rel_path, base.get('rel_path')), name: !older(doc.fields.name, base.get('name')) }
  const path = await relocate(row, want, was, allowed, folder, ctx)
  if (path !== row.local_path) result.changed.push(row.course_id)
  const settled: Record<string, Stamped> = { course_id: doc.fields.course_id!, type: doc.fields.type!, deleted: doc.fields.deleted!, copy: doc.fields.copy! }
  if (samePlace(split(path).dir, want.dir)) settled.rel_path = doc.fields.rel_path!
  // A name settles only where the disk holds exactly it: a remote rename that only changes case is not applied on a
  // disk that ignores case, and settling it anyway would have the export send the old spelling back.
  if (split(path).name.normalize('NFC') === want.name.normalize('NFC')) settled.name = doc.fields.name!

  const baseHash = base.get('hash')
  if (doc.hash === baseHash?.value) settled.hash = doc.fields.hash!
  else if (!older(doc.fields.hash, baseHash) && await replaceContent(id, doc, path, folder, ctx)) {
    settled.hash = doc.fields.hash!
    result.changed.push(row.course_id)
  }
  const changes = Object.entries(settled).filter(([key, value]) => !older(value, base.get(key)) && !same(value, base.get(key)))
  if (changes.length > 0) silently(db, () => writeBase(db, 'doc', id, Object.fromEntries(changes)))
}

async function applyDocs(merged: MergedState, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const waiting = new Set([...merged.waiting.docs, ...merged.waiting.copies])
  const tracked = (id: string): boolean => !!ctx.db.prepare('SELECT 1 FROM sync_docs WHERE document_id = ? AND local_hash IS NOT NULL').get(id)
  // Deletions free their paths first; documents already here move before new ones arrive.
  const order = [...remoteDocs(merged)]
    .filter(([id, doc]) => !('course_id' in doc) || !waiting.has(id))
    .map(([id, doc]) => ({ id, doc, rank: !('course_id' in doc) ? 0 : tracked(id) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1))
  for (const { id, doc } of order) {
    try {
      await applyDoc(id, doc, ctx, result)
    } catch (error) {
      result.held.push({ id, reason: message(error) })
    }
  }
}

/** A row's current image when it holds these bytes, else the synced copy in `assets/`; null if neither is here. */
function imagePath(folder: string, row: DrawingRow | undefined, asset: AssetRef): string | null {
  const current = row ? (JSON.parse(row.data_json) as { image?: { relPath?: unknown } }).image?.relPath : undefined
  for (const relPath of [current, `assets/${asset.sha256}.${asset.ext}`]) {
    if (typeof relPath !== 'string') continue
    try {
      if (sha256(readFileSync(resolveInsideReal(folder, relPath))) === asset.sha256) return relPath
    } catch {
      // Not here: try the next place.
    }
  }
  return null
}

async function applyInk(merged: MergedState, ctx: ApplyContext, result: ApplyResult): Promise<void> {
  const { db } = ctx
  const waiting = new Set(merged.waiting.ink)
  for (const [id, winner] of merged.ink) {
    if (waiting.has(id)) continue
    const { doc, object } = winner.value
    const base = db.prepare('SELECT t, device_id, updated_at FROM sync_ink WHERE id = ?').get(id) as { t: number; device_id: string; updated_at: string | null } | undefined
    const next = { value: null, t: winner.t, device: winner.device }, was = base && { value: null, t: base.t, device: base.device_id }
    if (was && (older(next, was) || same(next, was))) continue
    const at = db.prepare('SELECT course_id, local_path FROM sync_docs WHERE document_id = ? AND local_hash IS NOT NULL').get(doc) as { course_id: string; local_path: string } | undefined
    const folder = at && /\.pdf$/i.test(at.local_path) ? liveFolder(db, at.course_id) : null
    // Drawings of a document that is not here wait for it (M22).
    if (!at || folder === null) continue
    const row = db.prepare('SELECT * FROM pdf_drawings WHERE id = ?').get(id) as DrawingRow | undefined
    // Edited here since the last sync: the export after this pass wins.
    if (row && (base ? row.updated_at !== base.updated_at : Date.parse(row.updated_at) > object.t)) continue
    try {
      const image = object.del ? undefined : object.data?.image as AssetRef | undefined
      if (image && imagePath(folder, row, image) === null) await ensureAsset(ctx, folder, image.sha256, image.ext)
      const imported = importInkObject(object, asset => imagePath(folder, row, asset))
      if (imported.action === 'hold') {
        result.held.push({ id, reason: imported.reason })
        continue
      }
      const wrote = silently(db, () => {
        // Drawn on while the image was fetched: that edit wins.
        const latest = db.prepare('SELECT updated_at FROM pdf_drawings WHERE id = ?').get(id) as { updated_at: string } | undefined
        if (latest?.updated_at !== row?.updated_at) return false
        if (imported.action === 'upsert') {
          const { fields } = imported
          db.prepare(`INSERT INTO pdf_drawings (id, course_id, rel_path, page, kind, data_json, style_json, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT (id) DO UPDATE SET course_id = excluded.course_id, rel_path = excluded.rel_path,
              page = excluded.page, kind = excluded.kind, data_json = excluded.data_json, style_json = excluded.style_json,
              created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = NULL`)
            .run(id, at.course_id, at.local_path, fields.page, fields.kind, JSON.stringify(fields.data), JSON.stringify(fields.style), fields.created_at, fields.updated_at)
        } else if (row) {
          db.prepare('UPDATE pdf_drawings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(imported.deleted_at, imported.deleted_at, id)
        }
        const updatedAt = imported.action === 'upsert' ? imported.fields.updated_at : row ? imported.deleted_at : null
        db.prepare(`INSERT INTO sync_ink (id, doc_id, page, t, device_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET doc_id = excluded.doc_id, page = excluded.page, t = excluded.t, device_id = excluded.device_id, updated_at = excluded.updated_at`)
          .run(id, doc, object.page, winner.t, winner.device, updatedAt)
        return true
      })
      if (wrote) result.changed.push(at.course_id)
    } catch (error) {
      result.held.push({ id, reason: message(error) })
    }
  }
}

/** Courses first, then documents, then drawings, each needing the one before; course deletions last. */
export async function applyMerged(merged: MergedState, ctx: ApplyContext): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], removed: [], held: [] }
  if (merged.blocked !== null) return result
  applyCourses(merged, ctx, result, 'upsert')
  await applyDocs(merged, ctx, result)
  await applyInk(merged, ctx, result)
  applyCourses(merged, ctx, result, 'remove')
  return { changed: [...new Set(result.changed)].sort(), removed: [...new Set(result.removed)].sort(), held: result.held }
}
