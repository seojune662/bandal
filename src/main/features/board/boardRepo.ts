/**
 * Task board repository (`board_tasks` table). Tasks belong to a course or
 * are global (course_id NULL). sort_order orders tasks within a
 * (courseId, status) column; new/moved tasks append to the end.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  BoardTask,
  CalendarRangeInput,
  CreateTaskInput,
  ListTasksInput,
  TaskKind,
  TaskStatus,
  UpdateTaskInput,
  UpcomingDeadline
} from '../../../shared/types/board'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireInt, requireNonEmptyString } from '../../db/validate'
import { localCalendarDayDifference, localDayEndExclusive } from './calendarTime'

export interface ListUpcomingInput {
  courseId?: string | null
  withinDays?: number
  limit?: number
}

export interface BoardRepo {
  list(input?: ListTasksInput): BoardTask[]
  listRange(input: CalendarRangeInput): BoardTask[]
  upcoming(input?: ListUpcomingInput): UpcomingDeadline[]
  create(input: CreateTaskInput): BoardTask
  update(input: UpdateTaskInput): BoardTask
  reorderTasks(
    courseId: string,
    updates: Array<{
      id: string
      status?: BoardTask['status']
      sortOrder: number
    }>
  ): BoardTask[]
  softDelete(input: { id: string }): { ok: true }
}

interface TaskRow {
  id: string
  course_id: string | null
  title: string
  notes: string
  status: string
  kind: string
  due_at: string | null
  all_day: number
  sort_order: number
  created_at: string
  updated_at: string
}

const STATUSES: readonly TaskStatus[] = ['todo', 'in-progress', 'done']
const KINDS: readonly TaskKind[] = ['task', 'assignment', 'exam', 'class']

function assertStatus(value: unknown): TaskStatus {
  if (!STATUSES.includes(value as TaskStatus)) {
    throw new ValidationError(
      `status must be one of ${STATUSES.join(', ')} (got "${String(value)}")`
    )
  }
  return value as TaskStatus
}

function assertKind(value: unknown): TaskKind {
  if (!KINDS.includes(value as TaskKind)) {
    throw new ValidationError(
      `kind must be one of ${KINDS.join(', ')} (got "${String(value)}")`
    )
  }
  return value as TaskKind
}

function assertAllDay(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('allDay must be a boolean')
  }
  return value
}

function assertDueAt(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError('dueAt must be an ISO datetime string or null')
  }
  return new Date(value).toISOString()
}

function requireIso(value: unknown, name: string): string {
  const result = assertDueAt(value)
  if (result === null) throw new ValidationError(`${name} must be an ISO datetime string`)
  return result
}

function rowToTask(row: TaskRow): BoardTask {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    notes: row.notes,
    status: row.status as TaskStatus,
    kind: row.kind as TaskKind,
    dueAt: row.due_at,
    allDay: row.all_day === 1,
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

  const reorderTasksTransaction = db.transaction(
    (
      rawCourseId: string,
      updates: Array<{
        id: string
        status?: BoardTask['status']
        sortOrder: number
      }>
    ): BoardTask[] => {
      const courseId = requireId(rawCourseId, 'courseId')
      assertCourseExists(courseId)
      const updateRow = db.prepare(
        `UPDATE board_tasks
         SET status = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND course_id = ? AND deleted_at IS NULL`
      )
      const changed: BoardTask[] = []
      const now = nowIso()

      for (const update of updates) {
        const id = requireId(update.id, 'updates[].id')
        const sortOrder = requireInt(update.sortOrder, 'updates[].sortOrder', 0)
        const row = db
          .prepare(
            `SELECT * FROM board_tasks
             WHERE id = ? AND course_id = ? AND deleted_at IS NULL`
          )
          .get(id, courseId) as TaskRow | undefined
        if (row === undefined) throw new NotFoundError('task', id)

        const status =
          update.status === undefined
            ? (row.status as TaskStatus)
            : assertStatus(update.status)
        const result = updateRow.run(status, sortOrder, now, id, courseId)
        if (result.changes !== 1) throw new NotFoundError('task', id)
        changed.push(
          rowToTask({
            ...row,
            status,
            sort_order: sortOrder,
            updated_at: now
          })
        )
      }

      return changed
    }
  )

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

    listRange(input) {
      const from = requireIso(input.from, 'from')
      const to = requireIso(input.to, 'to')
      if (from >= to) throw new ValidationError('to must be after from')

      const clauses = [
        'deleted_at IS NULL',
        'due_at IS NOT NULL',
        'due_at >= ?',
        'due_at < ?'
      ]
      const params = [from, to]
      if (input.courseId === null) {
        clauses.push('course_id IS NULL')
      } else if (input.courseId !== undefined) {
        clauses.push('course_id = ?')
        params.push(requireId(input.courseId, 'courseId'))
      }

      const rows = db
        .prepare(
          `SELECT * FROM board_tasks WHERE ${clauses.join(' AND ')}
           ORDER BY due_at ASC, created_at ASC`
        )
        .all(...params) as TaskRow[]
      return rows.map(rowToTask)
    },

    upcoming(input = {}) {
      const withinDays = requireInt(input.withinDays ?? 14, 'withinDays', 0)
      const limit = requireInt(input.limit ?? 5, 'limit', 1)
      const now = new Date()
      const clauses = [
        't.deleted_at IS NULL',
        "t.status != 'done'",
        't.due_at IS NOT NULL',
        't.due_at < ?'
      ]
      const params = [localDayEndExclusive(now, withinDays).toISOString()]
      if (input.courseId === null) {
        clauses.push('t.course_id IS NULL')
      } else if (input.courseId !== undefined) {
        clauses.push('t.course_id = ?')
        params.push(requireId(input.courseId, 'courseId'))
      }

      type UpcomingRow = TaskRow & { course_name: string | null }
      const rows = db
        .prepare(
          `SELECT t.*, c.name AS course_name
           FROM board_tasks t
           LEFT JOIN courses c ON c.id = t.course_id AND c.deleted_at IS NULL
           WHERE ${clauses.join(' AND ')}`
        )
        .all(...params) as UpcomingRow[]

      return rows
        .map((row) => {
          const task = rowToTask(row)
          const due = new Date(task.dueAt as string)
          const daysLeft = localCalendarDayDifference(due, now)
          const overdue = task.allDay ? daysLeft < 0 : due.getTime() < now.getTime()
          return { task, courseName: row.course_name, daysLeft, overdue, due }
        })
        .sort((left, right) => {
          if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
          return left.overdue
            ? right.due.getTime() - left.due.getTime()
            : left.due.getTime() - right.due.getTime()
        })
        .slice(0, limit)
        .map(({ task, courseName, daysLeft, overdue }) => ({
          task,
          courseName,
          daysLeft,
          overdue
        }))
    },

    create(input) {
      const title = requireNonEmptyString(input.title, 'title').trim()
      const courseId = input.courseId === null ? null : requireId(input.courseId, 'courseId')
      if (courseId !== null) {
        assertCourseExists(courseId)
      }
      const status = input.status === undefined ? 'todo' : assertStatus(input.status)
      const kind = input.kind === undefined ? 'task' : assertKind(input.kind)
      const notes = input.notes ?? ''
      if (typeof notes !== 'string') {
        throw new ValidationError('notes must be a string')
      }
      const dueAt = assertDueAt(input.dueAt)
      const allDay = input.allDay === undefined ? false : assertAllDay(input.allDay)

      const now = nowIso()
      const task: BoardTask = {
        id: randomUUID(),
        courseId,
        title,
        notes,
        status,
        kind,
        dueAt,
        allDay,
        sortOrder: nextSortOrder(courseId, status),
        createdAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO board_tasks
           (id, course_id, title, notes, status, kind, due_at, all_day,
            sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        task.id,
        courseId,
        title,
        notes,
        status,
        kind,
        dueAt,
        allDay ? 1 : 0,
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
      const kind = input.kind === undefined ? (row.kind as TaskKind) : assertKind(input.kind)
      const dueAt = input.dueAt === undefined ? row.due_at : assertDueAt(input.dueAt)
      const allDay =
        input.allDay === undefined ? row.all_day === 1 : assertAllDay(input.allDay)

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
         SET title = ?, notes = ?, status = ?, kind = ?, due_at = ?, all_day = ?,
             sort_order = ?, course_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(title, notes, status, kind, dueAt, allDay ? 1 : 0, sortOrder, courseId, now, row.id)
      return rowToTask({
        ...row,
        title,
        notes,
        status,
        kind,
        due_at: dueAt,
        all_day: allDay ? 1 : 0,
        sort_order: sortOrder,
        course_id: courseId,
        updated_at: now
      })
    },

    reorderTasks(courseId, updates) {
      return reorderTasksTransaction(courseId, updates)
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
