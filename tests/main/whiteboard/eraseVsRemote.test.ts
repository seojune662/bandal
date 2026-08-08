/**
 * The same tombstone question for the SHARED board.
 *
 * The personal canvas had a bug where any later save revived an erased shape.
 * The group board takes remote shapes from other people continuously, so the
 * equivalent risk is worse: a sync could undo your eraser using the server's
 * older copy. These pin the expected precedence.
 */

import { beforeEach, afterEach, describe, expect, test } from 'vitest'
import { createWhiteboardRepo } from '../../../src/main/features/whiteboard/whiteboardRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'
import type { WhiteboardShape } from '../../../src/shared/types/whiteboard'

const BOARD = 'board-1'
const GROUP = 'group-1'

function shape(id: string, authorId = 'me'): WhiteboardShape {
  return {
    id,
    boardId: BOARD,
    authorId,
    kind: 'ink',
    data: { points: [{ x: 0, y: 0, p: 1 }] },
    style: { color: 'ink', width: 0.004, opacity: 1 },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z'
  }
}

describe('shared whiteboard erase vs remote sync', () => {
  let ctx: TestDb
  let repo: ReturnType<typeof createWhiteboardRepo>

  beforeEach(() => {
    ctx = createTestDb()
    repo = createWhiteboardRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('a shape I just erased is not revived by a remote echo of it', () => {
    repo.applyRemote([shape('s1')])
    expect(repo.listShapes(BOARD)).toHaveLength(1)

    repo.softDelete(['s1'])
    expect(repo.listShapes(BOARD)).toHaveLength(0)

    // The server has not processed my delete yet and echoes the shape back.
    repo.applyRemote([shape('s1')])

    expect(repo.listShapes(BOARD)).toHaveLength(0)
  })

  test('someone else drawing still shows up', () => {
    repo.applyRemote([shape('s1')])
    repo.softDelete(['s1'])

    repo.applyRemote([shape('s2', 'classmate')])

    expect(repo.listShapes(BOARD).map((entry) => entry.id)).toEqual(['s2'])
  })

  test('a locally drawn shape stays pending until the server confirms it', () => {
    const local = repo.insertLocal(
      {
        boardId: BOARD,
        id: 'mine',
        shape: {
          kind: 'ink',
          data: { points: [{ x: 0, y: 0, p: 1 }] },
          style: { color: 'ink', width: 0.004, opacity: 1 }
        }
      },
      'me',
      GROUP
    )
    expect(local.id).toBe('mine')
    expect(repo.pending(10).map((entry) => entry.id)).toContain('mine')

    repo.markSynced('mine')
    expect(repo.pending(10).map((entry) => entry.id)).not.toContain('mine')
    // Still on the board — syncing confirms it, it does not consume it.
    expect(repo.listShapes(BOARD).map((entry) => entry.id)).toContain('mine')
  })
})
