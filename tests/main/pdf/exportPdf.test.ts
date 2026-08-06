import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createPdfExporter } from '../../../src/main/features/pdf'
import { ValidationError } from '../../../src/main/db/errors'
import type { Annotation } from '../../../src/shared/types/annotation'
import type { Drawing } from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('createPdfExporter', () => {
  let ctx: TestDb
  let sourcePath: string
  let sourceBytes: Buffer
  const fontPath = join(process.cwd(), 'resources', 'fonts', 'NotoSansKR-Regular.otf')

  beforeEach(async () => {
    ctx = createTestDb()
    mkdirSync(join(ctx.dir, 'slides'))
    sourcePath = join(ctx.dir, 'slides', 'source.pdf')
    const pdf = await PDFDocument.create()
    pdf.addPage([400, 600])
    sourceBytes = Buffer.from(await pdf.save())
    writeFileSync(sourcePath, sourceBytes)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ctx.cleanup()
  })

  test('writes a separate readable PDF and leaves the source bytes unchanged', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const base = {
      courseId: 'course-1',
      relPath: 'slides/source.pdf',
      page: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    const drawings: Drawing[] = [
      {
        ...base,
        id: 'ink',
        kind: 'ink',
        data: { points: [{ x: 0.1, y: 0.2, p: 0.5 }, { x: 0.8, y: 0.7, p: 0.9 }] },
        style: { color: 'blue', width: 0.006, opacity: 0.9 }
      },
      {
        ...base,
        id: 'rect',
        kind: 'rect',
        data: { box: { x: 0.2, y: 0.25, width: 0.3, height: 0.2 } },
        style: { color: 'red', width: 0.004, opacity: 1 }
      },
      {
        ...base,
        id: 'text',
        kind: 'textbox',
        data: { box: { x: 0.15, y: 0.55, width: 0.4, height: 0.12 }, text: '메모 note' },
        style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1 }
      }
    ]
    const annotations: Annotation[] = [{
      ...base,
      id: 'highlight',
      color: 'yellow',
      rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.04 }],
      anchor: { quote: 'quote', prefix: '', suffix: '' },
      comment: null
    }]
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => drawings,
      listAnnotations: () => annotations,
      resolveFontPath: () => fontPath
    })
    const outputPath = join(ctx.dir, 'annotated.pdf')

    await exporter.exportAnnotated({ courseId: 'course-1', relPath: 'slides/source.pdf' }, outputPath)

    expect(readFileSync(sourcePath)).toEqual(sourceBytes)
    expect(readFileSync(outputPath)).not.toEqual(sourceBytes)
    expect((await PDFDocument.load(readFileSync(outputPath))).getPageCount()).toBe(1)
  })

  test('exports a valid PDF containing a Korean textbox', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const drawings: Drawing[] = [{
      id: 'korean-text',
      courseId: 'course-1',
      relPath: 'slides/source.pdf',
      page: 1,
      kind: 'textbox',
      data: {
        box: { x: 0.1, y: 0.1, width: 0.22, height: 0.3 },
        text: '공백없이이어지는한글도글자단위로줄바꿈됩니다'
      },
      style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1 },
      createdAt: timestamp,
      updatedAt: timestamp
    }]
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => drawings,
      listAnnotations: () => [],
      resolveFontPath: () => fontPath
    })
    const outputPath = join(ctx.dir, 'korean-annotated.pdf')

    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      outputPath
    )

    const outputBytes = readFileSync(outputPath)
    expect(outputBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await PDFDocument.load(outputBytes)).getPageCount()).toBe(1)
  })

  test('falls back to Helvetica when the Korean font cannot be loaded', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const drawings: Drawing[] = [{
      id: 'fallback-text',
      courseId: 'course-1',
      relPath: 'slides/source.pdf',
      page: 1,
      kind: 'textbox',
      data: {
        box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
        text: '한글 폰트를 찾을 수 없음'
      },
      style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1 },
      createdAt: timestamp,
      updatedAt: timestamp
    }]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => drawings,
      listAnnotations: () => [],
      resolveFontPath: () => join(ctx.dir, 'missing-font.otf')
    })
    const outputPath = join(ctx.dir, 'fallback-annotated.pdf')

    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      outputPath
    )

    const outputBytes = readFileSync(outputPath)
    expect(outputBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await PDFDocument.load(outputBytes)).getPageCount()).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to Helvetica'),
      expect.anything()
    )
  })

  test('resolves and reads the Korean font only once per exporter', async () => {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const drawings: Drawing[] = [{
      id: 'cached-font-text',
      courseId: 'course-1',
      relPath: 'slides/source.pdf',
      page: 1,
      kind: 'textbox',
      data: {
        box: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
        text: '캐시된 글꼴'
      },
      style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1 },
      createdAt: timestamp,
      updatedAt: timestamp
    }]
    const cachedFontPath = join(ctx.dir, 'cached-font.otf')
    copyFileSync(fontPath, cachedFontPath)
    const resolveFontPath = vi.fn(() => cachedFontPath)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => drawings,
      listAnnotations: () => [],
      resolveFontPath
    })

    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      join(ctx.dir, 'first-export.pdf')
    )
    unlinkSync(cachedFontPath)
    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      join(ctx.dir, 'second-export.pdf')
    )

    expect(resolveFontPath).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  test('refuses to overwrite the original path', async () => {
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => [],
      listAnnotations: () => []
    })

    await expect(exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      sourcePath
    )).rejects.toBeInstanceOf(ValidationError)
    expect(readFileSync(sourcePath)).toEqual(sourceBytes)
  })
})
