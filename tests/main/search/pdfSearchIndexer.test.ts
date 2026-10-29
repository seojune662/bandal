import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createSearchIndex, type SearchIndex } from '../../../src/main/features/search/searchIndex'
import { indexPdfSearchScope, type SearchPdfDocument } from '../../../src/main/features/search/pdfSearchIndexer'
import type { PdfSearchRequest } from '../../../src/main/features/search/pdfSearchProtocol'

let ctx: TestDb, index: SearchIndex, request: PdfSearchRequest
beforeEach(() => {
  ctx = createTestDb()
  const folder = join(ctx.dir, 'course'); mkdirSync(folder)
  request = { dbPath: ctx.db.name, courseId: 'course-1', folder, rootRelPath: '' }
  index = createSearchIndex(ctx.db, { getCourseFolder: () => folder, refreshOnQuery: false })
})
afterEach(() => ctx.cleanup())
function document(pages: string[]): SearchPdfDocument {
  return { numPages: pages.length, getPage: async page => ({ getTextContent: async () => ({ items: [{ str: pages[page - 1] }] }), cleanup: vi.fn() }), destroy: vi.fn(async () => {}) }
}
test('unopened PDFs index beyond 200 pages and 200,000 characters with incremental results', async () => {
  writeFileSync(join(request.folder, 'book.pdf'), 'fixture pdf')
  const pages = Array.from({ length: 205 }, (_, i) => i === 204 ? 'last-page-needle' : 'plain text '.repeat(110))
  const progress = vi.fn(status => {
    if (status.indexedPages === 1) expect(index.query('course-1', 'plain')).toHaveLength(1)
  })
  const open = vi.fn(async () => document(pages))
  const result = await indexPdfSearchScope(request, index, progress, open)
  expect(result).toMatchObject({ phase: 'ready', totalFiles: 1, processedFiles: 1, indexedPages: 205 })
  expect(index.query('course-1', 'last-page-needle')[0]).toMatchObject({ relPath: 'book.pdf', page: 205 })
  await indexPdfSearchScope(request, index, vi.fn(), open)
  expect(open).toHaveBeenCalledTimes(1)
})
test('replacement with fewer pages removes old hits and deleted files are pruned', async () => {
  const path = join(request.folder, 'book.pdf')
  writeFileSync(path, 'old bytes')
  await indexPdfSearchScope(request, index, vi.fn(), async () => document(['old first', 'removed-page-needle']))
  writeFileSync(path, 'new replacement bytes')
  await indexPdfSearchScope(request, index, vi.fn(), async () => document(['new-page-needle']))
  expect(index.query('course-1', 'removed-page-needle')).toEqual([])
  expect(index.query('course-1', 'new-page-needle')).toHaveLength(1)
  unlinkSync(path)
  await indexPdfSearchScope(request, index, vi.fn(), async () => document([]))
  expect(index.query('course-1', 'new-page-needle')).toEqual([])
})
test('a failed or scanned PDF preserves other successful matches and exposes partial status', async () => {
  for (const name of ['good', 'scan', 'locked']) writeFileSync(join(request.folder, `${name}.pdf`), name)
  const result = await indexPdfSearchScope(request, index, vi.fn(), async bytes => {
    const name = new TextDecoder().decode(bytes)
    if (name === 'locked') throw Object.assign(new Error('password'), { name: 'PasswordException' })
    return document(name === 'scan' ? [''] : ['searchable content'])
  })
  expect(result.phase).toBe('partial')
  expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ relPath: 'locked.pdf', reason: '암호로 잠긴 PDF입니다.' }), expect.objectContaining({ relPath: 'scan.pdf' })]))
  expect(index.query('course-1', 'searchable')).toHaveLength(1)
})
test('folder search recursively extracts only its own PDFs', async () => {
  mkdirSync(join(request.folder, 'project', 'nested'), { recursive: true })
  writeFileSync(join(request.folder, 'outside.pdf'), 'outside')
  writeFileSync(join(request.folder, 'project', 'nested', 'inside.pdf'), 'inside')
  const open = vi.fn(async () => document(['needle']))
  await indexPdfSearchScope({ ...request, rootRelPath: 'project' }, index, vi.fn(), open)
  expect(open).toHaveBeenCalledTimes(1)
  expect(index.query('course-1', 'needle')[0]?.relPath).toBe('project/nested/inside.pdf')
})
test('real unopened PDF pages are searchable using the shared text-only runtime', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const text of ['First source page', 'Second searchable evidence']) pdf.addPage().drawText(text, { x: 20, y: 300, size: 12, font })
  writeFileSync(join(request.folder, 'real.pdf'), await pdf.save())
  const result = await indexPdfSearchScope(request, index, vi.fn())
  expect(result.phase).toBe('ready')
  expect(index.query('course-1', 'searchable evidence')[0]).toMatchObject({ relPath: 'real.pdf', page: 2 })
})
test('changing a PDF during extraction discards already indexed pages from the old revision', async () => {
  const path = join(request.folder, 'changing.pdf')
  writeFileSync(path, 'before')
  let changed = false
  const result = await indexPdfSearchScope(request, index, status => {
    if (!changed && status.indexedPages === 1) { changed = true; writeFileSync(path, 'replaced while reading') }
  }, async () => document(['old-page-one', 'old-page-two']))
  expect(result.phase).toBe('partial')
  expect(index.query('course-1', 'old-page')).toEqual([])
})
