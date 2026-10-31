/**
 * Exports local changes to the root (design 2.6, 3.2–3.6, 18.3, 20.3). The
 * outbox only names candidates: each is compared with the base, what this
 * device last synced, and only a real difference becomes a file. Afterwards
 * the base holds this device's own value under its own stamp, so its files
 * read back as already applied. Content goes first, as it is read, then ink
 * and notes, then the log that points at them (spec "쓰기 순서").
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { gzipSync } from 'node:zlib'
import type { Database } from 'better-sqlite3'
import { resolveInsideReal } from '../../db/validate'
import { assetExt, courseFields, docLocation, importInkObject, toInkObject, type AssetRef, type DrawingRow } from './adapter'
import { basePlace, getRow, hashFile, liveFolder, readBase, samePlace, split, writeBase, type Stamped } from './apply'
import { sha256, type InkObject, type MetaEvent } from './format'
import { isSyncedFile, reconcileDocs, trackedDoc, type Scan, type SyncDocRow } from './localDocs'
import { isAlive, type MergedState } from './merge'

/** Log and ink files start over past this size (spec "동기화 루프"); readers take log files up to 4 MiB. */
const ROLLOVER = 1024 * 1024
const MANAGED = "source = 'managed' AND workspace_kind = 'course'"
/** A course-relative image link in a note: an editor upload (`assets/<name>`) or an applied one (`assets/<sha>.<ext>`). */
const LOCAL_ASSET = /(?<![\w./%-])(?:\.\/)?assets\/[^\s)"'<>]+/g
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const pad = (seq: number): string => String(seq).padStart(8, '0')
const nfc = (text: string): string => text.normalize('NFC')

export interface ExportSession {
  /** This run's latest log file and every event in it: a flush rewrites the whole file. */
  log: { seq: number; events: MetaEvent[] } | null
  /** `<doc>/<page>` → this run's ink file and its objects. */
  ink: Map<string, { seq: number; objects: Map<string, InkObject> }>
  /** Document → this run's note file. */
  notes: Map<string, number>
  /** Largest t this device has issued. */
  clock: number
  /** `pdf/` and `assets/` files written this run, in case a listing predates the write. */
  uploaded: Set<string>
  /** Outbox items that could not go yet: a file changing under the read, a document not tracked yet. */
  retry: Map<string, { kind: string; id: string }>
}

export const createExportSession = (): ExportSession =>
  ({ log: null, ink: new Map(), notes: new Map(), clock: 0, uploaded: new Set(), retry: new Map() })

export interface ExportContext {
  db: Database
  device: string
  /** The seq for a new file, saved before the file is written (M24). */
  takeSeq(): number
  /** The pull this export follows: its listing, merged state and the largest t the root holds. */
  root: { paths: ReadonlySet<string>; merged: MergedState; clock: number }
  write(path: string, bytes: Uint8Array): Promise<void>
  /** A walk of a course folder, as reconcileDocs takes it. */
  scan(folder: string): Promise<Scan>
  platform?: NodeJS.Platform
  now?: () => number
}

export interface ExportResult {
  written: string[]
  held: { id: string; reason: string }[]
}

interface Batch {
  ctx: ExportContext
  session: ExportSession
  renames: Map<string, string>
  /** Local id → the root's id, for courses merged at initial connect (design 6.2). */
  remoteIds: Map<string, string>
  events: MetaEvent[]
  /** Drawings by `<doc>/<page>`. */
  ink: Map<string, InkObject[]>
  /** Note snapshots by document. */
  notes: Map<string, Uint8Array>
  /** Base updates, run in one transaction once every file is written. */
  commits: (() => void)[]
  /** Courses an upsert in this batch brings back. */
  revived: Set<string>
  written: string[]
  retry: ExportSession['retry']
  held: ExportResult['held']
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `max(now, clock + 1)`, where the clock is every t seen: the root's and this device's own. */
function stamp(batch: Batch): number {
  const { ctx, session } = batch
  session.clock = Math.max((ctx.now ?? Date.now)(), ctx.root.clock + 1, session.clock + 1)
  return session.clock
}

/** One meta event, and the base it leaves behind once written: these values under this device's stamp. */
function emit(batch: Batch, op: string, id: string, fields: Record<string, unknown>, base: Record<string, unknown>): void {
  const t = stamp(batch), device = batch.ctx.device
  // The base keeps this profile's ids; the root gets its own for a course merged at initial connect.
  const remote = (local: string): string => batch.remoteIds.get(local) ?? local
  const course = fields.course_id
  batch.events.push({ t, op, id: op.startsWith('course.') ? remote(id) : id, fields: typeof course === 'string' ? { ...fields, course_id: remote(course) } : fields })
  const values: Record<string, Stamped> = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { value, t, device }]))
  batch.commits.push(() => writeBase(batch.ctx.db, op.startsWith('course.') ? 'course' : 'doc', id, values))
}

