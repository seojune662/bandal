import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createBoardPdfExporter,
  createCanvasRepo,
  type CanvasRepo
} from '../../../src/main/features/canvas'
import type { TextboxFontFile } from '../../../src/main/features/canvas/exportBoardPdf'
import type {
  DrawingKind,
  DrawingShape,
  DrawingStyle
} from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

const timestamp = '2026-08-10T00:00:00.000Z'
const fontsDir = join(process.cwd(), 'resources', 'fonts')
const fontPath = join(fontsDir, 'NotoSansKR-Regular.otf')
const bundledFont = (file: TextboxFontFile): string => join(fontsDir, file)

function styledTextbox(
  id: string,
  text: string,
  style: Partial<DrawingStyle>,
  box: DrawingShape['data']['box']
): DrawingShape {
  return {
    id,
    kind: 'textbox',
    data: { box, text },
    style: { color: 'ink', width: 0.004, opacity: 1, fontScale: 1, ...style },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function insertCourse(ctx: TestDb, id: string): void {
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(id, `과목 ${id}`, id, 'gold', ctx.dir, timestamp, timestamp)
}

function shape(
  id: string,
  kind: DrawingKind,
  data: DrawingShape['data'],
  color: DrawingShape['style']['color'] = 'ink'
): DrawingShape {
  return {
    id,
    kind,
    data,
    style: {
      color,
      width: kind === 'highlighter' ? 0.018 : 0.004,
      opacity: kind === 'highlighter' ? 0.4 : 1,
      ...(kind === 'textbox' ? { fontScale: 1 } : {})
    },
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

async function pdfText(path: string, pageNumber = 1): Promise<string> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)) })
  const document = await task.promise
  try {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    return content.items
      .map((item) => 'str' in item ? item.str : '')
      .join('')
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

describe('createBoardPdfExporter', () => {
  let ctx: TestDb
  let repo: CanvasRepo

  beforeEach(() => {
    ctx = createTestDb()
    repo = createCanvasRepo(ctx.db)
    insertCourse(ctx, 'course-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ctx.cleanup()
  })

  test('exports every supported shape with readable Korean text and no question marks', async () => {
    const board = repo.createBoard({ courseId: 'course-1', title: '중간고사 정리' })
    repo.setBackground({ boardId: board.id, background: 'dots', surface: 'light' })
    const shapes = [
      shape('ink', 'ink', {
        points: [{ x: 0.08, y: 0.1, p: 0.5 }, { x: 0.32, y: 0.2, p: 0.9 }]
      }),
      shape('highlight', 'highlighter', {
        points: [{ x: 0.08, y: 0.24, p: 0.5 }, { x: 0.38, y: 0.24, p: 0.5 }]
      }, 'yellow'),
      shape('rect', 'rect', {
        box: { x: 0.08, y: 0.3, width: 0.18, height: 0.14 }
      }, 'red'),
      shape('ellipse', 'ellipse', {
        box: { x: 0.3, y: 0.3, width: 0.18, height: 0.14 }
      }, 'green'),
      shape('line', 'line', {
        points: [{ x: 0.08, y: 0.5, p: 0.5 }, { x: 0.35, y: 0.56, p: 0.5 }]
      }, 'blue'),
      shape('arrow', 'arrow', {
        points: [{ x: 0.4, y: 0.5, p: 0.5 }, { x: 0.65, y: 0.58, p: 0.5 }]
      }, 'violet'),
      shape('textbox', 'textbox', {
        box: { x: 0.08, y: 0.65, width: 0.55, height: 0.18 },
        text: '한글 개념 정리'
      })
    ]
    for (const entry of shapes) {
      repo.putShape({
        boardId: board.id,
        id: entry.id,
        shape: { kind: entry.kind, data: entry.data, style: entry.style }
      })
    }
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath: () => fontPath
    })

    const result = await exporter.exportBoard(board.id)
    const outputPath = join(ctx.dir, result.relPath)
    const bytes = readFileSync(outputPath)

    expect(result.relPath).toBe('중간고사 정리.pdf')
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
    expect(await pdfText(outputPath)).toContain('한글 개념 정리')
    expect(await pdfText(outputPath)).not.toContain('?')
  })

  test('exports an empty dark board and avoids overwriting an existing PDF', async () => {
    const board = repo.createBoard({ courseId: 'course-1', title: '빈 보드' })
    writeFileSync(join(ctx.dir, '빈 보드.pdf'), 'existing')
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir
    })

    const result = await exporter.exportBoard(board.id)
    const bytes = readFileSync(join(ctx.dir, result.relPath))

    expect(result.relPath).toBe('빈 보드 (2).pdf')
    expect((await PDFDocument.load(bytes)).getPages()[0]?.getSize()).toEqual({
      width: expect.any(Number),
      height: expect.any(Number)
    })
    const firstPage = (await PDFDocument.load(bytes)).getPages()[0]
    expect(firstPage?.getWidth()).toBeLessThan(firstPage?.getHeight() ?? 0)
  })

  test('exports one portrait A4 sheet per board page with page-filtered shapes', async () => {
    const board = repo.createBoard({ courseId: 'course-1', title: '여러 쪽' })
    repo.setPageCount({ boardId: board.id, pageCount: 2 })
    for (const [id, page, text] of [
      ['page-1', 1, '첫 페이지'],
      ['page-2', 2, '둘째 페이지']
    ] as const) {
      const entry = shape(id, 'textbox', {
        box: { x: 0.1, y: 0.1, width: 0.5, height: 0.15 },
        text
      })
      repo.putShape({
        boardId: board.id,
        id,
        page,
        shape: { kind: entry.kind, data: entry.data, style: entry.style }
      })
    }
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath: () => fontPath
    })

    const result = await exporter.exportBoard(board.id)
    const outputPath = join(ctx.dir, result.relPath)
    const document = await PDFDocument.load(readFileSync(outputPath))

    expect(document.getPageCount()).toBe(2)
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeLessThan(page.getHeight())
    }
    expect(await pdfText(outputPath, 1)).toContain('첫 페이지')
    expect(await pdfText(outputPath, 1)).not.toContain('둘째 페이지')
    expect(await pdfText(outputPath, 2)).toContain('둘째 페이지')
    expect(await pdfText(outputPath, 2)).not.toContain('첫 페이지')
  })

  test.each(['light', 'dark'] as const)(
    'renders bold, italic, aligned, filled and decorated text on the %s surface',
    async (surface) => {
      const board = repo.createBoard({ courseId: 'course-1', title: `서식 ${surface}` })
      repo.setBackground({ boardId: board.id, background: 'grid', surface })
      const shapes = [
        styledTextbox('bold', '굵은 글씨', { bold: true }, { x: 0.1, y: 0.05, width: 0.6, height: 0.1 }),
        styledTextbox('italic', '기울인 글씨', { italic: true, color: 'blue' }, { x: 0.1, y: 0.2, width: 0.6, height: 0.1 }),
        styledTextbox('center', '가운데', { align: 'center' }, { x: 0.1, y: 0.35, width: 0.6, height: 0.1 }),
        styledTextbox('right', '오른쪽', { align: 'right' }, { x: 0.1, y: 0.5, width: 0.6, height: 0.1 }),
        styledTextbox('fill', '노란 배경', { fill: 'yellow' }, { x: 0.1, y: 0.65, width: 0.6, height: 0.1 }),
        styledTextbox('deco', '밑줄과 취소선', { underline: true, strike: true }, { x: 0.1, y: 0.8, width: 0.6, height: 0.1 }),
        styledTextbox('all', '전부', {
          bold: true, italic: true, underline: true, strike: true, align: 'center', fill: 'red', fontScale: 2
        }, { x: 0.1, y: 0.9, width: 0.8, height: 0.08 })
      ]
      for (const entry of shapes) {
        repo.putShape({
          boardId: board.id,
          id: entry.id,
          shape: { kind: entry.kind, data: entry.data, style: entry.style }
        })
      }
      const exporter = createBoardPdfExporter({
        openBoard: (boardId) => repo.open(boardId),
        getCourseFolder: () => ctx.dir,
        resolveFontPath: bundledFont
      })

      const result = await exporter.exportBoard(board.id)
      const outputPath = join(ctx.dir, result.relPath)
      const bytes = readFileSync(outputPath)
      const text = await pdfText(outputPath)

      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
      const names = await embeddedFontNames(bytes)
      expect(hasFace(names, 'NotoSansKR-Bold')).toBe(true)
      expect(hasFace(names, 'NotoSansKR-Regular')).toBe(true)
      for (const entry of shapes) expect(text).toContain(entry.data.text)
      expect(text).not.toContain('?')
    }
  )

  test('loads the Bold face only when a bold textbox exists', async () => {
    const plainBoard = repo.createBoard({ courseId: 'course-1', title: '보통' })
    repo.putShape({
      boardId: plainBoard.id,
      id: 'plain',
      shape: styledTextbox('plain', '보통 글', {}, { x: 0.1, y: 0.1, width: 0.5, height: 0.1 })
    })
    const boldBoard = repo.createBoard({ courseId: 'course-1', title: '굵게' })
    repo.putShape({
      boardId: boldBoard.id,
      id: 'bold',
      shape: styledTextbox('bold', '굵은 글', { bold: true }, { x: 0.1, y: 0.1, width: 0.5, height: 0.1 })
    })
    const resolveFontPath = vi.fn(bundledFont)
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath
    })

    const plain = await exporter.exportBoard(plainBoard.id)
    expect(resolveFontPath).toHaveBeenCalledTimes(1)
    expect(resolveFontPath).toHaveBeenCalledWith('NotoSansKR-Regular.otf')
    const plainNames = await embeddedFontNames(readFileSync(join(ctx.dir, plain.relPath)))
    expect(hasFace(plainNames, 'NotoSansKR-Regular')).toBe(true)
    expect(hasFace(plainNames, 'NotoSansKR-Bold')).toBe(false)

    const bold = await exporter.exportBoard(boldBoard.id)
    await exporter.exportBoard(boldBoard.id)
    expect(resolveFontPath).toHaveBeenCalledTimes(2)
    expect(resolveFontPath).toHaveBeenCalledWith('NotoSansKR-Bold.otf')
    // A bold-only board must not embed an unused Regular face: fontkit's CFF
    // subsetter crashes on a face that placed no glyph.
    const boldNames = await embeddedFontNames(readFileSync(join(ctx.dir, bold.relPath)))
    expect(hasFace(boldNames, 'NotoSansKR-Bold')).toBe(true)
    expect(hasFace(boldNames, 'NotoSansKR-Regular')).toBe(false)
  })

  test('exports inline rich runs with independent point size, color and weight', async () => {
    const board = repo.createBoard({ courseId: 'course-1', title: '부분 서식' })
    const mixed = styledTextbox(
      'mixed',
      '보통 굵게 다시',
      { fontSizePt: 14 },
      { x: 0.1, y: 0.1, width: 0.7, height: 0.16 }
    )
    mixed.data.textRuns = [{
      from: 3,
      to: 5,
      style: { bold: true, color: 'red', fontSizePt: 24, strike: true }
    }]
    repo.putShape({
      boardId: board.id,
      id: mixed.id,
      shape: { kind: mixed.kind, data: mixed.data, style: mixed.style }
    })
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath: bundledFont
    })

    const result = await exporter.exportBoard(board.id)
    const outputPath = join(ctx.dir, result.relPath)
    const names = await embeddedFontNames(readFileSync(outputPath))
    expect(hasFace(names, 'NotoSansKR-Regular')).toBe(true)
    expect(hasFace(names, 'NotoSansKR-Bold')).toBe(true)
    expect((await pdfText(outputPath)).replace(/\s+/gu, '')).toContain('보통굵게다시')
  })

  test('exports a board whose only textbox is blank without embedding any face', async () => {
    const board = repo.createBoard({ courseId: 'course-1', title: '빈 글상자' })
    repo.putShape({
      boardId: board.id,
      id: 'blank',
      shape: styledTextbox('blank', ' \n', { fill: 'green' }, { x: 0.1, y: 0.1, width: 0.5, height: 0.1 })
    })
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath: bundledFont
    })

    const result = await exporter.exportBoard(board.id)
    const bytes = readFileSync(join(ctx.dir, result.relPath))

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
    expect(hasFace(await embeddedFontNames(bytes), 'NotoSansKR')).toBe(false)
  })

  test('falls back to Regular weight when the Bold face is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const board = repo.createBoard({ courseId: 'course-1', title: '굵기 대체' })
    repo.putShape({
      boardId: board.id,
      id: 'bold',
      shape: styledTextbox('bold', '굵은 글', { bold: true }, { x: 0.1, y: 0.1, width: 0.5, height: 0.1 })
    })
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir,
      resolveFontPath: (file) =>
        file === 'NotoSansKR-Bold.otf' ? join(ctx.dir, 'missing-bold.otf') : fontPath
    })

    const result = await exporter.exportBoard(board.id)
    const outputPath = join(ctx.dir, result.relPath)

    const names = await embeddedFontNames(readFileSync(outputPath))
    expect(hasFace(names, 'NotoSansKR-Bold')).toBe(false)
    expect(hasFace(names, 'NotoSansKR-Regular')).toBe(true)
    expect(await pdfText(outputPath)).toContain('굵은 글')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Regular weight'),
      expect.anything()
    )
  })

  test('skips clips and reports their count without failing the export', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const board = repo.createBoard({ courseId: 'course-1', title: '클립 보드' })
    repo.putShape({
      boardId: board.id,
      id: 'clip',
      shape: {
        kind: 'clip',
        data: {
          box: { x: 0.1, y: 0.1, width: 0.3, height: 0.4 },
          clip: { relPath: '강의.pdf', page: 1, label: '강의 1쪽' }
        },
        style: { color: 'ink', width: 0.004, opacity: 1 }
      }
    })
    const exporter = createBoardPdfExporter({
      openBoard: (boardId) => repo.open(boardId),
      getCourseFolder: () => ctx.dir
    })

    await expect(exporter.exportBoard(board.id)).resolves.toEqual({
      relPath: '클립 보드.pdf'
    })
    expect(info).toHaveBeenCalledWith(expect.stringContaining('skipped clips: 1'))
  })
})
