import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { NotFoundError, ValidationError } from '../../../src/main/db/errors'
import {
  createCanvasRepo,
  type CanvasRepo
} from '../../../src/main/features/canvas/canvasRepo'
import type { PutPersonalShapeInput } from '../../../src/shared/types/whiteboard'
import { createTestDb, type TestDb } from '../helpers/testDb'

function insertCourse(ctx: TestDb, id: string): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(id, `과목 ${id}`, id, 'gold', `/tmp/${id}`, now, now)
}

function shapeInput(boardId: string): PutPersonalShapeInput {
  return {
    boardId,
    id: 'shape-1',
    shape: {
      kind: 'rect',
      data: { box: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 } },
      style: { color: 'blue', width: 0.01, opacity: 1 }
    }
  }
}

describe('canvasRepo', () => {
  let ctx: TestDb
  let repo: CanvasRepo

  beforeEach(() => {
    ctx = createTestDb()
    repo = createCanvasRepo(ctx.db)
    insertCourse(ctx, 'course-1')
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('creates, lists, and renames personal boards', () => {
    const first = repo.createBoard({ courseId: 'course-1' })
    const second = repo.createBoard({ courseId: 'course-1', title: '개념 지도' })

    expect(first.title).toBe('화이트보드 1')
    expect(first).toMatchObject({
      background: 'grid',
      surface: 'dark',
      pageCount: 1
    })
    expect(second.sortOrder).toBe(1)
    expect(repo.listBoards('course-1').map((board) => board.id)).toEqual([
      first.id,
      second.id
    ])

    const renamed = repo.renameBoard({ id: first.id, title: '  시험 정리  ' })
    expect(renamed.title).toBe('시험 정리')
    expect(repo.open(first.id).board.title).toBe('시험 정리')
  })

  test('updates valid background and surface values independently', () => {
    const board = repo.createBoard({ courseId: 'course-1' })

    const ruled = repo.setBackground({ boardId: board.id, background: 'lines' })
    expect(ruled).toMatchObject({ background: 'lines', surface: 'dark' })

    const light = repo.setBackground({ boardId: board.id, surface: 'light' })
    expect(light).toMatchObject({ background: 'lines', surface: 'light' })
    expect(repo.open(board.id).board).toEqual(light)
  })

  test('rejects background and surface values outside the shared unions', () => {
    const board = repo.createBoard({ courseId: 'course-1' })

    expect(() => repo.setBackground({
      boardId: board.id,
      background: 'paper' as never
    })).toThrow(ValidationError)
    expect(() => repo.setBackground({
      boardId: board.id,
      surface: 'sepia' as never
    })).toThrow(ValidationError)
    expect(repo.open(board.id).board).toMatchObject({
      background: 'grid',
      surface: 'dark'
    })
  })

  test('soft-deletes a board and its live shapes', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    repo.putShape(shapeInput(board.id))

    repo.removeBoard(board.id)

    expect(repo.listBoards('course-1')).toEqual([])
    expect(() => repo.open(board.id)).toThrow(NotFoundError)
    expect(
      ctx.db.prepare('SELECT deleted_at FROM whiteboards WHERE id = ?').get(board.id)
    ).toMatchObject({ deleted_at: expect.any(String) })
    expect(
      ctx.db.prepare('SELECT deleted_at FROM whiteboard_local_shapes WHERE id = ?').get('shape-1')
    ).toMatchObject({ deleted_at: expect.any(String) })
  })

  test('updates an existing shape when the same client id is put again', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    const first = repo.putShape(shapeInput(board.id))
    const updated = repo.putShape({
      ...shapeInput(board.id),
      shape: {
        ...shapeInput(board.id).shape,
        data: { box: { x: 0.4, y: 0.3, width: 0.2, height: 0.1 } },
        style: { color: 'red', width: 0.02, opacity: 0.8 }
      }
    })

    expect(updated.id).toBe(first.id)
    expect(updated.page).toBe(1)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(repo.open(board.id).shapes).toEqual([updated])
    expect(
      ctx.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_local_shapes').get()
    ).toEqual({ count: 1 })
  })

  test('adds pages and persists shapes on their 1-based page', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    const paged = repo.setPageCount({ boardId: board.id, pageCount: 2 })
    const saved = repo.putShape({ ...shapeInput(board.id), page: 2 })

    expect(paged.pageCount).toBe(2)
    expect(saved.page).toBe(2)
    const reopenedRepo = createCanvasRepo(ctx.db)
    expect(reopenedRepo.open(board.id)).toEqual({ board: paged, shapes: [saved] })
    expect(
      ctx.db.prepare('SELECT page FROM whiteboard_local_shapes WHERE id = ?').get(saved.id)
    ).toEqual({ page: 2 })
  })

  test('defaults existing callers to page 1 and rejects pages outside the board', () => {
    const board = repo.createBoard({ courseId: 'course-1' })

    expect(repo.putShape(shapeInput(board.id)).page).toBe(1)
    expect(() => repo.putShape({
      ...shapeInput(board.id),
      id: 'shape-zero',
      page: 0
    })).toThrow(ValidationError)
    expect(() => repo.putShape({
      ...shapeInput(board.id),
      id: 'shape-two',
      page: 2
    })).toThrow(ValidationError)
  })

  test('opens legacy-style rows that omit page as page 1', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    const input = shapeInput(board.id)
    const now = new Date().toISOString()
    ctx.db.prepare(
      `INSERT INTO whiteboard_local_shapes
         (id, board_id, kind, data_json, style_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      input.id,
      board.id,
      input.shape.kind,
      JSON.stringify(input.shape.data),
      JSON.stringify(input.shape.style),
      now,
      now
    )

    expect(repo.open(board.id).shapes).toEqual([
      expect.objectContaining({ id: input.id, page: 1 })
    ])
  })

  test('never truncates a page containing live shapes', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    repo.setPageCount({ boardId: board.id, pageCount: 3 })
    repo.putShape({ ...shapeInput(board.id), page: 3 })

    expect(() => repo.setPageCount({ boardId: board.id, pageCount: 2 }))
      .toThrow(ValidationError)
    expect(repo.open(board.id).board.pageCount).toBe(3)

    repo.removeShapes({ boardId: board.id, ids: ['shape-1'] })
    expect(repo.setPageCount({ boardId: board.id, pageCount: 1 }).pageCount).toBe(1)
  })

  test('rejects invalid page counts', () => {
    const board = repo.createBoard({ courseId: 'course-1' })

    for (const pageCount of [0, 1.5, Number.NaN]) {
      expect(() => repo.setPageCount({ boardId: board.id, pageCount }))
        .toThrow(ValidationError)
    }
    expect(repo.open(board.id).board.pageCount).toBe(1)
  })

  test('soft-deletes shapes without affecting the board', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    repo.putShape(shapeInput(board.id))

    repo.removeShapes({ boardId: board.id, ids: ['shape-1', 'shape-1'] })

    expect(repo.open(board.id)).toEqual({ board, shapes: [] })
    expect(
      ctx.db.prepare('SELECT deleted_at FROM whiteboard_local_shapes WHERE id = ?').get('shape-1')
    ).toMatchObject({ deleted_at: expect.any(String) })
  })

  test('countShapes counts live shapes without opening the board', () => {
    const board = repo.createBoard({ courseId: 'course-1' })
    expect(repo.countShapes(board.id)).toBe(0)

    repo.putShape(shapeInput(board.id))
    repo.putShape({ ...shapeInput(board.id), id: 'shape-2' })
    expect(repo.countShapes(board.id)).toBe(2)

    // Tombstoned shapes drop out of the count.
    repo.removeShapes({ boardId: board.id, ids: ['shape-1'] })
    expect(repo.countShapes(board.id)).toBe(1)

    // 값싼 경로: 없는 보드는 throw 대신 0 — 호출부는 listBoards 결과만 넘긴다.
    expect(repo.countShapes('missing-board')).toBe(0)
  })

  test('throws NotFoundError for missing courses and boards', () => {
    expect(() => repo.listBoards('missing-course')).toThrow(NotFoundError)
    expect(() => repo.createBoard({ courseId: 'missing-course' })).toThrow(NotFoundError)
    expect(() => repo.renameBoard({ id: 'missing-board', title: '이름' })).toThrow(NotFoundError)
    expect(() => repo.setBackground({
      boardId: 'missing-board',
      background: 'dots'
    })).toThrow(NotFoundError)
    expect(() => repo.setPageCount({
      boardId: 'missing-board',
      pageCount: 2
    })).toThrow(NotFoundError)
    expect(() => repo.removeBoard('missing-board')).toThrow(NotFoundError)
    expect(() => repo.open('missing-board')).toThrow(NotFoundError)
    expect(() => repo.putShape(shapeInput('missing-board'))).toThrow(NotFoundError)
    expect(() => repo.removeShapes({ boardId: 'missing-board', ids: [] })).toThrow(NotFoundError)
  })
})
