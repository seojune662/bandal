/**
 * Initial connect (design 6.2): what this profile and a root each hold, and
 * the steps a merge or an overwrite takes before the engine starts. Uploading
 * and downloading themselves are the engine's first pass.
 */
import { readFile } from 'node:fs/promises'
import type { Database } from 'better-sqlite3'
import type { ConnectPlan } from '../../../shared/types/sync'
import { resolveInsideReal } from '../../db/validate'
import { courseFields, docLocation } from './adapter'
import { hashFile, writeBase, type Stamped } from './apply'
import { packLog, specNote } from './export'
import { sha256, type MetaEvent } from './format'
import { isSyncedFile, reconcileDocs, type Scan, type SyncDocRow } from './localDocs'
import { isAlive, type MergedState, type Register } from './merge'

const MANAGED = "source = 'managed' AND workspace_kind = 'course'"
const pad = (seq: number): string => String(seq).padStart(8, '0')
/** Names compare as people read them: NFC, outer spaces ignored. */
const nameKey = (name: unknown): string | null => (typeof name === 'string' ? name.normalize('NFC').trim() : null)
/** Older than anything a root holds: the root's values apply over it, and nothing is written back for it. */
const ancient = (value: unknown): Stamped => ({ value, t: 0, device: '' })

interface CourseRow { id: string; name: string; color: string; sort_order: number; archived: number; folder_path: string }

const localCourses = (db: Database): CourseRow[] =>
  db.prepare(`SELECT * FROM courses WHERE deleted_at IS NULL AND ${MANAGED} ORDER BY id`).all() as CourseRow[]

/** `sameRoot`: this profile's base is from this root, so a course they share means it synced here before. */
export async function planConnect(db: Database, merged: MergedState, scan: (folder: string) => Promise<Scan>, sameRoot: boolean): Promise<ConnectPlan> {
  const courses = localCourses(db)
  let docs = 0
  for (const course of courses) {
    try {
      docs += (await scan(course.folder_path)).files.filter(file => isSyncedFile(file.relPath)).length
    } catch {
      // A course folder gone from disk holds no documents.
    }
  }
  const remoteCourses = [...merged.courses].filter(([, entity]) => isAlive(entity))
  const local = { courses: courses.length, docs }
  const remote = { courses: remoteCourses.length, docs: [...merged.docs.values()].filter(isAlive).length }
  // Ids this profile already shares with the root: it synced here before.
  const remoteOf = new Map((db.prepare("SELECT local_id, remote_id FROM sync_alias WHERE kind = 'course'").all() as { local_id: string; remote_id: string }[])
    .map(row => [row.local_id, row.remote_id]))
  const known = db.prepare("SELECT DISTINCT entity_id AS id FROM sync_meta WHERE kind = 'course'").all() as { id: string }[]
  if (sameRoot && known.some(row => merged.courses.has(remoteOf.get(row.id) ?? row.id))) return { kind: 'resume', local, remote, pairs: [] }
  if (remote.courses + remote.docs === 0) return { kind: 'upload', local, remote, pairs: [] }
  if (local.courses === 0) return { kind: 'download', local, remote, pairs: [] }
  const taken = new Set<string>(), pairs: ConnectPlan['pairs'] = []
  for (const course of courses) {
    const match = remoteCourses.find(([id, entity]) => !taken.has(id) && nameKey(entity.fields.get('name')?.value) === nameKey(course.name))
    if (!match) continue
    taken.add(match[0])
    pairs.push({ local: course.id, remote: match[0], name: course.name })
  }
  return { kind: 'choose', local, remote, pairs }
}

/** A move (spec v2.7): the root to move to holds nothing yet (`upload`), or holds data to merge with by id (`join`). */
export function movePlan(plan: ConnectPlan): ConnectPlan {
  return { ...plan, kind: plan.kind === 'upload' ? 'upload' : 'join', pairs: [] }
}

interface Stamp { t: number | null; device: string | null }
/** (t, device_id) order; a derived value, which has no t, is older than any. */
const before = (a: Stamp, b: Stamp): boolean =>
  a.t === null ? b.t !== null : b.t !== null && (a.t !== b.t ? a.t < b.t : (a.device ?? '') < (b.device ?? ''))

