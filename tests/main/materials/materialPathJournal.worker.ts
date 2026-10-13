const Database = require('better-sqlite3-node')
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createMaterialPathLock } from '../../../src/main/features/materials/materialPathLock'
import { createPDFDocumentBindings } from '../../../src/main/features/pdf/pdfDocumentBinding'
import { pdfFileRevision } from '../../../src/main/features/pdf/pdfOriginals'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import { createLinkIndex } from '../../../src/main/features/links/linkIndex'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const db = new Database(spec.dbPath), folder = spec.folder
const bindings = createPDFDocumentBindings(db, (_id, path) => pdfFileRevision(join(folder, path)))
const crash = (stage: string) => {
  if (spec.stage !== stage) return
  writeFileSync(spec.marker, stage)
  if (stage === 'live') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
  else process.kill(process.pid, 'SIGKILL')
}
const fs = require('node:fs'), originalRename = fs.renameSync, originalFsync = fs.fsyncSync
fs.renameSync = (from: string, to: string) => {
  if (from.endsWith('.tmp') && to.endsWith('.md')) {
    crash('before-note-publish')
    if (spec.stage === 'write-failure') throw Object.assign(new Error('injected note publish failure'), { code: 'EACCES' })
  }
  const result = originalRename(from, to)
  if (from.endsWith('.tmp') && to.endsWith('.md')) crash('after-note-publish')
  return result
}
let injectedExternalWrite = false
fs.fsyncSync = (fd: number) => {
  const result = originalFsync(fd)
  if (spec.stage === 'external-before-publish' && !injectedExternalWrite) {
    injectedExternalWrite = true
    writeFileSync(join(folder, spec.sameName ? 'old.md' : 'renamed.md'), '# External editor\n\nKEEP THIS NEW DRAFT\n')
  }
  return result
}
let changed = false
const prepare = db.prepare.bind(db)
db.prepare = (sql: string) => {
  const statement = prepare(sql)
  if (sql.startsWith('INSERT INTO material_path_intents(')) {
    const run = statement.run.bind(statement)
    statement.run = (...args: any[]) => { const result = run(...args); crash('before-move'); return result }
  }
  if (sql.startsWith('UPDATE material_path_intents SET moved_identity=')) {
    const run = statement.run.bind(statement)
    statement.run = (...args: any[]) => { crash('after-move'); const result = run(...args); crash('live'); return result }
  }
  return statement
}
const transaction = db.transaction.bind(db)
db.transaction = (fn: (...args: any[]) => any) => {
  const action = transaction(fn)
  return (...args: any[]) => {
    const result = action(...args)
    if (spec.stage === 'after-commit' && changed && !db.prepare('SELECT 1 FROM material_path_intents').get()) crash('after-commit')
    return result
  }
}
const repo = createMaterialsRepo({ db, getCourseFolder: () => folder, revealItem() {}, trashItem: async () => {},
  pathLock: createMaterialPathLock(spec.lockPath, path => new Database(path, { timeout: 0 })),
  onPathChanged(change) { changed = true; bindings.repoint(change); repointMaterialPath({ ...change, db, courseFolder: folder, ...(spec.rewriteNote ? { candidateNoteRelPaths: [spec.directory ? 'new/note.md' : 'references.md'] } : {}) }); crash('before-commit') }
})
const notes = createNotesRepo({ getCourseFolder: () => folder,
  renameWithMarkdown: input => repo.renameWithMarkdown(input), assertPathAvailable: (id, path) => repo.assertPathAvailable(id, path) })
if (spec.action !== 'recover' && (spec.rewriteNote || spec.note)) createLinkIndex({ db, getCourseFolder: () => folder }).allForCourse(spec.courseId)
if (spec.action === 'recover') {
  repo.recoverPathChanges()
  process.stdout.write(JSON.stringify({ pending: db.prepare('SELECT COUNT(*) n FROM material_path_intents').get().n, drawings: db.prepare('SELECT id,rel_path FROM pdf_drawings').all(), aliases: db.prepare('SELECT rel_path,material_id FROM pdf_document_aliases').all(), favorites: db.prepare('SELECT descriptor_json FROM favorites').all().map((r: any) => JSON.parse(r.descriptor_json)) }))
  db.close()
} else {
  const action = spec.note ? notes.rename({ courseId: spec.courseId, relPath: 'old.md', newName: spec.sameName ? 'old.md' : 'renamed.md' }) : spec.markdownMaterial ? repo.rename({ courseId: spec.courseId, relPath: 'old.md', newName: 'renamed.md' }) : spec.directory ? repo.rename({ courseId: spec.courseId, relPath: 'old', newName: 'new' }) : spec.move ? repo.move({ courseId: spec.courseId, fromRelPath: 'lecture.pdf', toDirRelPath: 'new' }) : repo.rename({ courseId: spec.courseId, relPath: 'lecture.pdf', newName: 'renamed.pdf' })
  action.then(() => { db.close(); process.stdout.write('completed') }).catch(error => { console.error(error); process.exitCode = 1; db.close() })
}
