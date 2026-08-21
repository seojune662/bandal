import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { DrawingShape } from '../../../src/shared/types/drawing'
import type {
  AddWhiteboardShapeInput,
  UpdateWhiteboardShapeInput,
  Whiteboard,
  WhiteboardShape
} from '../../../src/shared/types/whiteboard'
import {
  createWhiteboardRepo,
  type WhiteboardRepo
} from '../../../src/main/features/whiteboard/whiteboardRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

let testDb: TestDb
let repo: WhiteboardRepo

const board: Whiteboard = {
  id: 'board-1',
  groupId: 'group-1',
  title: '우리 보드',
  createdBy: 'user-1',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z'
}

function input(id = 'shape-1'): AddWhiteboardShapeInput {
  return {
    boardId: board.id,
    id,
    shape: {
      kind: 'ink',
      data: { points: [{ x: 0.1, y: 0.2, p: 0.5 }] },
      style: { color: 'blue', width: 0.01, opacity: 1 }
    }
  }
}

function updateInput(
  id: string,
  color: 'red' | 'green'
): UpdateWhiteboardShapeInput {
  return {
    boardId: board.id,
    id,
    shape: {
      ...input(id).shape,
      style: { color, width: 0.02, opacity: 0.8 }
    }
  }
}

function remote(overrides: Partial<WhiteboardShape> = {}): WhiteboardShape {
  return {
    id: 'remote-1',
    boardId: board.id,
    authorId: 'user-2',
    kind: 'rect',
    data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
    style: { color: 'red', width: 0.02, opacity: 0.8 },
    createdAt: '2026-08-07T00:01:00.000Z',
    updatedAt: '2026-08-07T00:01:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  testDb = createTestDb()
  repo = createWhiteboardRepo(testDb.db)
  repo.upsertBoard(board)
}, 30_000)

afterEach(() => {
  testDb.cleanup()
})

describe('whiteboard local mirror', () => {
  test('clearAll wipes both whiteboard cache tables', () => {
    repo.insertLocal(input(), 'user-1', board.groupId)

    repo.clearAll()

    expect(
      testDb.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_shapes_cache').get()
    ).toEqual({ count: 0 })
    expect(
      testDb.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_boards_cache').get()
    ).toEqual({ count: 0 })
    expect(repo.getBoardByGroup(board.groupId)).toBeNull()
    expect(repo.listShapes(board.id)).toEqual([])
  })

  test('stores a local shape as a durable pending row', () => {
    const shape = repo.insertLocal(input(), 'user-1', board.groupId)

    expect(shape.id).toBe('shape-1')
    expect(repo.listShapes(board.id)).toEqual([shape])
    expect(repo.pending(10)).toEqual([shape])
    expect(
      testDb.db
        .prepare('SELECT pending, attempts FROM whiteboard_shapes_cache WHERE id = ?')
        .get(shape.id)
    ).toEqual({ pending: 1, attempts: 0 })
  })

  test('is idempotent for the client-generated shape id', () => {
    const first = repo.insertLocal(input(), 'user-1', board.groupId)
    const second = repo.insertLocal(
      {
        ...input(),
        shape: {
          ...input().shape,
          style: { color: 'red', width: 0.02, opacity: 1 }
        }
      },
      'user-1',
      board.groupId
    )

    expect(second).toEqual(first)
    expect(
      testDb.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_shapes_cache').get()
    ).toEqual({ count: 1 })
  })

  test('orders live shapes by creation time and hides tombstones', () => {
    repo.applyRemote([
      remote({ id: 'later', createdAt: '2026-08-07T00:02:00.000Z' }),
      remote({ id: 'earlier', createdAt: '2026-08-07T00:01:00.000Z' })
    ])
    repo.softDelete(['earlier'])

    expect(repo.listShapes(board.id).map((shape) => shape.id)).toEqual(['later'])
    expect(repo.pendingRemovals(10).map((row) => row.id)).toEqual(['earlier'])
  })

  test('applyRemote only acknowledges a matching pending id', () => {
    const local = repo.insertLocal(input(), 'user-1', board.groupId)
    const changedShape: Omit<DrawingShape, 'id'> = {
      kind: 'rect',
      data: { box: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } },
      style: { color: 'red', width: 0.05, opacity: 0.5 },
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z'
    }
    repo.applyRemote([
      {
        id: local.id,
        boardId: board.id,
        authorId: 'somebody-else',
        ...changedShape
      }
    ])

    expect(repo.listShapes(board.id)).toEqual([local])
    expect(repo.pending(10)).toEqual([local])
    expect(
      testDb.db
        .prepare('SELECT pending FROM whiteboard_shapes_cache WHERE id = ?')
        .get(local.id)
    ).toEqual({ pending: 1 })
  })

  test('parks a row after six failed attempts', () => {
    const shape = repo.insertLocal(input(), 'user-1', board.groupId)
    for (let attempt = 0; attempt < 6; attempt += 1) repo.markAttempt(shape.id)

    expect(repo.pending(10)).toEqual([])
    expect(repo.attempts(shape.id)).toBe(6)
    expect(
      testDb.db
        .prepare('SELECT pending FROM whiteboard_shapes_cache WHERE id = ?')
        .get(shape.id)
    ).toEqual({ pending: 1 })
  })

  test('updates a confirmed row in place and preserves its creation order', () => {
    const inserted = repo.insertLocal(input(), 'user-1', board.groupId)
    repo.markShapeSynced(inserted)

    const once = repo.updateShape(updateInput(inserted.id, 'red'))
    const twice = repo.updateShape(updateInput(inserted.id, 'green'))

    expect(once).not.toBeNull()
    expect(twice).toMatchObject({
      id: inserted.id,
      createdAt: inserted.createdAt,
      style: { color: 'green' }
    })
    expect(twice?.updatedAt).not.toBe(inserted.updatedAt)
    expect(repo.listShapes(board.id)).toHaveLength(1)
    expect(repo.pending(10)).toEqual([twice])
  })

  test('keeps an edited never-uploaded row on the INSERT path', () => {
    const inserted = repo.insertLocal(input(), 'user-1', board.groupId)
    const updated = repo.updateShape(updateInput(inserted.id, 'red'))

    expect(updated?.createdAt).toBe(inserted.createdAt)
    expect(updated?.updatedAt).toBe(inserted.createdAt)
  })
})
