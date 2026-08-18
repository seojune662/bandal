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
  const noop = (_input: UndoTarget): void => undefined
  return {
    course: overrides.course ?? noop,
    material: overrides.material ?? noop,
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

  test('lists three creations and undoes them once in reverse order', () => {
    record({ turnId: 'turn-1', targetId: 'first.md' })
    record({ turnId: 'turn-1', targetId: 'second.md' })
    record({ turnId: 'turn-1', targetId: 'third.md' })
    const order: string[] = []
    const handlers = undoHandlers({
      note: ({ targetId }) => order.push(targetId)
    })

    expect(journal.forTurn('turn-1').actions).toHaveLength(3)
    expect(journal.undoTurn('turn-1', handlers)).toEqual({ undone: 3 })
    expect(order).toEqual(['third.md', 'second.md', 'first.md'])
    expect(journal.forTurn('turn-1').actions.every((action) => action.undoneAt !== null))
      .toBe(true)

    expect(journal.undoTurn('turn-1', handlers)).toEqual({ undone: 0 })
    expect(order).toHaveLength(3)
  })

  test('continues after one undo handler throws and logs the failure count', () => {
    record({ turnId: 'turn-1', targetId: 'first.md' })
    record({ turnId: 'turn-1', targetId: 'broken.md' })
    record({ turnId: 'turn-1', targetId: 'third.md' })
    const attempts: string[] = []
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handlers = undoHandlers({
      note: ({ targetId }) => {
        attempts.push(targetId)
        if (targetId === 'broken.md') throw new Error('cannot delete')
      }
    })

    expect(journal.undoTurn('turn-1', handlers)).toEqual({ undone: 2 })
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

  test('does not undo entries marked undoable false', () => {
    record({ turnId: 'turn-1', targetId: 'deleted.md', undoable: false })
    const note = vi.fn()

    expect(journal.undoTurn('turn-1', undoHandlers({ note }))).toEqual({ undone: 0 })
    expect(note).not.toHaveBeenCalled()
    expect(journal.forTurn('turn-1').actions[0]).toMatchObject({
      undoable: false,
      undoneAt: null
    })
  })

  test('dispatches material-edit targets to the material-edit undo handler', () => {
    record({
      turnId: 'turn-1',
      targetId: 'sheet.xlsx\u0000/backups/sheet.xlsx',
      targetKind: 'material-edit'
    })
    const seen: string[] = []

    expect(
      journal.undoTurn(
        'turn-1',
        undoHandlers({ 'material-edit': ({ targetId }) => seen.push(targetId) })
      )
    ).toEqual({ undone: 1 })
    expect(seen).toEqual(['sheet.xlsx\u0000/backups/sheet.xlsx'])
  })

  test('does not touch actions from another turn', () => {
    record({ turnId: 'turn-1', targetId: 'this-turn.md' })
    record({ turnId: 'turn-2', targetId: 'other-turn.md' })
    const removed: string[] = []

    expect(
      journal.undoTurn(
        'turn-1',
        undoHandlers({ note: ({ targetId }) => removed.push(targetId) })
      )
    ).toEqual({ undone: 1 })

    expect(removed).toEqual(['this-turn.md'])
    expect(journal.forTurn('turn-2').actions[0]?.undoneAt).toBeNull()
  })
})
