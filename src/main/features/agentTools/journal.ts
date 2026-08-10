import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  AgentAction,
  AgentActionTarget,
  AgentTurnChanges
} from '../../../shared/types/agentTools'

export interface UndoTarget {
  courseId: string
  targetId: string
}

/** Synchronous deletion functions supplied by the app's repository layer. */
export interface UndoHandlers {
  course(input: UndoTarget): void
  material(input: UndoTarget): void
  note(input: UndoTarget): void
  task(input: UndoTarget): void
  board(input: UndoTarget): void
  shape(input: UndoTarget): void
}

export interface AgentJournal {
  record(
    entry: Omit<AgentAction, 'id' | 'createdAt' | 'undoneAt'>
  ): AgentAction
  forTurn(turnId: string): AgentTurnChanges
  undoTurn(turnId: string, undoers: UndoHandlers): { undone: number }
}

interface AgentActionRow {
  id: string
  course_id: string
  turn_id: string
  tool: string
  target_kind: string
  target_id: string
  label: string
  undoable: number
  undone_at: string | null
  created_at: string
}

function rowToAction(row: AgentActionRow): AgentAction {
  return {
    id: row.id,
    courseId: row.course_id,
    turnId: row.turn_id,
    tool: row.tool,
    targetKind: row.target_kind as AgentActionTarget,
    targetId: row.target_id,
    label: row.label,
    undoable: row.undoable === 1,
    undoneAt: row.undone_at,
    createdAt: row.created_at
  }
}

export function createAgentJournal(db: Database): AgentJournal {
  const insert = db.prepare(
    `INSERT INTO agent_actions
       (id, course_id, turn_id, tool, target_kind, target_id, label,
        undoable, undone_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  )
  const selectForTurn = db.prepare(
    `SELECT * FROM agent_actions
     WHERE turn_id = ?
     ORDER BY created_at ASC, rowid ASC`
  )
  const selectUndoableForTurn = db.prepare(
    `SELECT * FROM agent_actions
     WHERE turn_id = ? AND undoable = 1 AND undone_at IS NULL
     ORDER BY created_at DESC, rowid DESC`
  )
  const markUndone = db.prepare(
    `UPDATE agent_actions
     SET undone_at = ?
     WHERE id = ? AND undone_at IS NULL`
  )

  return {
    record(entry) {
      const action: AgentAction = {
        ...entry,
        id: randomUUID(),
        undoneAt: null,
        createdAt: new Date().toISOString()
      }

      insert.run(
        action.id,
        action.courseId,
        action.turnId,
        action.tool,
        action.targetKind,
        action.targetId,
        action.label,
        action.undoable ? 1 : 0,
        action.createdAt
      )
      return action
    },

    forTurn(turnId) {
      const rows = selectForTurn.all(turnId) as AgentActionRow[]
      return { turnId, actions: rows.map(rowToAction) }
    },

    undoTurn(turnId, undoers) {
      const rows = selectUndoableForTurn.all(turnId) as AgentActionRow[]
      let undone = 0
      const failures: Array<{ actionId: string; error: unknown }> = []

      for (const row of rows) {
        const action = rowToAction(row)
        try {
          undoers[action.targetKind]({
            courseId: action.courseId,
            targetId: action.targetId
          })
          const result = markUndone.run(new Date().toISOString(), action.id)
          if (result.changes === 1) undone += 1
        } catch (error) {
          failures.push({ actionId: action.id, error })
        }
      }

      if (failures.length > 0) {
        console.error(
          `[agentTools] ${failures.length} action(s) failed to undo for turn "${turnId}"`,
          failures
        )
      }

      return { undone }
    }
  }
}