/**
 * A move (spec v2.7): the base, what this profile last synced with the old
 * root, made to describe the new one. Where the new root holds a value at
 * least as new, the base stays, so what both roots hold alike settles without
 * a write and a change made there applies here. Where it holds an older value,
 * the base becomes that one; where it holds none, the base goes. Either way
 * this device's value then goes up: a change made after the other device left
 * the old root, a deletion included, or whatever the new root lacks. Course
 * aliases stay, as they name the ids every device shares. `merged` carries
 * this profile's course ids (localize).
 *
 * A note's text goes by content, not stamps: a text the new root never had
 * was written in the old root after the moving device left it, so it goes up
 * whatever the new root's stamp says. When the new root's note changed after
 * the move (it names more than one text), this text did not start from the
 * one there: it goes up without md_base, so both stay heads and neither is
 * lost (a conflict copy).
 */
export function rebase(db: Database, merged: MergedState): void {
  const registerOf = (kind: string, id: string, field: string): Register | null => {
    const entity = (kind === 'course' ? merged.courses : merged.docs).get(id)
    if (entity === undefined) return null
    if (field === 'deleted') return entity.deleted
    if (field === 'hash') return entity.fields.get(entity.fields.get('type')?.value === 'pdf' ? 'pdf_sha256' : 'md_hash') ?? null
    return entity.fields.get(field) ?? null
  }
  const meta = db.prepare('SELECT kind, entity_id, field, value_json, t, device_id FROM sync_meta').all() as
    { kind: string; entity_id: string; field: string; value_json: string; t: number | null; device_id: string | null }[]
  const ink = db.prepare('SELECT id, t, device_id FROM sync_ink').all() as { id: string; t: number; device_id: string }[]
  const drop = db.prepare('DELETE FROM sync_meta WHERE entity_id = ? AND field = ?')
  const take = db.prepare('UPDATE sync_meta SET value_json = ?, t = ?, device_id = ? WHERE entity_id = ? AND field = ?')
  const resend = db.prepare('UPDATE sync_docs SET synced_hash = NULL WHERE document_id = ?')
  const forget = db.prepare('DELETE FROM sync_ink WHERE id = ?')
  const compare = db.prepare("UPDATE sync_ink SET updated_at = '' WHERE id = ?")
  db.transaction(() => {
    for (const row of meta) {
      const next = registerOf(row.kind, row.entity_id, row.field)
      const texts = row.field === 'hash' ? merged.noteHashes.get(row.entity_id) : undefined
      const unknown = texts !== undefined && !texts.includes(JSON.parse(row.value_json) as string)
      if (next !== null && !unknown && !before(next, { t: row.t, device: row.device_id })) continue
      if (next === null) drop.run(row.entity_id, row.field)
      else {
        // The repository trims course names and colours: the base holds what it would store (apply courseRemote).
        const value = unknown && texts.length > 1 ? null : row.kind === 'course' && typeof next.value === 'string' ? next.value.trim() : next.value
        take.run(JSON.stringify(value), next.t, next.device, row.entity_id, row.field)
      }
      // The file reads as edited, so its bytes are compared with the new root's and go up where they differ.
      if (row.field === 'hash') resend.run(row.entity_id)
    }
    for (const row of ink) {
      const next = merged.ink.get(row.id)
      if (next === undefined) forget.run(row.id)
      // Kept older than this device's version, so the root's does not apply; an updated_at no row has makes the export compare and send it.
      else if (before(next, { t: row.t, device: row.device_id })) compare.run(row.id)
    }
  })()
}

/** What this profile synced with another root: dropped, so the first pass compares everything as new. */
export function forgetRoot(db: Database): void {
  db.transaction(() => {
    for (const table of ['sync_meta', 'sync_ink', 'sync_alias', 'sync_outbox']) db.prepare(`DELETE FROM ${table}`).run()
    db.prepare('UPDATE sync_docs SET synced_hash = NULL').run()
  })()
}

/**
 * Merge: each chosen pair becomes one course under its local id, and a
 * document there with the same bytes as a remote one becomes that document.
 * Their base is older than anything in the root, so the root's names, places
 * and colours apply here, and the engine writes nothing back for them. Files
 * are read first; aliases, bases and adoptions then land in one transaction,
 * so a failure leaves nothing half joined.
 */
