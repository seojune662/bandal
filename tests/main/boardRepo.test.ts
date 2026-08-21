import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createBoardRepo,
  localCalendarDayDifference,
  type BoardRepo
} from '../../src/main/features/board'
import { createCoursesRepo, type CoursesRepo } from '../../src/main/features/courses'
import { NotFoundError, ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('boardRepo', () => {
  let ctx: TestDb
  let repo: BoardRepo
  let courses: CoursesRepo
  let courseId: string

  beforeEach(() => {
    ctx = createTestDb()
    courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: 'Course', color: '#000' }).id
    repo = createBoardRepo(ctx.db)
  })

  afterEach(() => {
    vi.useRealTimers()
    ctx.cleanup()
  })

  describe('create', () => {
    test('appends new tasks to the end of their status column', () => {
      // Act
      const first = repo.create({ courseId, title: 'first' })
      const second = repo.create({ courseId, title: 'second' })
      const doneTask = repo.create({ courseId, title: 'done', status: 'done' })

      // Assert
      expect(first.sortOrder).toBe(0)
      expect(second.sortOrder).toBe(1)
      expect(doneTask.sortOrder).toBe(0) // separate column
    })

    test('supports global tasks with courseId null', () => {
      // Act
      const task = repo.create({ courseId: null, title: 'global chore' })

      // Assert
      expect(task.courseId).toBeNull()
      expect(repo.list({ courseId: null })[0]?.id).toBe(task.id)
    })

    test('defaults kind and allDay and persists explicit calendar fields', () => {
      const regular = repo.create({ courseId, title: 'regular' })
      const exam = repo.create({
        courseId,
        title: 'midterm',
        kind: 'exam',
        allDay: true,
        dueAt: '2026-09-01T00:00:00+09:00'
      })

      expect(regular.kind).toBe('task')
      expect(regular.allDay).toBe(false)
      expect(exam.kind).toBe('exam')
      expect(exam.allDay).toBe(true)
      expect(exam.dueAt).toBe('2026-08-31T15:00:00.000Z')
      expect(repo.list({ courseId, includeDone: true }).find((task) => task.id === exam.id))
        .toMatchObject({ kind: 'exam', allDay: true })
    })

    test('rejects an empty title and an unknown course', () => {
      // Act / Assert
      expect(() => repo.create({ courseId, title: ' ' })).toThrow(ValidationError)
      expect(() => repo.create({ courseId: 'ghost', title: 'x' })).toThrow(NotFoundError)
    })
  })

  describe('list', () => {
    test('excludes done tasks unless includeDone is set', () => {
      // Arrange
      repo.create({ courseId, title: 'open' })
      repo.create({ courseId, title: 'finished', status: 'done' })

      // Act / Assert
      expect(repo.list({ courseId })).toHaveLength(1)
      expect(repo.list({ courseId, includeDone: true })).toHaveLength(2)
    })

    test('orders tasks by sort_order within a column', () => {
      // Arrange
      repo.create({ courseId, title: 'a' })
      repo.create({ courseId, title: 'b' })
      repo.create({ courseId, title: 'c' })

      // Act
      const titles = repo.list({ courseId }).map((t) => t.title)

      // Assert
      expect(titles).toEqual(['a', 'b', 'c'])
    })
  })

  describe('update', () => {
    test('moving to a new status appends to the end of that column', () => {
      // Arrange
      repo.create({ courseId, title: 'wip-existing', status: 'in-progress' })
      const task = repo.create({ courseId, title: 'todo-task' })

      // Act
      const moved = repo.update({ id: task.id, status: 'in-progress' })

      // Assert
      expect(moved.status).toBe('in-progress')
      expect(moved.sortOrder).toBe(1)
    })

    test('honors an explicit sortOrder on move', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'task' })

      // Act
      const moved = repo.update({ id: task.id, status: 'done', sortOrder: 5 })

      // Assert
      expect(moved.sortOrder).toBe(5)
    })

    test('updates content fields without touching sort order', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'old', notes: 'n' })

      // Act
      const updated = repo.update({
        id: task.id,
        title: 'new',
        notes: 'edited',
        dueAt: '2026-09-01T00:00:00.000Z'
      })

      // Assert
      expect(updated.title).toBe('new')
      expect(updated.notes).toBe('edited')
      expect(updated.dueAt).toBe('2026-09-01T00:00:00.000Z')
      expect(updated.sortOrder).toBe(task.sortOrder)
    })

    test('updates kind and allDay without touching sort order', () => {
      const task = repo.create({ courseId, title: 'quiz' })

      const updated = repo.update({ id: task.id, kind: 'exam', allDay: true })

      expect(updated).toMatchObject({ kind: 'exam', allDay: true })
      expect(updated.sortOrder).toBe(task.sortOrder)
    })

    test('moving to another course keeps the id and appends to that column', () => {
      // Arrange
      const otherCourseId = courses.create({ name: 'Other', color: '#111' }).id
      repo.create({ courseId: otherCourseId, title: 'existing-in-other' })
      const task = repo.create({ courseId, title: 'movable' })

      // Act
      const moved = repo.update({ id: task.id, courseId: otherCourseId })

      // Assert
      expect(moved.id).toBe(task.id)
      expect(moved.courseId).toBe(otherCourseId)
      expect(moved.sortOrder).toBe(1) // appended after existing-in-other
      expect(repo.list({ courseId })).toHaveLength(0)
      expect(repo.list({ courseId: otherCourseId })).toHaveLength(2)
    })

    test('moving to global sets courseId null', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'to-global' })

      // Act
      const moved = repo.update({ id: task.id, courseId: null })

      // Assert
      expect(moved.courseId).toBeNull()
      expect(repo.list({ courseId: null })[0]?.id).toBe(task.id)
    })

    test('an unchanged courseId does not disturb the sort order', () => {
      // Arrange
      repo.create({ courseId, title: 'first' })
      const task = repo.create({ courseId, title: 'second' })

      // Act
      const updated = repo.update({ id: task.id, courseId, title: 'renamed' })

      // Assert
      expect(updated.sortOrder).toBe(task.sortOrder)
    })

    test('rejects a move to an unknown course', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'task' })

      // Act / Assert
      expect(() => repo.update({ id: task.id, courseId: 'ghost' })).toThrow(
        NotFoundError
      )
    })

    test('rejects an invalid dueAt', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'task' })

      // Act / Assert
      expect(() => repo.update({ id: task.id, dueAt: 'not-a-date' })).toThrow(
        ValidationError
      )
    })
  })

  describe('reorderTasks', () => {
    test('updates status and order together and returns the changed rows', () => {
      const first = repo.create({ courseId, title: 'first' })
      const second = repo.create({ courseId, title: 'second' })

      const changed = repo.reorderTasks(courseId, [
        { id: second.id, sortOrder: 0 },
        { id: first.id, status: 'in-progress', sortOrder: 1 }
      ])

      expect(changed.map((task) => ({
        id: task.id,
        status: task.status,
        sortOrder: task.sortOrder
      }))).toEqual([
        { id: second.id, status: 'todo', sortOrder: 0 },
        { id: first.id, status: 'in-progress', sortOrder: 1 }
      ])
      expect(repo.list({ courseId }).map((task) => ({
        id: task.id,
        status: task.status,
        sortOrder: task.sortOrder
      }))).toEqual([
        { id: first.id, status: 'in-progress', sortOrder: 1 },
        { id: second.id, status: 'todo', sortOrder: 0 }
      ])
    })

    test('rolls back every update when a later task is invalid', () => {
      const first = repo.create({ courseId, title: 'first' })
      const second = repo.create({ courseId, title: 'second' })

      expect(() => repo.reorderTasks(courseId, [
        { id: first.id, status: 'done', sortOrder: 9 },
        { id: 'missing-task', sortOrder: 0 }
      ])).toThrow(NotFoundError)

      expect(repo.list({ courseId, includeDone: true }).map((task) => ({
        id: task.id,
        status: task.status,
        sortOrder: task.sortOrder
      }))).toEqual([
        { id: first.id, status: 'todo', sortOrder: 0 },
        { id: second.id, status: 'todo', sortOrder: 1 }
      ])
    })
  })

  describe('softDelete', () => {
    test('removes the task from listings', () => {
      // Arrange
      const task = repo.create({ courseId, title: 'bye' })

      // Act
      repo.softDelete({ id: task.id })

      // Assert
      expect(repo.list({ courseId })).toHaveLength(0)
      expect(() => repo.update({ id: task.id, title: 'x' })).toThrow(NotFoundError)
    })
  })

  describe('calendar range', () => {
    test('lists due entries in a half-open range and applies the course filter', () => {
      const otherCourseId = courses.create({ name: 'Other', color: '#111' }).id
      const atStart = repo.create({
        courseId,
        title: 'at-start',
        dueAt: '2026-08-01T00:00:00.000Z'
      })
      repo.create({ courseId, title: 'at-end', dueAt: '2026-09-01T00:00:00.000Z' })
      repo.create({ courseId: otherCourseId, title: 'other', dueAt: '2026-08-10T00:00:00.000Z' })
      repo.create({ courseId, title: 'without-date' })

      expect(repo.listRange({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        courseId
      }).map((task) => task.id)).toEqual([atStart.id])
    })

    test('uses the due-date index for the half-open bounds', () => {
      const plan = ctx.db.prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM board_tasks
         WHERE deleted_at IS NULL AND due_at IS NOT NULL
           AND due_at >= ? AND due_at < ?
         ORDER BY due_at ASC, created_at ASC`
      ).all('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z') as Array<{ detail: string }>

      expect(plan.some((step) => step.detail.includes('idx_board_tasks_due'))).toBe(true)
    })

    test('rejects an empty or reversed range', () => {
      expect(() => repo.listRange({ from: 'bad', to: '2026-09-01T00:00:00.000Z' }))
        .toThrow(ValidationError)
      expect(() => repo.listRange({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z'
      })).toThrow(ValidationError)
    })
  })

  describe('upcoming deadlines', () => {
    test('joins course names, keeps recent overdue work, and orders future work nearest first', () => {
      const now = new Date(2026, 7, 31, 12)
      vi.useFakeTimers()
      vi.setSystemTime(now)
      const overdue = repo.create({
        courseId,
        title: 'morning deadline',
        kind: 'assignment',
        dueAt: new Date(2026, 7, 31, 9).toISOString()
      })
      const tomorrow = repo.create({
        courseId,
        title: 'tomorrow exam',
        kind: 'exam',
        allDay: true,
        dueAt: new Date(2026, 8, 1).toISOString()
      })
      const later = repo.create({
        courseId,
        title: 'later',
        dueAt: new Date(2026, 8, 2, 18).toISOString()
      })
      repo.create({
        courseId,
        title: 'done',
        status: 'done',
        dueAt: new Date(2026, 8, 1, 10).toISOString()
      })

      const deadlines = repo.upcoming({ courseId, withinDays: 2, limit: 10 })

      expect(deadlines.map((entry) => entry.task.id)).toEqual([
        overdue.id,
        tomorrow.id,
        later.id
      ])
      expect(deadlines[0]).toMatchObject({ courseName: 'Course', daysLeft: 0, overdue: true })
      expect(deadlines[1]).toMatchObject({ courseName: 'Course', daysLeft: 1, overdue: false })
    })

    test('counts local midnights across month and year boundaries', () => {
      expect(localCalendarDayDifference(
        new Date(2026, 8, 1, 0, 1),
        new Date(2026, 7, 31, 23, 59)
      )).toBe(1)
      expect(localCalendarDayDifference(
        new Date(2027, 0, 1, 0, 1),
        new Date(2026, 11, 31, 23, 59)
      )).toBe(1)
    })
  })
})