/** A `pdf/` or `assets/` file goes up as soon as it is read: it is named by its bytes, so an early or repeated write is harmless. */
async function upload(batch: Batch, path: string, bytes: Uint8Array): Promise<void> {
  if (batch.ctx.root.paths.has(path) || batch.session.uploaded.has(path)) return
  await batch.ctx.write(path, bytes)
  batch.session.uploaded.add(path)
  batch.written.push(path)
}

function retry(batch: Batch, kind: string, id: string, reason: string): void {
  batch.retry.set(`${kind}:${id}`, { kind, id })
  batch.held.push({ id, reason })
}

/** Documents the base places in this course, still alive there. */
function baseDocsIn(db: Database, courseId: string): string[] {
  return (db.prepare(`SELECT c.entity_id AS id FROM sync_meta c JOIN sync_meta d ON d.entity_id = c.entity_id AND d.field = 'deleted'
    WHERE c.kind = 'doc' AND c.field = 'course_id' AND c.value_json = ? AND d.value_json = 'false' ORDER BY c.entity_id`)
    .all(JSON.stringify(courseId)) as { id: string }[]).map(row => row.id)
}

interface CourseRow { name: string; color: string; sort_order: number; archived: number; deleted_at: string | null; source: string; workspace_kind: string }

/** `docs` collects courses whose documents must be compared too: one coming back brings them back. */
function exportCourse(batch: Batch, id: string, docs: Set<string>): void {
  const { db } = batch.ctx
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined
  // Linked folders and study spaces stay on this device (D5).
  if (row && (row.source !== 'managed' || row.workspace_kind !== 'course')) return
  const base = readBase(db, id), alive = base.get('deleted')?.value === false
  if (!row || row.deleted_at !== null) {
    if (!alive) return
    emit(batch, 'course.delete', id, {}, { deleted: true })
    // Its documents go with it (spec v2.4).
    for (const doc of baseDocsIn(db, id)) emit(batch, 'doc.delete', doc, {}, { deleted: true })
    return
  }
  const fields = Object.entries(courseFields(row)).filter(([key, value]) => !alive || !isDeepStrictEqual(base.get(key)?.value, value))
  if (fields.length === 0) return
  emit(batch, 'course.upsert', id, Object.fromEntries(fields), { ...Object.fromEntries(fields), deleted: false })
  batch.revived.add(id)
  if (!alive) docs.add(id)
}

/** A document written into a course the root has deleted would count as deleted with it (v2.4), so the course comes back too. */
function reviveCourse(batch: Batch, courseId: string): void {
  const course = batch.ctx.root.merged.courses.get(courseId)
  if (course === undefined || isAlive(course) || batch.revived.has(courseId)) return
  batch.revived.add(courseId)
  const fields = courseFields(batch.ctx.db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as CourseRow)
  emit(batch, 'course.upsert', courseId, fields, { ...fields, deleted: false })
}

async function exportDocs(batch: Batch, courseId: string): Promise<void> {
  const { db } = batch.ctx
  const course = db.prepare(`SELECT folder_path FROM courses WHERE id = ? AND deleted_at IS NULL AND ${MANAGED}`).get(courseId) as { folder_path: string } | undefined
  if (!course) return
  const folder = course.folder_path
  await reconcileDocs(db, courseId, await batch.ctx.scan(folder), relPath => hashFile(resolveInsideReal(folder, relPath)))
  for (const row of db.prepare('SELECT * FROM sync_docs WHERE course_id = ? AND local_hash IS NOT NULL ORDER BY document_id').all(courseId) as SyncDocRow[]) {
    try {
      await exportDoc(batch, row, folder)
    } catch (error) {
      retry(batch, 'docs', courseId, message(error))
    }
  }
  // Gone from here for two complete scans, and not moved into another course: deleted here.
  for (const id of baseDocsIn(db, courseId)) if (!getRow(db, id)) emit(batch, 'doc.delete', id, {}, { deleted: true })
}

/**
 * A note as the spec stores it, and the files its image links point at:
 * links to images in the course's `assets/` folder become
 * `../../assets/<sha>.<ext>`. Bytes that are not UTF-8, or that link nothing,
 * stay exactly as they are.
 */