export async function joinRoot(db: Database, merged: MergedState, pairs: readonly { local: string; remote: string }[], scan: (folder: string) => Promise<Scan>): Promise<void> {
  const local = new Map(localCourses(db).map(course => [course.id, course]))
  const chosen = pairs.filter(pair => local.has(pair.local) && isAlive(merged.courses.get(pair.remote)))
  const adoptions: { from: string; to: string; base: Record<string, Stamped> }[] = []
  for (const { local: id, remote } of chosen) {
    const folder = local.get(id)!.folder_path
    let rows: SyncDocRow[]
    try {
      await reconcileDocs(db, id, await scan(folder), relPath => hashFile(resolveInsideReal(folder, relPath)))
      rows = db.prepare('SELECT * FROM sync_docs WHERE course_id = ? AND local_hash IS NOT NULL ORDER BY local_path').all(id) as SyncDocRow[]
    } catch {
      continue // A folder that cannot be read joins without adopting; its files, if any turn up, go up as new documents.
    }
    // What each file is in the spec's terms: a PDF its bytes, a note its snapshot with image links rewritten.
    const specHash = new Map<string, string>()
    for (const row of rows) {
      try {
        specHash.set(row.document_id, /\.pdf$/i.test(row.local_path) ? row.local_hash! : sha256((await specNote(folder, await readFile(resolveInsideReal(folder, row.local_path)))).bytes))
      } catch {
        // Unreadable now: not adopted, it goes up as its own document.
      }
    }
    const adopted = new Set<string>()
    for (const [docId, entity] of merged.docs) {
      if (!isAlive(entity) || entity.fields.get('course_id')?.value !== remote) continue
      const type = entity.fields.get('type')?.value, hash = entity.fields.get(type === 'pdf' ? 'pdf_sha256' : 'md_hash')?.value
      const row = rows.find(candidate => !adopted.has(candidate.document_id) && specHash.get(candidate.document_id) === hash &&
        /\.pdf$/i.test(candidate.local_path) === (type === 'pdf'))
      if (!row || typeof hash !== 'string') continue
      adopted.add(row.document_id)
      const where = docLocation(row.local_path)
      adoptions.push({
        from: row.document_id, to: docId,
        base: Object.fromEntries(Object.entries({ course_id: id, type, rel_path: where.rel_path, name: where.name, hash, deleted: false, copy: false })
          .map(([key, value]) => [key, ancient(value)]))
      })
    }
  }
  db.transaction(() => {
    for (const { local: id, remote } of chosen) {
      db.prepare("INSERT INTO sync_alias (kind, remote_id, local_id) VALUES ('course', ?, ?)").run(remote, id)
      writeBase(db, 'course', id, Object.fromEntries(Object.entries({ ...courseFields(local.get(id)!), deleted: false }).map(([key, value]) => [key, ancient(value)])))
    }
    for (const { from, to, base } of adoptions) {
      db.prepare('UPDATE sync_docs SET document_id = ?, synced_hash = local_hash WHERE document_id = ?').run(to, from)
      writeBase(db, 'doc', to, base)
    }
  })()
}

/**
 * Overwrite: every course and document alive in the root gets a tombstone from
 * this device before a first pull could bring it here; the engine's first pass
 * then uploads this profile. Root files are never removed.
 */
export async function overwriteRoot(merged: MergedState, clock: number, device: string, takeSeq: () => number,
  write: (path: string, bytes: Uint8Array) => Promise<void>): Promise<number> {
  let t = Math.max(Date.now(), clock + 1)
  const events: MetaEvent[] = []
  for (const [id, entity] of merged.courses) if (isAlive(entity)) events.push({ t: t++, op: 'course.delete', id, fields: {} })
  for (const [id, entity] of merged.docs) if (isAlive(entity)) events.push({ t: t++, op: 'doc.delete', id, fields: {} })
  for (const file of packLog(null, events, 1024 * 1024, takeSeq)) {
    await write(`log/${device}/${pad(file.seq)}.json`, Buffer.from(JSON.stringify(file.events)))
  }
  return events.length
}
