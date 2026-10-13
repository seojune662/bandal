import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createDrawingsRepo } from '../../../src/main/features/pdf/drawingsRepo'
import { createPDFDocumentBindings, createBoundPDFRepositories } from '../../../src/main/features/pdf/pdfDocumentBinding'
import { createPDFOriginalPreserver, pdfFileRevision } from '../../../src/main/features/pdf/pdfOriginals'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
import type { CreateDrawingInput } from '../../../src/shared/types/drawing'

describe('durable PDF identity and original binding', () => {
  let ctx: TestDb, courseId: string, folder: string
  const original = '%PDF-1.7\noriginal lecture bytes', replacement = '%PDF-1.7\nreplacement lecture bytes'
  const file = (relPath: string) => join(folder, relPath)
  const makeFile = (relPath = 'lecture.pdf') => { mkdirSync(dirname(file(relPath)), { recursive: true }); writeFileSync(file(relPath), original); return pdfFileRevision(file(relPath)) }
  const input = (relPath = 'lecture.pdf'): CreateDrawingInput => ({ courseId, relPath, page: 1, kind: 'ink', data: { inkVersion: 2, points: [{ x: .1, y: .2, p: .6, t: 0, tiltX: -20, tiltY: 15 }] }, style: { color: 'ink', width: .003, opacity: 1 } })
  const bindings = () => createPDFDocumentBindings(ctx.db, (_id, relPath) => pdfFileRevision(file(relPath)), createPDFOriginalPreserver(join(ctx.dir, 'PDFOriginals'), (_id, relPath) => file(relPath)))
  beforeEach(() => {
    ctx = createTestDb()
    const course = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') }).create({ name: 'Binding', color: 'green' })
    courseId = course.id; folder = course.folderPath
  })
  afterEach(() => ctx.cleanup())

  test('preserves original bytes and blocks all row consumers after replacement', () => {
    const revision = makeFile(), binding = bindings(), { drawings, annotations } = createBoundPDFRepositories(ctx.db, binding)
    const drawing = drawings.create(input())
    const annotation = annotations.create({ courseId, relPath: 'lecture.pdf', page: 1, color: 'pink', rects: [{ x: .1, y: .2, width: .3, height: .04 }], anchor: { quote: 'quote', prefix: '', suffix: '' } })
    const before = ctx.db.prepare('SELECT * FROM pdf_drawings').all()
    writeFileSync(file('lecture.pdf'), replacement)
    for (const operation of [() => drawings.listForFile(courseId, 'lecture.pdf'), () => annotations.listForFile({ courseId, relPath: 'lecture.pdf' }), () => drawings.create(input()), () => drawings.update({ id: drawing.id, data: { points: [{ x: .2, y: .3, p: .8 }] } }), () => drawings.softDelete([drawing.id]), () => annotations.softDelete({ id: annotation.id })]) expect(operation).toThrow(/기존 필기/)
    expect(ctx.db.prepare('SELECT * FROM pdf_drawings').all()).toEqual(before)
    expect(readFileSync(file('lecture.pdf'), 'utf8')).toBe(replacement)
    expect(readFileSync(join(ctx.dir, 'PDFOriginals', revision + '.pdf'), 'utf8')).toBe(original)
    expect(() => bindings().check({ courseId, relPath: 'lecture.pdf' })).toThrow(/기존 필기/)
  })
  test('migrates a committed revision even when first observed file is already replaced', () => {
    const revision = makeFile(), raw = createDrawingsRepo(ctx.db, { documentRevision: () => revision })
    const created = raw.create({ ...input(), documentRevision: revision, clientMutationId: randomUUID() })
    writeFileSync(file('lecture.pdf'), replacement)
    const binding = bindings()
    expect(() => binding.check({ courseId, relPath: 'lecture.pdf' })).toThrow(/기존 필기/)
    expect(ctx.db.prepare('SELECT bound_sha,evidence FROM pdf_document_bindings').get()).toEqual({ bound_sha: revision, evidence: 'receipt' })
    expect(raw.listForFile(courseId, 'lecture.pdf')[0]?.id).toBe(created.id)
  })
  test('marks unversioned legacy evidence honestly and keeps new native receipts idempotent', () => {
    const revision = makeFile(), raw = createDrawingsRepo(ctx.db)
    raw.create(input())
    const binding = bindings()
    expect(binding.check({ courseId, relPath: 'lecture.pdf' })).toMatchObject({ documentRevision: revision, evidence: 'first-observed', legacyUnverified: true })
    const { drawings } = createBoundPDFRepositories(ctx.db, binding)
    const native = { ...input(), clientMutationId: randomUUID(), documentRevision: revision }
    const created = drawings.create(native)
    expect(drawings.create(native).id).toBe(created.id)
    expect(() => drawings.create({ ...native, clientMutationId: randomUUID(), documentRevision: 'a'.repeat(64) })).toThrow(/원본/)
    expect(raw.listForFile(courseId, 'lecture.pdf')).toHaveLength(2)
  })
  test('file and directory rename preserve identity and immutable create receipts', () => {
    const revision = makeFile('old/sub.pdf'), binding = bindings(), { drawings } = createBoundPDFRepositories(ctx.db, binding)
    drawings.create({ ...input('old/sub.pdf'), documentRevision: revision, clientMutationId: randomUUID() })
    const first = binding.check({ courseId, relPath: 'old/sub.pdf' }), receipt = ctx.db.prepare('SELECT request_json FROM drawing_create_receipts').get()
    renameSync(file('old'), file('new'))
    const change = { courseId, fromRelPath: 'old', toRelPath: 'new', isDirectory: true }
    binding.repoint(change); repointMaterialPath({ ...change, db: ctx.db, courseFolder: folder })
    expect(bindings().check({ courseId, relPath: 'new/sub.pdf' }).materialID).toBe(first.materialID)
    expect(drawings.listForFile(courseId, 'new/sub.pdf')).toHaveLength(1)
    expect(ctx.db.prepare('SELECT request_json FROM drawing_create_receipts').get()).toEqual(receipt)
  })
  test('rebuildable material index cannot replace its persistent identity', () => {
    makeFile(); const binding = bindings(), first = binding.check({ courseId, relPath: 'lecture.pdf' })
    ctx.db.prepare('INSERT INTO materials_index(id,course_id,rel_path,kind,size,mtime,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), courseId, 'lecture.pdf', 'pdf', 10, 10, 'now', 'now')
    binding.reconcileIndex()
    expect(ctx.db.prepare('SELECT id FROM materials_index WHERE rel_path=?').get('lecture.pdf')).toEqual({ id: first.materialID })
  })
  test('sync history proves earlier original and never silently picks between incompatible revisions', () => {
    const revision = makeFile()
    ctx.db.exec('CREATE TABLE ipad_sync_projection(kind TEXT,payload_json TEXT,source_json TEXT)')
    ctx.db.prepare('INSERT INTO ipad_sync_projection VALUES(?,?,?)').run('drawing', JSON.stringify({ documentRevision: revision }), JSON.stringify({ courseID: courseId, relPath: 'lecture.pdf' }))
    writeFileSync(file('lecture.pdf'), replacement)
    expect(() => bindings().check({ courseId, relPath: 'lecture.pdf' })).toThrow(/기존 필기/)
    expect(ctx.db.prepare('SELECT bound_sha,evidence FROM pdf_document_bindings').get()).toEqual({ bound_sha: revision, evidence: 'sync' })
    const revision2 = makeFile('ambiguous.pdf')
    createDrawingsRepo(ctx.db, { documentRevision: () => revision2 }).create({ ...input('ambiguous.pdf'), documentRevision: revision2, clientMutationId: randomUUID() })
    ctx.db.prepare('INSERT INTO ipad_sync_projection VALUES(?,?,?)').run('drawing', JSON.stringify({ documentRevision: 'a'.repeat(64) }), JSON.stringify({ courseID: courseId, relPath: 'ambiguous.pdf' }))
    expect(() => bindings().check({ courseId, relPath: 'ambiguous.pdf' })).toThrow(/서로 다른/)
  })
  test('an unopened legacy PDF renamed immediately after migration retains sync evidence', () => {
    const revision = makeFile('unopened.pdf')
    createDrawingsRepo(ctx.db).create(input('unopened.pdf'))
    ctx.db.exec('CREATE TABLE ipad_sync_projection(kind TEXT,payload_json TEXT,source_json TEXT)')
    ctx.db.prepare('INSERT INTO ipad_sync_projection VALUES(?,?,?)').run('drawing', JSON.stringify({ documentRevision: revision }), JSON.stringify({ courseID: courseId, relPath: 'unopened.pdf' }))
    const binding = bindings(), change = { courseId, fromRelPath: 'unopened.pdf', toRelPath: 'moved.pdf', isDirectory: false }
    renameSync(file('unopened.pdf'), file('moved.pdf'))
    binding.repoint(change); repointMaterialPath({ ...change, db: ctx.db, courseFolder: folder })
    expect(binding.check({ courseId, relPath: 'moved.pdf' })).toMatchObject({ documentRevision: revision, evidence: 'sync', legacyUnverified: false })
    writeFileSync(file('moved.pdf'), replacement)
    expect(() => bindings().check({ courseId, relPath: 'moved.pdf' })).toThrow(/기존 필기/)
  })
  test('failed original verification neither acknowledges preservation nor changes source bytes', () => {
    const revision = makeFile(), directory = join(ctx.dir, 'PDFOriginals')
    mkdirSync(directory); writeFileSync(join(directory, revision + '.pdf'), 'corrupt recovery file')
    const preserve = createPDFOriginalPreserver(directory, (_id, relPath) => file(relPath))
    expect(() => preserve(courseId, 'lecture.pdf', revision)).toThrow(/integrity/)
    expect(readFileSync(file('lecture.pdf'), 'utf8')).toBe(original)
    expect(readFileSync(join(directory, revision + '.pdf'), 'utf8')).toBe('corrupt recovery file')
  })
})
