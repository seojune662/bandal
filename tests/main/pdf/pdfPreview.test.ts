import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createPDFDocumentBindings, createBoundPDFRepositories } from '../../../src/main/features/pdf/pdfDocumentBinding'
import { createPDFRevisionReader } from '../../../src/main/features/pdf/pdfOriginals'
import { createPDFPreviewReader } from '../../../src/main/features/pdf/pdfPreview'
import type { CreateDrawingInput } from '../../../src/shared/types/drawing'

describe('PDF first-page preview snapshots', () => {
  let ctx: TestDb, courseId: string, folder: string
  beforeEach(() => {
    ctx = createTestDb()
    const course = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') }).create({ name: 'Preview', color: 'green' })
    courseId = course.id; folder = course.folderPath
    writeFileSync(join(folder, 'lecture.pdf'), '%PDF-1.7\noriginal lecture')
    writeFileSync(join(folder, 'second.pdf'), '%PDF-1.7\nsecond lecture')
  })
  afterEach(() => ctx.cleanup())
  const input = (page = 1, relPath = 'lecture.pdf'): CreateDrawingInput => ({ courseId, relPath, page, kind: 'ink', data: { points: [{ x: .1, y: .2, p: .5 }] }, style: { color: 'ink', width: .003, opacity: 1 } })
  const setup = () => {
    const revision = createPDFRevisionReader()
    const revisionFor = (_courseId: string, relPath: string) => revision(join(folder, relPath))
    const bindings = createPDFDocumentBindings(ctx.db, revisionFor)
    const changed = vi.fn()
    const repos = createBoundPDFRepositories(ctx.db, bindings, undefined, changed)
    const checkBinding = vi.fn(bindings.check)
    const read = createPDFPreviewReader({ db: ctx.db, revisionFor, checkBinding })
    return { read, revisionFor, repos, changed, checkBinding }
  }

  test('returns every first-page mark, excluding other pages and deleted rows', () => {
    const { read, repos } = setup()
    for (let n = 0; n < 175; n++) repos.drawings.create(input())
    repos.drawings.create(input(2))
    const removed = repos.drawings.create(input())
    repos.drawings.softDelete([removed.id])
    const annotation = { courseId, relPath: 'lecture.pdf', color: 'pink' as const, rects: [{ x: .1, y: .2, width: .2, height: .1 }], anchor: { quote: 'lecture', prefix: '', suffix: '' } }
    repos.annotations.create({ ...annotation, page: 1 })
    repos.annotations.create({ ...annotation, page: 2 })
    const snapshot = read({ courseId, relPath: 'lecture.pdf' })
    expect(snapshot.drawings).toHaveLength(175)
    expect(snapshot.annotations).toHaveLength(1)
    expect(snapshot.drawings.every(row => row.page === 1)).toBe(true)
  })

  test('does not create durable PDF bindings merely to browse untouched PDFs', () => {
    const { read, checkBinding } = setup()
    expect(read({ courseId, relPath: 'lecture.pdf' }).drawings).toEqual([])
    expect(checkBinding).not.toHaveBeenCalled()
    expect(ctx.db.prepare('SELECT * FROM pdf_document_bindings').all()).toEqual([])
  })

  test('rejects old ink after an original replacement instead of compositing it', () => {
    const { read, repos } = setup()
    repos.drawings.create(input())
    const before = read({ courseId, relPath: 'lecture.pdf' })
    writeFileSync(join(folder, 'lecture.pdf'), '%PDF-1.7\nreplaced original')
    expect(() => read({ courseId, relPath: 'lecture.pdf' })).toThrow(/기존 필기/)
    expect(ctx.db.prepare('SELECT id FROM pdf_drawings WHERE deleted_at IS NULL').all()).toHaveLength(before.drawings.length)
  })

  test('rejects a file replaced during the snapshot read', () => {
    let reads = 0
    const read = createPDFPreviewReader({ db: ctx.db, revisionFor: () => (++reads === 1 ? 'a' : 'b').repeat(64), checkBinding: vi.fn() })
    expect(() => read({ courseId, relPath: 'lecture.pdf' })).toThrow(/원본이 변경/)
  })

  test('notifies all changed files after successful CRUD, but never failed mutations', () => {
    const { repos, changed, revisionFor } = setup()
    const first = repos.drawings.create(input())
    const second = repos.drawings.create(input(1, 'second.pdf'))
    repos.drawings.update({ id: first.id, data: { points: [{ x: .2, y: .3, p: .5 }] } })
    expect(changed).toHaveBeenLastCalledWith({ courseId, relPath: 'lecture.pdf', documentRevision: revisionFor(courseId, 'lecture.pdf') })
    changed.mockClear()
    repos.drawings.softDelete([first.id, second.id])
    expect(changed.mock.calls.map(([event]) => event.relPath).sort()).toEqual(['lecture.pdf', 'second.pdf'])
    changed.mockClear()
    expect(() => repos.drawings.create({ ...input(), documentRevision: 'a'.repeat(64) })).toThrow()
    expect(changed).not.toHaveBeenCalled()
    const annotation = repos.annotations.create({ courseId, relPath: 'lecture.pdf', page: 1, color: 'pink', rects: [{ x: .1, y: .2, width: .2, height: .1 }], anchor: { quote: 'lecture', prefix: '', suffix: '' } })
    repos.annotations.update({ id: annotation.id, comment: 'saved' })
    repos.annotations.softDelete({ id: annotation.id })
    expect(changed).toHaveBeenCalledTimes(3)
  })
})
