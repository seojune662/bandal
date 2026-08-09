/**
 * Erasing on the SHARED board has to survive leaving and coming back.
 *
 * Reported twice. The first fix stopped a pending removal from being undone,
 * but once the removal was marked synced the guard stopped applying, and
 * `applyRemote` cleared `deleted_at` again the moment the server echoed a row
 * it still considered live. The upload could reach that state on its own,
 * because a PostgREST update that matches zero rows returns `error: null`.
 *
 * The rule now: a local tombstone always wins. Only an explicit server-side
 * removal (applyRemoteRemovals) or a restore takes it back.
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
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z'
  }
}

describe('shared whiteboard erase survives a round trip', () => {
  let ctx: TestDb
  let repo: ReturnType<typeof createWhiteboardRepo>

  beforeEach(() => {
    ctx = createTestDb()
    repo = createWhiteboardRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('an erase that has already been confirmed still wins over a server echo', () => {
    repo.applyRemote([shape('s1')])
    repo.softDelete(['s1'])
    // The removal uploaded and was confirmed — this is the state the first fix
    // did not cover.
    repo.markSynced('s1')

    // Leaving and re-entering the board pulls the server's copy.
    repo.applyRemote([shape('s1')])

    expect(repo.listShapes(BOARD)).toHaveLength(0)
  })

  test('an erase that could not be uploaded still wins locally', () => {
    repo.applyRemote([shape('s1')])
    repo.softDelete(['s1'])
    // Upload matched zero rows (RLS refused, or it was never on the server),
    // so it is parked rather than confirmed.
    repo.park('s1')

    repo.applyRemote([shape('s1')])

    expect(repo.listShapes(BOARD)).toHaveLength(0)
  })

  test('someone else erasing is honoured through the removal channel', () => {
    repo.applyRemote([shape('s1'), shape('s2', 'classmate')])
    expect(repo.listShapes(BOARD)).toHaveLength(2)

    repo.applyRemoteRemovals(['s2'])

    expect(repo.listShapes(BOARD).map((entry) => entry.id)).toEqual(['s1'])
  })

  test('a shape nobody erased is unaffected', () => {
    repo.applyRemote([shape('s1')])
    repo.applyRemote([shape('s1')])
    repo.applyRemote([shape('s1')])

    expect(repo.listShapes(BOARD)).toHaveLength(1)
  })

  test('drawing again after erasing everything still works', () => {
    repo.applyRemote([shape('s1')])
    repo.softDelete(['s1'])
    repo.markSynced('s1')

    repo.insertLocal(
      {
        boardId: BOARD,
        id: 'fresh',
        shape: {
          kind: 'ink',
          data: { points: [{ x: 0.2, y: 0.2, p: 1 }] },
          style: { color: 'ink', width: 0.004, opacity: 1 }
        }
      },
      'me',
      GROUP
    )

    expect(repo.listShapes(BOARD).map((entry) => entry.id)).toEqual(['fresh'])
  })
})
