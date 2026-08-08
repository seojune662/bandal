/**
 * The eraser must stick.
 *
 * Reported symptom: erase a shape, reopen the board, it is back. Cause was
 * `putShape`'s `ON CONFLICT ... deleted_at = NULL` — any save that mentioned
 * the same id after the delete silently revived it. Drawing and erasing both
 * fire async saves, so a stale in-flight write was enough.
 *
 * Deletion is now a tombstone: only an explicit `restore` (undo) revives it.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, test } from 'vitest'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const SHAPE = {
  kind: 'ink' as const,
  data: { points: [{ x: 0, y: 0, p: 1 }] },
  style: { color: 'ink' as const, width: 0.004, opacity: 1 }
}

describe('canvas eraser persistence', () => {
  let ctx: TestDb
  let repo: ReturnType<typeof createCanvasRepo>
  let boardId: string

  beforeEach(() => {
    ctx = createTestDb()
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', '과목', 'c', '#000', ?, 0, 0, ?, ?)`
      )
      .run(mkdtempSync(join(tmpdir(), 'wb-')), now, now)
    repo = createCanvasRepo(ctx.db)
    boardId = repo.createBoard({ courseId: 'c1' }).id
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('an erased shape is gone after reopening', () => {
    repo.putShape({ boardId, id: 's1', shape: SHAPE })
    repo.removeShapes({ boardId, ids: ['s1'] })

    expect(repo.open(boardId).shapes).toHaveLength(0)
  })

  test('a save that lands AFTER the erase does not bring it back', () => {
    repo.putShape({ boardId, id: 's1', shape: SHAPE })
    repo.removeShapes({ boardId, ids: ['s1'] })

    // The exact regression: an in-flight write from the draw gesture arriving
    // late, or a pending move, re-mentioning the erased id.
    repo.putShape({ boardId, id: 's1', shape: SHAPE })

    expect(repo.open(boardId).shapes).toHaveLength(0)
  })

  test('undo can still bring it back, because it says so explicitly', () => {
    repo.putShape({ boardId, id: 's1', shape: SHAPE })
    repo.removeShapes({ boardId, ids: ['s1'] })

    repo.putShape({ boardId, id: 's1', shape: SHAPE, restore: true })

    expect(repo.open(boardId).shapes).toHaveLength(1)
  })

  test('erasing several at once sticks', () => {
    for (const id of ['a', 'b', 'c']) {
      repo.putShape({ boardId, id, shape: SHAPE })
    }
    repo.removeShapes({ boardId, ids: ['a', 'c'] })
    repo.putShape({ boardId, id: 'a', shape: SHAPE })

    expect(repo.open(boardId).shapes.map((shape) => shape.id)).toEqual(['b'])
  })

  test('a live shape can still be edited after others were erased', () => {
    repo.putShape({ boardId, id: 'live', shape: SHAPE })
    repo.putShape({ boardId, id: 'gone', shape: SHAPE })
    repo.removeShapes({ boardId, ids: ['gone'] })

    const moved = {
      ...SHAPE,
      data: { points: [{ x: 0.5, y: 0.5, p: 1 }] }
    }
    repo.putShape({ boardId, id: 'live', shape: moved })

    const shapes = repo.open(boardId).shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0]?.data.points?.[0]?.x).toBe(0.5)
  })
})