export async function specNote(folder: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; assets: Map<string, Buffer> }> {
  const assets = new Map<string, Buffer>()
  let text: string
  try {
    text = UTF8.decode(bytes)
  } catch {
    return { bytes, assets }
  }
  const links = new Map<string, string>()
  for (const [target] of text.matchAll(LOCAL_ASSET)) {
    if (links.has(target)) continue
    let file: Buffer
    try {
      file = await readFile(resolveInsideReal(join(folder, 'assets'), decodeURI(target.replace(/^(?:\.\/)?assets\//, ''))))
    } catch {
      continue // Not a file in assets/: the link stays as written.
    }
    const asset = `assets/${sha256(file)}.${assetExt(target)}`
    assets.set(asset, file)
    links.set(target, `../../${asset}`)
  }
  return { bytes: links.size === 0 ? bytes : Buffer.from(text.replace(LOCAL_ASSET, target => links.get(target) ?? target), 'utf8'), assets }
}

async function exportDoc(batch: Batch, row: SyncDocRow, folder: string): Promise<void> {
  const { db, platform } = batch.ctx, id = row.document_id, base = readBase(db, id)
  const type = /\.pdf$/i.test(row.local_path) ? 'pdf' : 'md'
  const copy = base.get('copy')?.value === true
  const fresh = base.get('deleted')?.value !== false || copy
  const was = basePlace(base, id, type, platform), have = split(row.local_path)
  const sameCourse = was !== null && row.course_id === base.get('course_id')?.value
  // Folders compare as the disk does: two spec folders that differ only in case are one folder here, spelled as it was made.
  // Names compare exactly once NFC: the collision rule keeps them apart without case, so a case-only change is a rename here.
  const dirKept = sameCourse && samePlace(have.dir, was.dir)
  const nameKept = sameCourse && was.names.some(name => nfc(name) === nfc(have.name))
  const edited = row.local_hash !== row.synced_hash
  // A conflict copy stays derived until someone moves or edits it.
  if (copy && !edited && dirKept && nameKept) return

  const where = docLocation(row.local_path), fields: Record<string, unknown> = {}
  if (fresh || !sameCourse) Object.assign(fields, { course_id: row.course_id, type, rel_path: where.rel_path, name: where.name })
  else {
    if (!dirKept) fields.rel_path = where.rel_path
    if (!nameKept) fields.name = where.name
    // A path collision's name is written out once, so it stays after the other document goes (spec 경로 충돌).
    const rename = batch.renames.get(id)
    if (fields.name === undefined && rename !== undefined && base.get('name')?.value !== rename) fields.name = rename
  }

  let hash = base.get('hash')?.value, synced = row.synced_hash
  if (fresh || edited) {
    const bytes = await readFile(resolveInsideReal(folder, row.local_path))
    synced = sha256(bytes)
    if (synced !== row.local_hash) return retry(batch, 'docs', row.course_id, `${row.local_path} changed while exporting`)
    if (type === 'pdf') {
      await upload(batch, `pdf/${synced}.pdf`, bytes)
      // An append made here names the bytes it grew from, so devices bound to them carry their drawings over (D6).
      if (fresh || synced !== hash) Object.assign(fields, { pdf_sha256: synced, pdf_prev_sha256: !fresh && appendedHere(db, hash, synced) ? hash : null })
      hash = synced
    } else {
      const note = await specNote(folder, bytes), mdHash = sha256(note.bytes)
      for (const [path, file] of note.assets) await upload(batch, path, file)
      if (fresh || mdHash !== hash) {
        Object.assign(fields, { md_hash: mdHash, md_base: typeof hash === 'string' ? hash : null })
        batch.notes.set(id, note.bytes)
      }
      hash = mdHash
    }
  }
  if (Object.keys(fields).length > 0) {
    reviveCourse(batch, row.course_id)
    const { pdf_sha256, pdf_prev_sha256, md_hash, md_base, ...place } = fields
    const content = pdf_sha256 ?? md_hash
    emit(batch, 'doc.upsert', id, fields, { ...place, ...(content === undefined ? {} : { hash: content }), deleted: false, ...(fresh ? { copy: false } : {}) })
  }
  if (synced !== row.synced_hash) batch.commits.push(() => db.prepare('UPDATE sync_docs SET synced_hash = ? WHERE document_id = ?').run(synced, id))
}

/**
 * The page editor turned `from` into `to` by appending pages at the end, once
 * or several times between two exports (pdf_restructure_log, appended = 1).
 */
function appendedHere(db: Database, from: unknown, to: string): boolean {
  if (typeof from !== 'string') return false
  let edges: { from_sha: string; to_sha: string }[]
  try {
    edges = db.prepare('SELECT from_sha, to_sha FROM pdf_restructure_log WHERE appended = 1').all() as { from_sha: string; to_sha: string }[]
  } catch {
    return false // Nothing was ever restructured here: the log, or its appended column, is not there yet.
  }
  const seen = new Set([from]), queue = [from]
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const edge of edges) {
      if (edge.from_sha !== next || seen.has(edge.to_sha)) continue
      if (edge.to_sha === to) return true
      seen.add(edge.to_sha)
      queue.push(edge.to_sha)
    }
  }
  return false
}

/** What applying `object` here and exporting it again would write: clamped, known keys only. Null when it would not import. */
function reexported(object: InkObject): InkObject | null {
  try {
    const imported = importInkObject(object, () => 'assets/_')
    if (imported.action === 'delete') return { id: object.id, page: object.page, t: 0, del: true }
    if (imported.action !== 'upsert') return null
    const { fields } = imported, image = object.data?.image as AssetRef | undefined
    return toInkObject({
      id: object.id, page: fields.page, kind: fields.kind, data_json: JSON.stringify(fields.data), style_json: JSON.stringify(fields.style),
      created_at: fields.created_at, updated_at: fields.updated_at, deleted_at: null
    }, 0, image && { sha256: image.sha256, ext: image.ext })
  } catch {
    return null
  }
}

/** A PDF a scan of its course will track: a synced kind, outside dot folders, on disk now. */
function trackable(folder: string, relPath: string): boolean {
  if (!/\.pdf$/i.test(relPath) || !isSyncedFile(relPath)) return false
  try {
    return existsSync(resolveInsideReal(folder, relPath))
  } catch {
    return false
  }
}

async function imageAsset(batch: Batch, folder: string, row: DrawingRow): Promise<AssetRef | null> {
  const relPath = (JSON.parse(row.data_json) as { image?: { relPath?: unknown } }).image?.relPath
  if (typeof relPath !== 'string') return null
  let bytes: Buffer
  try {
    bytes = await readFile(resolveInsideReal(folder, relPath))
  } catch {
    return null // The image file is gone; the next full comparison looks again.
  }
  const asset = { sha256: sha256(bytes), ext: assetExt(relPath) }
  await upload(batch, `assets/${asset.sha256}.${asset.ext}`, bytes)
  return asset
}

type DrawingRecord = DrawingRow & { course_id: string; rel_path: string }

async function exportInk(batch: Batch, id: string): Promise<void> {
  const { db, device } = batch.ctx
  const row = db.prepare('SELECT * FROM pdf_drawings WHERE id = ?').get(id) as DrawingRecord | undefined
  const base = db.prepare('SELECT doc_id, page, updated_at FROM sync_ink WHERE id = ?').get(id) as { doc_id: string; page: number; updated_at: string | null } | undefined
  // Unchanged since the last sync (an apply's own write lands here too), or a deletion already written.
  if (row ? row.updated_at === base?.updated_at : base === undefined || base.updated_at === null) return

  const folder = row ? liveFolder(db, row.course_id) : null
  // A stroke already synced stays with its document even when its path went stale, say when a remote move revived the file elsewhere.
  const doc = row ? (folder === null ? null : trackedDoc(db, row.course_id, row.rel_path) ?? base?.doc_id ?? null) : base!.doc_id
  if (doc === null) {
    // A PDF in a synced course that a scan has not tracked yet: compare its course and look again. Anything else stays here.
    if (row && folder !== null && trackable(folder, row.rel_path)) {
      retry(batch, 'docs', row.course_id, 'document is not tracked yet')
      retry(batch, 'ink', id, 'document is not tracked yet')
    }
    return
  }
  let object: InkObject | null
  if (!row) object = { id, page: base!.page, t: 0, del: true }
  else if (row.kind === 'image' && row.deleted_at === null) {
    const image = await imageAsset(batch, folder!, row)
    object = image && toInkObject(row, 0, image)
  } else object = toInkObject(row, 0)
  // A board clip stays local; an image whose file is gone cannot go.
  if (object === null) return

  const page = object.page, updatedAt = row?.updated_at ?? null
  const settle = (t: number, by: string): void => {
    batch.commits.push(() => db.prepare(`INSERT INTO sync_ink (id, doc_id, page, t, device_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET doc_id = excluded.doc_id, page = excluded.page, t = excluded.t, device_id = excluded.device_id, updated_at = excluded.updated_at`)
      .run(id, doc, page, t, by, updatedAt))
  }
  // A path rewrite or a move also touches updated_at; the same content as the root holds settles the base only (18.3).
  const winner = batch.ctx.root.merged.ink.get(id)
  if (winner && isDeepStrictEqual(reexported(winner.value.object), object)) return settle(winner.t, winner.device)
  const t = stamp(batch), key = `${doc}/${page}`
  batch.ink.set(key, [...(batch.ink.get(key) ?? []), { ...object, t }])
  settle(t, device)
}

/**
 * Splits events over log files: the open one while it has room, then new ones,
 * each within `limit` bytes of JSON. `takeSeq` names each new file.
 */
export function packLog(open: ExportSession['log'], events: readonly MetaEvent[], limit: number, takeSeq: () => number): NonNullable<ExportSession['log']>[] {
  const files: NonNullable<ExportSession['log']>[] = []
  let file = open && { seq: open.seq, events: [...open.events] }, size = file ? Buffer.byteLength(JSON.stringify(file.events)) : 0
  for (const event of events) {
    const add = Buffer.byteLength(JSON.stringify(event)) + 1
    if (!file || (file.events.length > 0 && size + add > limit)) {
      file = { seq: takeSeq(), events: [] }
      size = 2
    }
    if (files.at(-1) !== file) files.push(file)
    file.events.push(event)
    size += add
  }
  return files
}

async function flush(batch: Batch, upTo: number | null): Promise<void> {
  const { ctx, session } = batch
  const put = async (path: string, bytes: Uint8Array): Promise<void> => {
    await ctx.write(path, bytes)
    batch.written.push(path)
  }
  // This run's files are rewritten whole, and each is remembered the moment it is written, so a retry after a failure
  // rewrites the same names instead of starting new ones.
  for (const [key, objects] of batch.ink) {
    const previous = session.ink.get(key), added = objects.map(object => [object.id, object] as const)
    const grown = previous && { seq: previous.seq, objects: new Map([...previous.objects, ...added]) }
    let file = grown, bytes = grown && gzipSync(JSON.stringify([...grown.objects.values()]))
    if (!file || !bytes || bytes.byteLength > ROLLOVER) {
      file = { seq: ctx.takeSeq(), objects: new Map(added) }
      bytes = gzipSync(JSON.stringify(objects))
    }
    await put(`ink/${key}/${ctx.device}-${pad(file.seq)}.json.gz`, bytes)
    session.ink.set(key, file)
  }
  for (const [doc, bytes] of batch.notes) {
    const seq = session.notes.get(doc) ?? ctx.takeSeq()
    await put(`notes/${doc}/${ctx.device}-${pad(seq)}.md`, bytes)
    session.notes.set(doc, seq)
  }
  for (const file of packLog(session.log, batch.events, ROLLOVER, ctx.takeSeq)) {
    await put(`log/${ctx.device}/${pad(file.seq)}.json`, Buffer.from(JSON.stringify(file.events)))
    session.log = file
  }
  ctx.db.transaction(() => {
    for (const commit of batch.commits) commit()
    if (upTo !== null) ctx.db.prepare('DELETE FROM sync_outbox WHERE seq <= ?').run(upTo)
  })()
}

/** One export pass over the outbox and what earlier passes left to retry. */
export async function exportChanges(ctx: ExportContext, session: ExportSession): Promise<ExportResult> {
  const { db } = ctx
  const upTo = (db.prepare('SELECT MAX(seq) AS seq FROM sync_outbox').get() as { seq: number | null }).seq
  const items = [...(upTo === null ? [] : db.prepare('SELECT kind, id FROM sync_outbox WHERE seq <= ?').all(upTo) as { kind: string; id: string }[]), ...session.retry.values()]
  if (items.length === 0) return { written: [], held: [] }
  const batch: Batch = {
    ctx, session, renames: new Map(ctx.root.merged.renames.map(rename => [rename.id, rename.name])),
    remoteIds: new Map((db.prepare("SELECT local_id, remote_id FROM sync_alias WHERE kind = 'course'").all() as { local_id: string; remote_id: string }[])
      .map(row => [row.local_id, row.remote_id])),
    events: [], ink: new Map(), notes: new Map(), commits: [], revived: new Set(), written: [], retry: new Map(), held: []
  }
  const ids = (kind: string) => new Set(items.filter(item => item.kind === kind).map(item => item.id))
  const docs = ids('docs')
  for (const id of ids('course')) exportCourse(batch, id, docs)
  for (const courseId of docs) {
    try {
      await exportDocs(batch, courseId)
    } catch (error) {
      retry(batch, 'docs', courseId, message(error))
    }
  }
  for (const id of ids('ink')) {
    try {
      await exportInk(batch, id)
    } catch (error) {
      retry(batch, 'ink', id, message(error))
    }
  }
  await flush(batch, upTo)
  session.retry = batch.retry
  return { written: batch.written, held: batch.held }
}
