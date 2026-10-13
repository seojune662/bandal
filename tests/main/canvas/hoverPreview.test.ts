import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  BOARD_HOVER_SHAPE_LIMIT, BOARD_HOVER_SHAPE_BYTES, BOARD_HOVER_TOTAL_BYTES,
  BOARD_HOVER_POINTS_PER_SHAPE, BOARD_HOVER_TOTAL_POINTS, createCanvasRepo
} from '../../../src/main/features/canvas/canvasRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

let ctx: TestDb
beforeEach(() => {
  ctx = createTestDb()
  ctx.db.prepare(`INSERT INTO courses (id, name, slug, color, folder_path, created_at, updated_at)
    VALUES ('course', 'Preview', 'preview', 'blue', '/tmp/preview', '2026-01-01', '2026-01-01')`).run()
})
afterEach(() => { vi.restoreAllMocks(); ctx.cleanup() })

function shape(boardId: string, id: string, data: unknown, page = 1, kind = 'rect', deleted = false): void {
  ctx.db.prepare(`INSERT INTO whiteboard_local_shapes (id, board_id, kind, data_json, style_json, page, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, boardId, kind, JSON.stringify(data), '{"color":"ink","width":0.01,"opacity":1}', page, id, id, deleted ? id : null)
}

test('preview returns the newest 160 first-page shapes in paint order without changing board data', () => {
  const repo = createCanvasRepo(ctx.db)
  const board = repo.createBoard({ courseId: 'course' })
  repo.setPageCount({ boardId: board.id, pageCount: 2 })
  repo.setBackground({ boardId: board.id, background: 'lines', surface: 'light' })
  for (let index = 0; index < 175; index++) shape(board.id, `shape-${String(index).padStart(3, '0')}`, { box: { x: 0, y: 0, width: 0.2, height: 0.2 } })
  shape(board.id, 'z-page-two', { text: 'second page' }, 2, 'textbox')
  shape(board.id, 'z-deleted', { text: 'deleted' }, 1, 'textbox', true)
  const before = repo.open(board.id)
  const changes = ctx.db.prepare('SELECT total_changes() AS count').get()
  const preview = repo.hoverPreview(board.id)
  expect(preview.board).toEqual(before.board)
  expect(preview.board).toMatchObject({ background: 'lines', surface: 'light', pageCount: 2 })
  expect(preview.shapes).toHaveLength(BOARD_HOVER_SHAPE_LIMIT)
  expect(preview.shapes[0]?.id).toBe('shape-015')
  expect(preview.shapes.at(-1)?.id).toBe('shape-174')
  expect(preview.shapes.every(entry => entry.page === 1)).toBe(true)
  expect(ctx.db.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
  expect(repo.open(board.id)).toEqual(before)
  const plan = ctx.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM whiteboard_local_shapes
    WHERE board_id = ? AND page = 1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(board.id, BOARD_HOVER_SHAPE_LIMIT) as { detail: string }[]
  expect(plan.map(row => row.detail).join(' ')).toContain('idx_wb_local_preview')
  expect(plan.map(row => row.detail).join(' ')).not.toContain('TEMP B-TREE')
})

test('oversized and malformed shapes are omitted before they can block a small preview', () => {
  const repo = createCanvasRepo(ctx.db)
  const board = repo.createBoard({ courseId: 'course' })
  shape(board.id, 'good', { text: 'small text', box: { x: 0, y: 0, width: 1, height: 1 } }, 1, 'textbox')
  const enormous = 'x'.repeat(BOARD_HOVER_SHAPE_BYTES + 1)
  shape(board.id, 'huge', { text: enormous }, 1, 'textbox')
  shape(board.id, 'malformed', {}, 1, 'ink')
  ctx.db.prepare('UPDATE whiteboard_local_shapes SET data_json = ? WHERE id = ?').run('{broken', 'malformed')
  const parse = vi.spyOn(JSON, 'parse')
  const result = repo.hoverPreview(board.id)
  expect(result.shapes.map(entry => entry.id)).toEqual(['good'])
  expect(parse.mock.calls.every(([source]) => source.length <= BOARD_HOVER_SHAPE_BYTES)).toBe(true)
})

test('stroke complexity is bounded across shapes and preserves each sampled stroke endpoint', () => {
  const repo = createCanvasRepo(ctx.db)
  const board = repo.createBoard({ courseId: 'course' })
  const points = Array.from({ length: 1000 }, (_, index) => ({ x: index % 2, y: index % 2, p: 0.5 }))
  for (let index = 0; index < 12; index++) shape(board.id, `ink-${index}`, { points }, 1, 'ink')
  const preview = repo.hoverPreview(board.id)
  expect(preview.shapes.length).toBeGreaterThan(0)
  expect(preview.shapes.reduce((sum, entry) => sum + (entry.data.points?.length ?? 0), 0)).toBeLessThanOrEqual(BOARD_HOVER_TOTAL_POINTS)
  for (const entry of preview.shapes) {
    expect(entry.data.points!.length).toBeLessThanOrEqual(BOARD_HOVER_POINTS_PER_SHAPE)
    expect(entry.data.points![0]).toEqual(points[0])
    expect(entry.data.points!.at(-1)).toEqual(points.at(-1))
  }
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(BOARD_HOVER_TOTAL_BYTES)
  expect(repo.open(board.id).shapes[0]?.data.points).toHaveLength(1000)
})

test('combined serialized payload stays bounded and missing or deleted boards cannot be previewed', () => {
  const repo = createCanvasRepo(ctx.db)
  const board = repo.createBoard({ courseId: 'course' })
  for (let index = 0; index < 30; index++) shape(board.id, `text-${index}`, { text: '한'.repeat(8000) }, 1, 'textbox')
  const preview = repo.hoverPreview(board.id)
  expect(preview.shapes.length).toBeGreaterThan(0)
  expect(preview.shapes.length).toBeLessThan(30)
  expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(BOARD_HOVER_TOTAL_BYTES)
  expect(() => repo.hoverPreview('missing')).toThrow('whiteboard')
  repo.removeBoard(board.id)
  expect(() => repo.hoverPreview(board.id)).toThrow('whiteboard')
})
