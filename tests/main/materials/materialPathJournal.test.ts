import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createPDFDocumentBindings, createBoundPDFRepositories } from '../../../src/main/features/pdf/pdfDocumentBinding'
import { pdfFileRevision } from '../../../src/main/features/pdf/pdfOriginals'
import { createFavoritesRepo } from '../../../src/main/features/favorites/favoritesRepo'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createMaterialPathJournal } from '../../../src/main/features/materials/materialPathJournal'
import { createMaterialPathLock } from '../../../src/main/features/materials/materialPathLock'
const require = createRequire(import.meta.url), SQLite = require('better-sqlite3-node')
const { buildSync } = createRequire(require.resolve('vite/package.json'))('esbuild')
let worker: string
beforeAll(() => {
  const bundle = buildSync({ entryPoints: [join(process.cwd(), 'tests/main/materials/materialPathJournal.worker.ts')], platform: 'node', format: 'cjs', bundle: true, write: false,
    external: ['better-sqlite3', 'better-sqlite3-node'] }).outputFiles[0].text
  worker = bundle.replace(/require\("better-sqlite3-node"\)/g, `require(${JSON.stringify(require.resolve('better-sqlite3-node'))})`).replace(/require\("better-sqlite3"\)/g, `require(${JSON.stringify(require.resolve('better-sqlite3'))})`)
})
describe('material rename durable intent and process ownership', () => {
  let ctx: TestDb, courseId: string, folder: string, spec: any, workerPath: string, child: ChildProcess | undefined
  const file = (path: string) => join(folder, path)
  const binding = () => createPDFDocumentBindings(ctx.db, (_id, path) => pdfFileRevision(file(path)))
  const count = () => (ctx.db.prepare('SELECT COUNT(*) n FROM material_path_intents').get() as any).n
  const run = (changes: object) => {
    Object.assign(spec, changes); writeFileSync(spec.config, JSON.stringify(spec))
    return spawnSync(process.execPath, [workerPath, spec.config], { encoding: 'utf8' })
  }
  const seed = (directory = false) => {
    const path = directory ? 'old/lecture.pdf' : 'lecture.pdf'; mkdirSync(directory ? file('old') : folder, { recursive: true }); mkdirSync(file('new-parent'))
    writeFileSync(file(path), '%PDF-1.7\noriginal')
    createBoundPDFRepositories(ctx.db, binding()).drawings.create({ courseId, relPath: path, page: 1, kind: 'ink', data: { points: [{ x: .2, y: .3, p: .6 }] }, style: { color: 'ink', width: .003, opacity: 1 } })
  }
  const seedNote = () => {
    writeFileSync(file('old.md'), '# Original title\n\nkeep body 한국어\n[[old.md]]\n')
    writeFileSync(file('references.md'), 'Other draft stays. [[old.md]]\n')
    createFavoritesRepo(ctx.db).add({ courseId, label: 'Saved note', descriptor: { kind: 'note', payload: { courseId, relPath: 'old.md' } } })
  }
  beforeEach(() => {
    ctx = createTestDb(); const course = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') }).create({ name: 'Recovery', color: 'green' }); courseId = course.id; folder = course.folderPath
    spec = { courseId, folder, dbPath: ctx.db.name, lockPath: join(ctx.dir, 'material-path-lock.db'), marker: join(ctx.dir, 'marker'), config: join(ctx.dir, 'worker.json') }
    workerPath = join(ctx.dir, 'worker.cjs'); writeFileSync(workerPath, worker)
  })
  afterEach(async () => { if (child) { const target = child; child = undefined; if (target.exitCode === null && target.signalCode === null) { target.kill('SIGKILL'); await new Promise(resolve => target.once('exit', resolve)) } } ctx.cleanup() })

  test.each(['before-move', 'after-move', 'before-commit', 'after-commit'])('SIGKILL at %s restarts with one canonical path and the same drawing', stage => {
    seed(); const id = (ctx.db.prepare('SELECT id FROM pdf_drawings').get() as any).id
    const crash = run({ stage }); expect(crash.signal, crash.stderr).toBe('SIGKILL')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    const recovered = JSON.parse(result.stdout), expected = stage === 'before-move' ? 'lecture.pdf' : 'renamed.pdf'
    expect(recovered.pending).toBe(0); expect(recovered.drawings).toEqual([{ id, rel_path: expected }]); expect(recovered.aliases[0].rel_path).toBe(expected)
    expect(readFileSync(file(expected), 'utf8')).toBe('%PDF-1.7\noriginal')
    expect(existsSync(file(expected === 'lecture.pdf' ? 'renamed.pdf' : 'lecture.pdf'))).toBe(false)
  })
  test('folder rename recovers through the original callback', () => {
    seed(true); expect(run({ stage: 'after-move', directory: true }).signal).toBe('SIGKILL')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).drawings[0].rel_path).toBe('new/lecture.pdf'); expect(count()).toBe(0)
    expect(binding().check({ courseId, relPath: 'new/lecture.pdf' }).documentRevision).toBe(pdfFileRevision(file('new/lecture.pdf')))
  })
  test('folder backlink atomic rewrite before a killed SQL commit still recovers forward', () => {
    seed(true); writeFileSync(file('old/note.md'), 'Keep this thought: [[old/lecture.pdf]]')
    expect(run({ stage: 'before-commit', directory: true, rewriteNote: true }).signal).toBe('SIGKILL')
    expect(readFileSync(file('new/note.md'), 'utf8')).toBe('Keep this thought: [[new/lecture.pdf]]')
    expect((ctx.db.prepare('SELECT rel_path FROM pdf_drawings').get() as any).rel_path).toBe('old/lecture.pdf')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(0); expect(JSON.parse(result.stdout).drawings[0].rel_path).toBe('new/lecture.pdf')
    expect(readFileSync(file('new/note.md'), 'utf8')).toBe('Keep this thought: [[new/lecture.pdf]]')
  })
  test('a relocated container prefix resumes only when the course folder inode is unchanged', () => {
    seed(); expect(run({ stage: 'after-move' }).signal).toBe('SIGKILL')
    const relocated = folder + '-new-container'; renameSync(folder, relocated)
    const result = run({ action: 'recover', stage: undefined, folder: relocated }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(0); expect(JSON.parse(result.stdout).drawings[0].rel_path).toBe('renamed.pdf')
    expect(readFileSync(join(relocated, 'renamed.pdf'), 'utf8')).toBe('%PDF-1.7\noriginal')
  })
  test('folder identity tolerance for own note rewrites does not accept a changed child PDF', () => {
    seed(true); expect(run({ stage: 'after-move', directory: true }).signal).toBe('SIGKILL')
    writeFileSync(file('new/lecture.pdf'), '%PDF-foreign child')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(1); expect(JSON.parse(result.stdout).drawings[0].rel_path).toBe('old/lecture.pdf')
    expect(readFileSync(file('new/lecture.pdf'), 'utf8')).toBe('%PDF-foreign child')
  })
  test('file move into another directory recovers with the same material identity', () => {
    seed(); mkdirSync(file('new')); const originalID = binding().check({ courseId, relPath: 'lecture.pdf' }).materialID
    expect(run({ stage: 'after-move', move: true }).signal).toBe('SIGKILL')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).drawings[0].rel_path).toBe('new/lecture.pdf'); expect(count()).toBe(0)
    expect(binding().check({ courseId, relPath: 'new/lecture.pdf' }).materialID).toBe(originalID)
  })
  test('a user rename waits for a background project read before mutating once', async () => {
    seed()
    const openLock = (path: string) => new SQLite(path, { timeout: 0 })
    const background = createMaterialPathLock(spec.lockPath, openLock)
    const releaseBackground = background.tryAcquire()!
    const pathChanged = vi.fn()
    const acquired = vi.fn(() => createMaterialPathLock(spec.lockPath, openLock).tryAcquire())
    const repo = createMaterialsRepo({ db: ctx.db, getCourseFolder: () => folder,
      revealItem: () => {}, trashItem: async () => {}, pathLock: { tryAcquire: acquired }, onPathChanged: pathChanged })
    const pending = repo.rename({ courseId, relPath: 'lecture.pdf', newName: 'renamed.pdf' })
    try {
      await vi.waitFor(() => expect(acquired).toHaveBeenCalled())
      expect(existsSync(file('lecture.pdf'))).toBe(true)
      expect(existsSync(file('renamed.pdf'))).toBe(false)
      expect(pathChanged).not.toHaveBeenCalled()
    } finally { releaseBackground() }
    await expect(pending).resolves.toEqual({ relPath: 'renamed.pdf' })
    expect(pathChanged).toHaveBeenCalledOnce()
    expect(existsSync(file('lecture.pdf'))).toBe(false)
    expect(existsSync(file('renamed.pdf'))).toBe(true)
  })
  test('a live owner is not recovered by another process; termination releases its lock', async () => {
    seed(); writeFileSync(spec.config, JSON.stringify({ ...spec, stage: 'live' })); child = spawn(process.execPath, [workerPath, spec.config], { stdio: 'ignore' })
    await vi.waitFor(() => expect(existsSync(spec.marker)).toBe(true))
    const whileLive = run({ action: 'recover' }); expect(whileLive.status, whileLive.stderr).toBe(0)
    expect(JSON.parse(whileLive.stdout).pending).toBe(1)
    expect((ctx.db.prepare('SELECT rel_path FROM pdf_drawings').get() as any).rel_path).toBe('lecture.pdf')
    const exited = new Promise(resolve => child!.once('exit', resolve)); child.kill('SIGKILL'); await exited; child = undefined
    const after = run({ action: 'recover' }); expect(after.status, after.stderr).toBe(0); expect(JSON.parse(after.stdout).pending).toBe(0)
    expect(JSON.parse(after.stdout).drawings[0].rel_path).toBe('renamed.pdf')
  })
  test.each(['old-occupied', 'destination-replaced', 'folder-relinked'])('preserves every file and blocks reads and first-observed binding after %s', conflict => {
    seed(); expect(run({ stage: 'after-move' }).signal).toBe('SIGKILL')
    if (conflict === 'old-occupied') writeFileSync(file('lecture.pdf'), '%PDF-foreign')
    if (conflict === 'destination-replaced') { renameSync(file('renamed.pdf'), file('preserved.pdf')); writeFileSync(file('renamed.pdf'), '%PDF-foreign') }
    if (conflict === 'folder-relinked') { renameSync(folder, folder + '-preserved'); mkdirSync(folder); writeFileSync(file('lecture.pdf'), '%PDF-foreign') }
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).pending).toBe(1)
    expect((ctx.db.prepare('SELECT rel_path FROM pdf_drawings').get() as any).rel_path).toBe('lecture.pdf')
    expect(() => binding().check({ courseId, relPath: 'lecture.pdf' })).toThrow(/복구/)
    const materials = createMaterialsRepo({ db: ctx.db, getCourseFolder: () => folder, revealItem() {}, trashItem: async () => {} })
    expect(() => materials.absolutePathFor(courseId, 'lecture.pdf')).toThrow(/복구/)
    if (conflict !== 'destination-replaced') expect(readFileSync(file('lecture.pdf'), 'utf8')).toBe('%PDF-foreign')
    else { expect(readFileSync(file('renamed.pdf'), 'utf8')).toBe('%PDF-foreign'); expect(readFileSync(file('preserved.pdf'), 'utf8')).toBe('%PDF-1.7\noriginal') }
  })
  test.each(['before-move', 'after-move', 'before-note-publish', 'after-note-publish', 'before-commit', 'after-commit'])('notesRepo filename, H1, self-links and outside backlinks survive SIGKILL at %s', stage => {
    seedNote(); const killed = run({ stage, note: true }); expect(killed.signal, killed.stderr).toBe('SIGKILL')
    const pending = ctx.db.prepare('SELECT note_writes FROM material_path_intents').get() as any
    if (stage !== 'after-commit') {
      const writes = JSON.parse(pending.note_writes)
      expect(writes.find((n: any) => n.relPath === 'renamed.md')).toMatchObject({ before: '# Original title\n\nkeep body 한국어\n[[old.md]]\n', after: '# renamed\n\nkeep body 한국어\n[[renamed.md]]\n' })
    }
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    const recovered = JSON.parse(result.stdout), path = stage === 'before-move' ? 'old.md' : 'renamed.md'
    expect(recovered.pending).toBe(0); expect(recovered.favorites[0].payload.relPath).toBe(path)
    expect(readFileSync(file(path), 'utf8')).toBe(stage === 'before-move' ? '# Original title\n\nkeep body 한국어\n[[old.md]]\n' : '# renamed\n\nkeep body 한국어\n[[renamed.md]]\n')
    expect(readFileSync(file('references.md'), 'utf8')).toBe(`Other draft stays. [[${path}]]\n`)
    expect(existsSync(file(path === 'old.md' ? 'renamed.md' : 'old.md'))).toBe(false)
  })
  test('same filename H1 rewrite resumes after the atomic inode changes', () => {
    seedNote(); expect(run({ stage: 'after-note-publish', note: true, sameName: true }).signal).toBe('SIGKILL')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(0); expect(readFileSync(file('old.md'), 'utf8')).toBe('# old\n\nkeep body 한국어\n[[old.md]]\n')
  })
  test('material Markdown rename recovers after its self-link atomic write changes inode', () => {
    seedNote(); expect(run({ stage: 'after-note-publish', markdownMaterial: true, rewriteNote: true }).signal).toBe('SIGKILL')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(0); expect(JSON.parse(result.stdout).favorites[0].payload.relPath).toBe('renamed.md')
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# Original title\n\nkeep body 한국어\n[[renamed.md]]\n')
  })
  test('failed heading publication preserves original text and resumes at the new path', () => {
    seedNote(); const failed = run({ stage: 'write-failure', note: true }); expect(failed.status).toBe(1); expect(failed.stderr).toMatch(/injected note publish failure/)
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# Original title\n\nkeep body 한국어\n[[old.md]]\n')
    expect(count()).toBe(1)
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).pending).toBe(0); expect(JSON.parse(result.stdout).favorites[0].payload.relPath).toBe('renamed.md')
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# renamed\n\nkeep body 한국어\n[[renamed.md]]\n')
  })
  test('failed intent deletion rolls SQL back while preserving the already written note and backlinks', () => {
    seedNote(); createMaterialPathJournal(ctx.db, () => folder)
    ctx.db.exec("CREATE TRIGGER fail_note_completion BEFORE DELETE ON material_path_intents BEGIN SELECT RAISE(ABORT,'injected intent completion failure'); END")
    const failed = run({ note: true }); expect(failed.status).toBe(1); expect(failed.stderr).toMatch(/injected intent completion failure/)
    expect(count()).toBe(1); expect(JSON.parse((ctx.db.prepare('SELECT descriptor_json FROM favorites').get() as any).descriptor_json).payload.relPath).toBe('old.md')
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# renamed\n\nkeep body 한국어\n[[renamed.md]]\n')
    expect(readFileSync(file('references.md'), 'utf8')).toBe('Other draft stays. [[renamed.md]]\n')
    ctx.db.exec('DROP TRIGGER fail_note_completion')
    const result = run({ action: 'recover' }); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).pending).toBe(0)
    expect(JSON.parse(result.stdout).favorites[0].payload.relPath).toBe('renamed.md')
    expect(readFileSync(file('renamed.md'), 'utf8')).toContain('keep body 한국어')
  })
  test('a newer external draft written after staging is preserved alongside planned before/after text', () => {
    seedNote(); const failed = run({ stage: 'external-before-publish', note: true }); expect(failed.status).toBe(1); expect(failed.stderr).toMatch(/Note changed/)
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# External editor\n\nKEEP THIS NEW DRAFT\n')
    const intent = ctx.db.prepare('SELECT note_writes FROM material_path_intents').get() as any
    const versions = JSON.parse(intent.note_writes); expect(versions.find((n: any) => n.relPath === 'renamed.md').before).toContain('keep body 한국어')
    expect(versions.find((n: any) => n.relPath === 'renamed.md').after).toContain('# renamed')
    const result = run({ action: 'recover', stage: undefined }); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).pending).toBe(1)
    expect(readFileSync(file('renamed.md'), 'utf8')).toBe('# External editor\n\nKEEP THIS NEW DRAFT\n')
    const material = createMaterialsRepo({ db: ctx.db, getCourseFolder: () => folder, revealItem() {}, trashItem: async () => {} })
    const notes = createNotesRepo({ getCourseFolder: () => folder, renameWithMarkdown: input => material.renameWithMarkdown(input), assertPathAvailable: (id, path) => material.assertPathAvailable(id, path) })
    expect(() => notes.write({ courseId, relPath: 'renamed.md', markdown: 'stale editor overwrite' })).toThrow(/복구/)
    expect(() => notes.write({ courseId, relPath: 'references.md', markdown: 'stale backlink overwrite' })).toThrow(/복구/)
  })
  test('standalone intent forces FULL durability and restores the connection setting; held locks reject another owner', () => {
    seed(); ctx.db.pragma('synchronous=NORMAL')
    const journal = createMaterialPathJournal(ctx.db, () => folder), observed: number[] = [], prepare = ctx.db.prepare.bind(ctx.db)
    const spy = vi.spyOn(ctx.db, 'prepare').mockImplementation((sql: string) => { if (sql.startsWith('INSERT INTO material_path_intents')) observed.push(ctx.db.pragma('synchronous', { simple: true }) as number); return prepare(sql) })
    journal.begin({ courseId, fromRelPath: 'lecture.pdf', toRelPath: 'renamed.pdf', isDirectory: false }, folder)
    spy.mockRestore(); expect(observed).toEqual([2]); expect(ctx.db.pragma('synchronous', { simple: true })).toBe(1)
    const lockA = createMaterialPathLock(spec.lockPath, path => new SQLite(path, { timeout: 0 })), lockB = createMaterialPathLock(spec.lockPath, path => new SQLite(path, { timeout: 0 }))
    const release = lockA.tryAcquire()!; expect(lockB.tryAcquire()).toBeUndefined(); release(); release(); const releaseB = lockB.tryAcquire(); expect(releaseB).toBeTypeOf('function'); releaseB!()
  })
})
