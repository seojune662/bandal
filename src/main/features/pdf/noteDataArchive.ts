import { createHash } from 'node:crypto'
/** Preserve every editable variant, including multiple edits to the same PDF
 * bytes. Page deletion/reordering must never reduce an archive to a flat PDF. */
export function archivePdfRows(db: any, materialId: string, revision: string, courseId: string, relPath: string): void {
  const drawings = db.prepare('SELECT * FROM pdf_drawings WHERE course_id=? AND rel_path=? ORDER BY id').all(courseId, relPath)
  const annotations = db.prepare('SELECT * FROM annotations WHERE course_id=? AND rel_path=? ORDER BY id').all(courseId, relPath)
  const drawingsJSON = JSON.stringify(drawings), annotationsJSON = JSON.stringify(annotations)
  const id = createHash('sha256').update(JSON.stringify([materialId, revision, drawingsJSON, annotationsJSON])).digest('hex')
  db.exec(`CREATE TABLE IF NOT EXISTS pdf_rewrite_archive_variants (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL, revision TEXT NOT NULL,
    drawings_json TEXT NOT NULL, annotations_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
  db.prepare('INSERT OR IGNORE INTO pdf_rewrite_archive_variants(id,material_id,revision,drawings_json,annotations_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, materialId, revision, drawingsJSON, annotationsJSON, new Date().toISOString())
}
