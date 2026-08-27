import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createAgentJournal,
  type AgentJournal,
  type UndoHandlers,
  type UndoTarget
} from '../../../src/main/features/agentTools/journal'
import type { AgentActionTarget } from '../../../src/shared/types/agentTools'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-1'

function insertCourse(ctx: TestDb): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(COURSE_ID, '테스트 과목', COURSE_ID, 'gold', '/tmp/course-1', now, now)
}

function undoHandlers(overrides: Partial<UndoHandlers> = {}): UndoHandlers {
  const noop = async (_input: UndoTarget): Promise<void> => undefined
  return {
    course: overrides.course ?? noop,
    material: overrides.material ?? noop,
    link: overrides.link ?? noop,
    note: overrides.note ?? noop,
    task: overrides.task ?? noop,
    board: overrides.board ?? noop,
    shape: overrides.shape ?? noop,
    'material-edit': overrides['material-edit'] ?? noop
  }
}

describe('createAgentJournal', () => {
  let ctx: TestDb
  let journal: AgentJournal

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx)
    journal = createAgentJournal(ctx.db)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ctx.cleanup()
  })

  function record(input: {
    turnId: string
    targetId: string
    targetKind?: AgentActionTarget
    undoable?: boolean
  }): void {
    journal.record({
      courseId: COURSE_ID,
      turnId: input.turnId,
      tool: `create_${input.targetKind ?? 'note'}`,
      targetKind: input.targetKind ?? 'note',
      targetId: input.targetId,
      label: input.targetId,
      undoable: input.undoable ?? true
    })
  }

  test('lists three creations and undoes them once in reverse order', async () => {
    record({ turnId: 'turn-1', targetId: 'first.md' })
    record({ turnId: 'turn-1', targetId: 'second.md' })
    record({ turnId: 'turn-1', targetId: 'third.md' })
    const order: string[] = []
    const handlers = undoHandlers({
      note: async ({ targetId }) => {
        order.push(targetId)
      }
    })

    const actions = journal.forTurn('turn-1').actions
    expect(actions).toHaveLength(3)
    expect(await journal.undoTurn('turn-1', handlers)).toEqual({
      undone: 3,
      results: [...actions].reverse().map((action) => ({
        actionId: action.id,
        ok: true
      }))
    })
    expect(order).toEqual(['third.md', 'second.md', 'first.md'])
    expect(journal.forTurn('turn-1').actions.every((action) => action.undoneAt !== null))
      .toBe(true)

    expect(await journal.undoTurn('turn-1', handlers)).toEqual({
      undone: 0,
      results: []
    })
    expect(order).toHaveLength(3)
  })

  test('awaits an async failure, records it, and continues without marking it undone', async () => {
    record({ turnId: 'turn-1', targetId: 'first.md' })
    record({ turnId: 'turn-1', targetId: 'broken.md' })
    record({ turnId: 'turn-1', targetId: 'third.md' })
    const attempts: string[] = []
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handlers = undoHandlers({
      note: async ({ targetId }) => {
        attempts.push(targetId)
        await Promise.resolve()
        if (targetId === 'broken.md') throw new Error('cannot delete')
      }
    })

    const actions = journal.forTurn('turn-1').actions
    const byTarget = new Map(actions.map((action) => [action.targetId, action.id]))
    expect(await journal.undoTurn('turn-1', handlers)).toEqual({
      undone: 2,
      results: [
        { actionId: byTarget.get('third.md'), ok: true },
        {
          actionId: byTarget.get('broken.md'),
          ok: false,
          error: 'cannot delete'
        },
        { actionId: byTarget.get('first.md'), ok: true }
      ]
    })
    expect(attempts).toEqual(['third.md', 'broken.md', 'first.md'])
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('1 action(s) failed'),
      expect.any(Array)
    )
    expect(
      journal.forTurn('turn-1').actions.find((action) => action.targetId === 'broken.md')
        ?.undoneAt
    ).toBeNull()
  })

  test('does not undo entries marked undoable false', async () => {
    record({ turnId: 'turn-1', targetId: 'deleted.md', undoable: false })
    const note = vi.fn(async () => undefined)

    expect(await journal.undoTurn('turn-1', undoHandlers({ note }))).toEqual({
      undone: 0,
      results: []
    })
    expect(note).not.toHaveBeenCalled()
    expect(journal.forTurn('turn-1').actions[0]).toMatchObject({
      undoable: false,
      undoneAt: null
    })
  })

  test('dispatches material-edit targets to the material-edit undo handler', async () => {
    record({
      turnId: 'turn-1',
      targetId: 'sheet.xlsx\u0000/backups/sheet.xlsx',
      targetKind: 'material-edit'
    })
    const seen: string[] = []

    const [action] = journal.forTurn('turn-1').actions
    expect(
      await journal.undoTurn(
        'turn-1',
        undoHandlers({
          'material-edit': async ({ targetId }) => {
            seen.push(targetId)
          }
        })
      )
    ).toEqual({
      undone: 1,
      results: [{ actionId: action?.id, ok: true }]
    })
    expect(seen).toEqual(['sheet.xlsx\u0000/backups/sheet.xlsx'])
  })

  test('awaits link removal through the link undo handler', async () => {
    record({
      turnId: 'turn-1',
      targetId: 'link-1',
      targetKind: 'link'
    })
    const remove = vi.fn(async (_input: UndoTarget) => undefined)

    const [action] = journal.forTurn('turn-1').actions
    expect(
      await journal.undoTurn('turn-1', undoHandlers({ link: remove }))
    ).toEqual({
      undone: 1,
      results: [{ actionId: action?.id, ok: true }]
    })
    expect(remove).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      targetId: 'link-1'
    })
  })

  test('does not touch actions from another turn', async () => {
    record({ turnId: 'turn-1', targetId: 'this-turn.md' })
    record({ turnId: 'turn-2', targetId: 'other-turn.md' })
    const removed: string[] = []

    const [action] = journal.forTurn('turn-1').actions
    expect(
      await journal.undoTurn(
        'turn-1',
        undoHandlers({
          note: async ({ targetId }) => {
            removed.push(targetId)
          }
        })
      )
    ).toEqual({
      undone: 1,
      results: [{ actionId: action?.id, ok: true }]
    })

    expect(removed).toEqual(['this-turn.md'])
    expect(journal.forTurn('turn-2').actions[0]?.undoneAt).toBeNull()
  })
})
