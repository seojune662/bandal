/**
 * Which document id a file in a synced course carries (design 3.1). Ids
 * survive renames: in-app moves repoint them, and a file that turns up under
 * a new path takes over a missing document with the same bytes. A file counts
 * as deleted only when two complete scans at least a minute apart miss it;
 * its row then goes, and "no row while the base says alive" means deleted
 * here, waiting for export.
 */
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

export interface LocalFile {
  /** Course-relative, `/`-separated. */
  relPath: string
  size: number
  mtime: number
}

export interface Scan {
  files: readonly LocalFile[]
  /** False when the walk stopped early (entry or depth cap): a file it did not reach is not missing. */
  complete: boolean
}

export interface SyncDocRow {
  document_id: string
  course_id: string
  local_path: string
  /** SHA-256 of the bytes the last scan saw; null while a remote document is still being written here. */
  local_hash: string | null
  local_size: number | null
  local_mtime: number | null
  /** SHA-256 of the local bytes when this document was last synced; null if it never was. */
  synced_hash: string | null
  missing_since: number | null
}

export const MISSING_GRACE_MS = 60_000

/** pdf and md files only, outside dot folders such as `.bandal` (F12). */
export const isSyncedFile = (relPath: string): boolean =>
  /\.(pdf|md|markdown)$/i.test(relPath) && !relPath.split('/').some(part => part.startsWith('.'))

/** APFS and NTFS compare names without case or normalization, σ and ς included, as upper case does. */
export const diskKey = (path: string): string => path.normalize('NFC').toUpperCase()

/** PDFs keep the identity the PDF binding already gave them; otherwise the index row's id, fixed from now on. */
function newDocumentId(db: Database, courseId: string, relPath: string): string {
  const bound = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pdf_document_aliases'").get()
    ? db.prepare('SELECT material_id AS id FROM pdf_document_aliases WHERE course_id = ? AND rel_path = ?').get(courseId, relPath) as { id: string } | undefined
    : undefined
  const indexed = db.prepare('SELECT id FROM materials_index WHERE course_id = ? AND rel_path = ?').get(courseId, relPath) as { id: string } | undefined
  const id = bound?.id ?? indexed?.id
  return id !== undefined && !db.prepare('SELECT 1 FROM sync_docs WHERE document_id = ?').get(id) ? id : randomUUID()
}

/**
 * Brings `sync_docs` for one course up to date with a scan of its readable
 * folder. `hash` reads one file's SHA-256 and is only called for new or
 * changed files.
 */
export async function reconcileDocs(db: Database, courseId: string, scan: Scan, hash: (relPath: string) => Promise<string>, now = Date.now()): Promise<void> {
  const synced = scan.files.filter(file => isSyncedFile(file.relPath)).sort((a, b) => (a.relPath < b.relPath ? -1 : 1))
  const select = () => db.prepare('SELECT * FROM sync_docs WHERE course_id = ?').all(courseId) as SyncDocRow[]
  const changed = (row: SyncDocRow, file: LocalFile) => row.local_size !== file.size || row.local_mtime !== file.mtime
  // Hash outside the transaction, only what a first look says is new or changed.
  const before = new Map(select().map(row => [diskKey(row.local_path), row]))
  const hashes = new Map<string, string>()
  for (const file of synced) {
    const row = before.get(diskKey(file.relPath))
    if (!row || (row.local_hash !== null && changed(row, file))) hashes.set(file.relPath, await hash(file.relPath))
  }
  db.transaction(() => {
    // Rows as they are now: an apply or an in-app rename may have run while hashing.
    const rows = select(), byKey = new Map(rows.map(row => [diskKey(row.local_path), row]))
    const update = db.prepare('UPDATE sync_docs SET local_path = ?, local_hash = ?, local_size = ?, local_mtime = ?, missing_since = NULL WHERE document_id = ?')
    const found = new Set<string>(), fresh: LocalFile[] = []
    for (const file of synced) {
      const row = byKey.get(diskKey(file.relPath))
      if (!row) {
        fresh.push(file)
        continue
      }
      found.add(row.document_id)
      // Still being written by a remote apply.
      if (row.local_hash === null) continue
      const digest = changed(row, file) ? hashes.get(file.relPath) : row.local_hash
      if (digest === undefined) continue
      if (row.local_path !== file.relPath || digest !== row.local_hash || changed(row, file) || row.missing_since !== null) {
        update.run(file.relPath, digest, file.size, file.mtime, row.document_id)
      }
    }
    const missing = rows.filter(row => !found.has(row.document_id) && row.local_hash !== null)
    for (const file of fresh) {
      const digest = hashes.get(file.relPath)
      if (digest === undefined) continue
      const index = missing.findIndex(row => row.local_hash === digest)
      if (index >= 0) {
        update.run(file.relPath, digest, file.size, file.mtime, missing[index]!.document_id)
        missing.splice(index, 1)
      } else {
        db.prepare('INSERT INTO sync_docs (document_id, course_id, local_path, local_hash, local_size, local_mtime) VALUES (?, ?, ?, ?, ?, ?)')
          .run(newDocumentId(db, courseId, file.relPath), courseId, file.relPath, digest, file.size, file.mtime)
      }
    }
    if (!scan.complete) return
    for (const row of missing) {
      if (row.missing_since === null) db.prepare('UPDATE sync_docs SET missing_since = ? WHERE document_id = ?').run(now, row.document_id)
      else if (now - row.missing_since >= MISSING_GRACE_MS) db.prepare('DELETE FROM sync_docs WHERE document_id = ?').run(row.document_id)
    }
  })()
}

/** In-app rename or move through the materials journal: the documents keep their ids at the new path. */
export function repointSyncDocs(db: Database, change: { courseId: string; fromRelPath: string; toRelPath: string; isDirectory: boolean }): void {
  const from = diskKey(change.fromRelPath), depth = change.fromRelPath.split('/').length
  // OR REPLACE: a stale row left at the destination by an earlier delete gives way.
  const move = db.prepare('UPDATE OR REPLACE sync_docs SET local_path = ? WHERE document_id = ?')
  for (const row of db.prepare('SELECT document_id, local_path FROM sync_docs WHERE course_id = ?').all(change.courseId) as { document_id: string; local_path: string }[]) {
    const key = diskKey(row.local_path)
    if (key === from) move.run(change.toRelPath, row.document_id)
    else if (change.isDirectory && key.startsWith(`${from}/`)) move.run([change.toRelPath, ...row.local_path.split('/').slice(depth)].join('/'), row.document_id)
  }
}
