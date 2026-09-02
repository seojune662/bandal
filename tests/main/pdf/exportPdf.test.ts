import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { createPdfExporter, type TextboxFontFile } from '../../../src/main/features/pdf'
import { ValidationError } from '../../../src/main/db/errors'
import type { Annotation } from '../../../src/shared/types/annotation'
import type { Drawing, DrawingStyle } from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

const timestamp = '2026-01-01T00:00:00.000Z'
const fontsDir = join(process.cwd(), 'resources', 'fonts')
const bundledFont = (file: TextboxFontFile): string => join(fontsDir, file)

function textbox(
  id: string,
  text: string,
  style: Partial<DrawingStyle>,
  box = { x: 0.1, y: 0.1, width: 0.6, height: 0.12 }
): Drawing {
  return {
    id,
    courseId: 'course-1',
    relPath: 'slides/source.pdf',
    page: 1,
    kind: 'textbox',
    data: { box, text },
    style: { color: 'ink', width: 0.002, opacity: 1, fontScale: 1, ...style },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

async function pdfText(path: string): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  try {
    const content = await (await document.getPage(1)).getTextContent()
    return content.items.map((item) => ('str' in item ? item.str : '')).join('')
  } finally {
    await document.destroy()
  }
}

/** `BaseFont` names in the file — pdf-lib packs font dicts into object streams, so raw bytes cannot be grepped. */
async function embeddedFontNames(bytes: Buffer): Promise<string[]> {
  const document = await PDFDocument.load(bytes)
  return document.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (!(object instanceof PDFDict)) return []
    const baseFont = object.get(PDFName.of('BaseFont'))
    return baseFont instanceof PDFName ? [baseFont.decodeText()] : []
  })
}

function hasFace(names: readonly string[], face: string): boolean {
  return names.some((name) => name.startsWith(face))
}

describe('createPdfExporter', () => {
  let ctx: TestDb
  let sourcePath: string
  let sourceBytes: Buffer
  const fontPath = bundledFont('NotoSansKR-Regular.otf')

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
      listDrawings: () => [...drawings, textbox('bold-fallback', 'bold', { bold: true })],
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
    const names = await embeddedFontNames(outputBytes)
    expect(hasFace(names, 'Helvetica-Bold')).toBe(true)
    expect(hasFace(names, 'NotoSansKR')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to Helvetica'),
      expect.anything()
    )
  })

  test('falls back to Regular weight when only the Bold face is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => [textbox('bold-only', '굵은 글', { bold: true })],
      listAnnotations: () => [],
      resolveFontPath: (file) =>
        file === 'NotoSansKR-Bold.otf' ? join(ctx.dir, 'missing-bold.otf') : fontPath
    })
    const outputPath = join(ctx.dir, 'regular-weight.pdf')

    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      outputPath
    )

    const names = await embeddedFontNames(readFileSync(outputPath))
    expect(hasFace(names, 'NotoSansKR-Bold')).toBe(false)
    expect(hasFace(names, 'NotoSansKR-Regular')).toBe(true)
    expect(await pdfText(outputPath)).toContain('굵은 글')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Regular weight'),
      expect.anything()
    )
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Helvetica'),
      expect.anything()
    )
  })

  test('renders italic, aligned, filled, underlined and struck text as searchable Korean', async () => {
    const drawings: Drawing[] = [
      textbox('italic', '기울임 italic', { italic: true, color: 'blue' }),
      textbox('center', '가운데 정렬', { align: 'center' }, { x: 0.1, y: 0.25, width: 0.6, height: 0.12 }),
      textbox('right', '오른쪽 정렬', { align: 'right' }, { x: 0.1, y: 0.4, width: 0.6, height: 0.12 }),
      textbox('fill', '배경 채움', { fill: 'yellow' }, { x: 0.1, y: 0.55, width: 0.6, height: 0.12 }),
      textbox('underline', '밑줄 취소선', { underline: true, strike: true }, { x: 0.1, y: 0.7, width: 0.6, height: 0.12 }),
      textbox('everything', '전부 다', {
        bold: true, italic: true, underline: true, strike: true, align: 'center', fill: 'red', fontScale: 2
      }, { x: 0.1, y: 0.85, width: 0.8, height: 0.12 })
    ]
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => drawings,
      listAnnotations: () => [],
      resolveFontPath: bundledFont
    })
    const outputPath = join(ctx.dir, 'styled.pdf')

    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      outputPath
    )

    const text = await pdfText(outputPath)
    for (const drawing of drawings) expect(text).toContain(drawing.data.text)
    expect(text).not.toContain('?')
    expect((await PDFDocument.load(readFileSync(outputPath))).getPageCount()).toBe(1)
  })

  test('resolves and reads the Regular face only once per exporter, never Bold without a bold box', async () => {
    const drawings = [textbox('cached-font-text', '캐시된 글꼴', {})]
    const cachedFontPath = join(ctx.dir, 'cached-font.otf')
    copyFileSync(fontPath, cachedFontPath)
    const resolveFontPath = vi.fn((_file: TextboxFontFile) => cachedFontPath)
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
    expect(resolveFontPath).toHaveBeenCalledWith('NotoSansKR-Regular.otf')
    expect(warn).not.toHaveBeenCalled()
  })

  test('loads the Bold face once, and only when a bold textbox exists', async () => {
    const resolveFontPath = vi.fn(bundledFont)
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => [
        textbox('regular', '보통 글', {}),
        textbox('bold', '굵은 글', { bold: true }, { x: 0.1, y: 0.3, width: 0.6, height: 0.12 })
      ],
      listAnnotations: () => [],
      resolveFontPath
    })
    const firstPath = join(ctx.dir, 'bold-1.pdf')

    await exporter.exportAnnotated({ courseId: 'course-1', relPath: 'slides/source.pdf' }, firstPath)
    await exporter.exportAnnotated(
      { courseId: 'course-1', relPath: 'slides/source.pdf' },
      join(ctx.dir, 'bold-2.pdf')
    )

    expect(resolveFontPath).toHaveBeenCalledTimes(2)
    expect(resolveFontPath).toHaveBeenCalledWith('NotoSansKR-Regular.otf')
    expect(resolveFontPath).toHaveBeenCalledWith('NotoSansKR-Bold.otf')
    const names = await embeddedFontNames(readFileSync(firstPath))
    expect(hasFace(names, 'NotoSansKR-Bold')).toBe(true)
    expect(hasFace(names, 'NotoSansKR-Regular')).toBe(true)
    expect(await pdfText(firstPath)).toContain('굵은 글')
  })

  test('embeds only the faces that place glyphs, so a bold-only or blank box cannot crash the subsetter', async () => {
    const exporter = createPdfExporter({
      getCourseFolder: () => ctx.dir,
      listDrawings: () => [
        textbox('bold-only', '굵은 글만', { bold: true }),
        textbox('blank', ' \n\t', { fill: 'green' }, { x: 0.1, y: 0.3, width: 0.6, height: 0.12 })
      ],
      listAnnotations: () => [],
      resolveFontPath: bundledFont
    })
    const outputPath = join(ctx.dir, 'bold-only.pdf')

    await exporter.exportAnnotated({ courseId: 'course-1', relPath: 'slides/source.pdf' }, outputPath)

    const names = await embeddedFontNames(readFileSync(outputPath))
    expect(hasFace(names, 'NotoSansKR-Bold')).toBe(true)
    expect(hasFace(names, 'NotoSansKR-Regular')).toBe(false)
    expect(await pdfText(outputPath)).toContain('굵은 글만')
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
