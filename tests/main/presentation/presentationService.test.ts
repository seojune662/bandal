import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPresentationService } from '../../../src/main/features/presentation/presentationService'
import { createMaterialsRepo } from '../../../src/main/features/materials'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createPdfExporter } from '../../../src/main/features/pdf/exportPdf'
import { createTestDb, type TestDb } from '../helpers/testDb'

vi.mock('../../../src/main/features/pdf/exportPdf', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/main/features/pdf/exportPdf')>(),
  resolveDefaultFontPath: (file: string) => join(process.cwd(), 'resources', 'fonts', file)
}))

let ctx: TestDb, service: ReturnType<typeof createPresentationService>, courseId: string, folder: string
const changed = vi.fn()
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
beforeEach(() => {
  ctx = createTestDb()
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'courses') })
  const course = courses.create({ name: 'PPT', color: 'green' })
  courseId = course.id; folder = course.folderPath
  writeFileSync(join(folder, '강의.pptx'), 'original-source')
  const materials = createMaterialsRepo({ db: ctx.db, getCourseFolder: (id) => courses.getFolder(id), revealItem: () => {}, trashItem: async () => {} })
  const exporter = createPdfExporter({ getCourseFolder: (id) => courses.getFolder(id), listDrawings: () => [], listAnnotations: () => [] })
  service = createPresentationService({ userData: ctx.dir, materials, exporter, changed })
})
afterEach(() => { ctx.cleanup(); vi.clearAllMocks() })

test('preserves source, slide dimensions, searchable Korean text and existing PDF copies', async () => {
  const { sessionId } = await service.start({ courseId, relPath: '강의.pptx', pageCount: 2, includeInk: true })
  writeFileSync(join(folder, '강의.pdf'), 'existing-pdf')
  await service.append({ sessionId, index: 0, width: 720, height: 540, pngBase64, text: [{ text: '한글 강의', x: 72, y: 72, width: 300, height: 30, fontSize: 24, rotation: 0 }] })
  await service.append({ sessionId, index: 1, width: 960, height: 540, pngBase64, text: [] })
  const result = await service.finish(sessionId)
  expect(result.relPath).not.toBe('강의.pdf')
  expect(readFileSync(join(folder, '강의.pdf'), 'utf8')).toBe('existing-pdf')
  expect(readFileSync(join(folder, '강의.pptx'), 'utf8')).toBe('original-source')
  const bytes = readFileSync(join(folder, result.relPath))
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPages().map((page) => page.getSize())).toEqual([{ width: 720, height: 540 }, { width: 960, height: 540 }])
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise
  try { expect((await (await doc.getPage(1)).getTextContent()).items.map((item) => 'str' in item ? item.str : '').join('')).toContain('한글 강의') }
  finally { await doc.destroy() }
  expect(changed).toHaveBeenCalledWith(courseId)
  expect(readdirSync(join(ctx.dir, 'presentation-pdf'))).toEqual([])
})

test('rejects malformed, missing and out-of-order pages; cancellation cleans staging', async () => {
  const { sessionId } = await service.start({ courseId, relPath: '강의.pptx', pageCount: 1, includeInk: false })
  const page = { sessionId, index: 0, width: 720, height: 540, pngBase64, text: [] }
  await expect(service.finish(sessionId)).rejects.toThrow('모든 슬라이드')
  await expect(service.append({ ...page, index: 1 })).rejects.toThrow('순서')
  await expect(service.append({ ...page, width: NaN })).rejects.toThrow('크기')
  await expect(service.append({ ...page, pngBase64: Buffer.from('not-a-png').toString('base64') })).rejects.toThrow('형식')
  await service.append(page)
  await expect(service.append(page)).rejects.toThrow('순서')
  await service.cancel(sessionId)
  await expect(service.finish(sessionId)).rejects.toThrow('만료')
  expect(readdirSync(join(ctx.dir, 'presentation-pdf'))).toEqual([])
  expect(readdirSync(folder)).toEqual(['강의.pptx'])
})

test('only permits course-scoped presentation sources and bounded page counts', async () => {
  await expect(service.prepare({ courseId, relPath: '../secret.pptx', requestId: 'x' })).rejects.toThrow()
  await expect(service.start({ courseId, relPath: 'x.txt', pageCount: 1, includeInk: false })).rejects.toThrow('PPT')
  await expect(service.start({ courseId, relPath: '강의.pptx', pageCount: 1001, includeInk: false })).rejects.toThrow('1,000')
})
