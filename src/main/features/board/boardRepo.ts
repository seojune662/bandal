/**
 * Task board repository (`board_tasks` table). Tasks belong to a course or
 * are global (course_id NULL). sort_order orders tasks within a
 * (courseId, status) column; new/moved tasks append to the end.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  BoardTask,
  CreateTaskInput,
  ListTasksInput,
  TaskStatus,
  UpdateTaskInput
} from '../../../shared/types/board'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireInt, requireNonEmptyString } from '../../db/validate'

export interface BoardRepo {
  list(input?: ListTasksInput): BoardTask[]
  create(input: CreateTaskInput): BoardTask
  update(input: UpdateTaskInput): BoardTask
  softDelete(input: { id: string }): { ok: true }
}

interface TaskRow {
  id: string
  course_id: string | null
  title: string
  notes: string
  status: string
  due_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

const STATUSES: readonly TaskStatus[] = ['todo', 'in-progress', 'done']

function assertStatus(value: unknown): TaskStatus {
  if (!STATUSES.includes(value as TaskStatus)) {
    throw new ValidationError(
      `status must be one of ${STATUSES.join(', ')} (got "${String(value)}")`
    )
  }
  return value as TaskStatus
}

function assertDueAt(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError('dueAt must be an ISO datetime string or null')
  }
  return value
}

function rowToTask(row: TaskRow): BoardTask {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    notes: row.notes,
    status: row.status as TaskStatus,
    dueAt: row.due_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createBoardRepo(db: Database): BoardRepo {
  function assertCourseExists(courseId: string): void {
    const row = db
      .prepare('SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL')
      .get(courseId)
    if (row === undefined) {
      throw new NotFoundError('course', courseId)
    }
  }

  function getRowOrThrow(id: string): TaskRow {
    const row = db
      .prepare('SELECT * FROM board_tasks WHERE id = ? AND deleted_at IS NULL')
      .get(id) as TaskRow | undefined
    if (row === undefined) {
      throw new NotFoundError('task', id)
    }
    return row
  }

  /** Next sort_order at the end of a (courseId, status) column. */
  function nextSortOrder(courseId: string | null, status: TaskStatus): number {
    const row = db
      .prepare(
        `SELECT MAX(sort_order) AS max FROM board_tasks
         WHERE deleted_at IS NULL AND status = ?
           AND ${courseId === null ? 'course_id IS NULL' : 'course_id = ?'}`
      )
      .get(...(courseId === null ? [status] : [status, courseId])) as {
      max: number | null
    }
    return (row.max ?? -1) + 1
  }

  return {
    list(input = {}) {
      const includeDone = input.includeDone === true
      const clauses = ['deleted_at IS NULL']
      const params: string[] = []
      if (input.courseId === null) {
        clauses.push('course_id IS NULL')
      } else if (input.courseId !== undefined) {
        clauses.push('course_id = ?')
        params.push(requireId(input.courseId, 'courseId'))
      }
      if (!includeDone) {
        clauses.push("status != 'done'")
      }
      const rows = db
        .prepare(
          `SELECT * FROM board_tasks WHERE ${clauses.join(' AND ')}
           ORDER BY status ASC, sort_order ASC, created_at ASC`
        )
        .all(...params) as TaskRow[]
      return rows.map(rowToTask)
    },

    create(input) {
      const title = requireNonEmptyString(input.title, 'title').trim()
      const courseId = input.courseId === null ? null : requireId(input.courseId, 'courseId')
      if (courseId !== null) {
        assertCourseExists(courseId)
      }
      const status = input.status === undefined ? 'todo' : assertStatus(input.status)
      const notes = input.notes ?? ''
      if (typeof notes !== 'string') {
        throw new ValidationError('notes must be a string')
      }
      const dueAt = assertDueAt(input.dueAt)

      const now = nowIso()
      const task: BoardTask = {
        id: randomUUID(),
        courseId,
        title,
        notes,
        status,
        dueAt,
        sortOrder: nextSortOrder(courseId, status),
        createdAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO board_tasks
           (id, course_id, title, notes, status, due_at, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        task.id,
        courseId,
        title,
        notes,
        status,
        dueAt,
        task.sortOrder,
        now,
        now
      )
      return task
    },

    update(input) {
      const row = getRowOrThrow(requireId(input.id, 'id'))

      const title =
        input.title === undefined ? row.title : requireNonEmptyString(input.title, 'title').trim()
      const notes = input.notes === undefined ? row.notes : input.notes
      if (typeof notes !== 'string') {
        throw new ValidationError('notes must be a string')
      }
      const status = input.status === undefined ? (row.status as TaskStatus) : assertStatus(input.status)
      const dueAt = input.dueAt === undefined ? row.due_at : assertDueAt(input.dueAt)

      let courseId: string | null
      if (input.courseId === undefined) {
        courseId = row.course_id
      } else if (input.courseId === null) {
        courseId = null
      } else {
        courseId = requireId(input.courseId, 'courseId')
        assertCourseExists(courseId)
      }

      let sortOrder: number
      if (input.sortOrder !== undefined) {
        sortOrder = requireInt(input.sortOrder, 'sortOrder', 0)
      } else if (status !== row.status || courseId !== row.course_id) {
        // Moved to a different (course, status) column without an explicit
        // position → append to the end of the target column.
        sortOrder = nextSortOrder(courseId, status)
      } else {
        sortOrder = row.sort_order
      }

      const now = nowIso()
      db.prepare(
        `UPDATE board_tasks
         SET title = ?, notes = ?, status = ?, due_at = ?, sort_order = ?,
             course_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(title, notes, status, dueAt, sortOrder, courseId, now, row.id)
      return rowToTask({
        ...row,
        title,
        notes,
        status,
        due_at: dueAt,
        sort_order: sortOrder,
        course_id: courseId,
        updated_at: now
      })
    },

    softDelete(input) {
      const row = getRowOrThrow(requireId(input.id, 'id'))
      const now = nowIso()
      db.prepare('UPDATE board_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
        now,
        now,
        row.id
      )
      return { ok: true }
    }
  }
}
