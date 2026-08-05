import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createBoardRepo, type BoardRepo } from '../../src/main/features/board'
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
})
