import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createBoardPdfExporter,
  createCanvasRepo,
  type CanvasRepo
} from '../../../src/main/features/canvas'
import type { DrawingKind, DrawingShape } from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

const timestamp = '2026-08-10T00:00:00.000Z'
const fontPath = join(process.cwd(), 'resources', 'fonts', 'NotoSansKR-Regular.otf')

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

async function pdfText(path: string): Promise<string> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)) })
  const document = await task.promise
  try {
    const page = await document.getPage(1)
    const content = await page.getTextContent()
    return content.items
      .map((item) => 'str' in item ? item.str : '')
      .join('')
  } finally {
    await document.destroy()
  }
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
