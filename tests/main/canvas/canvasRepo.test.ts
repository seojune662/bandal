import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { NotFoundError } from '../../../src/main/db/errors'
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
    expect(second.sortOrder).toBe(1)
    expect(repo.listBoards('course-1').map((board) => board.id)).toEqual([
      first.id,
      second.id
    ])

    const renamed = repo.renameBoard({ id: first.id, title: '  시험 정리  ' })
    expect(renamed.title).toBe('시험 정리')
    expect(repo.open(first.id).board.title).toBe('시험 정리')
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
    expect(updated.createdAt).toBe(first.createdAt)
    expect(repo.open(board.id).shapes).toEqual([updated])
    expect(
      ctx.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_local_shapes').get()
    ).toEqual({ count: 1 })
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

  test('throws NotFoundError for missing courses and boards', () => {
    expect(() => repo.listBoards('missing-course')).toThrow(NotFoundError)
    expect(() => repo.createBoard({ courseId: 'missing-course' })).toThrow(NotFoundError)
    expect(() => repo.renameBoard({ id: 'missing-board', title: '이름' })).toThrow(NotFoundError)
    expect(() => repo.removeBoard('missing-board')).toThrow(NotFoundError)
    expect(() => repo.open('missing-board')).toThrow(NotFoundError)
    expect(() => repo.putShape(shapeInput('missing-board'))).toThrow(NotFoundError)
    expect(() => repo.removeShapes({ boardId: 'missing-board', ids: [] })).toThrow(NotFoundError)
  })
})
