import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createCourseGroupsRepo,
  createCoursesRepo,
  type CourseGroupsRepo,
  type CoursesRepo
} from '../../src/main/features/courses'
import { NotFoundError, ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('courseGroupsRepo', () => {
  let ctx: TestDb
  let groups: CourseGroupsRepo
  let courses: CoursesRepo

  beforeEach(() => {
    ctx = createTestDb()
    groups = createCourseGroupsRepo(ctx.db)
    courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('CRUD', () => {
    test('creates groups with appended sort order and lists live ones in order', () => {
      // Act
      const first = groups.create({ name: '1학기' })
      const second = groups.create({ name: '  2학기  ' })

      // Assert — name is trimmed, sortOrder appends.
      expect(first.sortOrder).toBe(0)
      expect(second.name).toBe('2학기')
      expect(second.sortOrder).toBe(1)
      expect(groups.list().map((group) => group.id)).toEqual([first.id, second.id])
    })

    test('renames a live group and rejects unknown or empty input', () => {
      // Arrange
      const group = groups.create({ name: '1학기' })

      // Act
      const renamed = groups.rename({ groupId: group.id, name: '2026-1' })

      // Assert
      expect(renamed.name).toBe('2026-1')
      expect(groups.list()[0]?.name).toBe('2026-1')
      expect(() => groups.rename({ groupId: 'ghost', name: 'x' })).toThrow(
        NotFoundError
      )
      expect(() => groups.rename({ groupId: group.id, name: '  ' })).toThrow(
        ValidationError
      )
      expect(() => groups.create({ name: '' })).toThrow(ValidationError)
    })
  })

  describe('delete', () => {
    test('soft-deletes the group and un-groups member courses without deleting them', () => {
      // Arrange
      const group = groups.create({ name: '1학기' })
      const member = courses.create({ name: '자료구조', color: '#000' })
      const outsider = courses.create({ name: '운영체제', color: '#000' })
      courses.organize({ courseId: member.id, groupId: group.id, beforeCourseId: null })

      // Act
      expect(groups.delete({ groupId: group.id })).toEqual({ ok: true })

      // Assert — group gone from list(), both courses still live and ungrouped.
      expect(groups.list()).toEqual([])
      const remaining = courses.list()
      expect(remaining.map((course) => course.id).sort()).toEqual(
        [member.id, outsider.id].sort()
      )
      expect(remaining.every((course) => course.groupId === null)).toBe(true)
      // Soft delete: the row survives with deleted_at set.
      const row = ctx.db
        .prepare('SELECT deleted_at FROM course_groups WHERE id = ?')
        .get(group.id) as { deleted_at: string | null }
      expect(row.deleted_at).not.toBeNull()
      expect(() => groups.delete({ groupId: group.id })).toThrow(NotFoundError)
    })
  })

  describe('courses.organize', () => {
    test('moves a course into a group and positions it before another member', () => {
      // Arrange
      const group = groups.create({ name: '1학기' })
      const a = courses.create({ name: 'A', color: '#000' })
      const b = courses.create({ name: 'B', color: '#000' })
      const c = courses.create({ name: 'C', color: '#000' })
      courses.organize({ courseId: a.id, groupId: group.id, beforeCourseId: null })
      courses.organize({ courseId: b.id, groupId: group.id, beforeCourseId: null })

      // Act — drop C before B inside the group.
      const result = courses.organize({
        courseId: c.id,
        groupId: group.id,
        beforeCourseId: b.id
      })

      // Assert — membership and order come back in one refreshed list.
      expect(result.map((course) => course.id)).toEqual([a.id, c.id, b.id])
      expect(result.every((course) => course.groupId === group.id)).toBe(true)
      // sort_order is renumbered 0..n.
      expect(result.map((course) => course.sortOrder)).toEqual([0, 1, 2])
    })

    test('appends to the end of the target group block when beforeCourseId is null', () => {
      // Arrange — A joins the (empty) group first, which moves it to the end
      // of the list: [ungrouped: B, C] [grouped: A].
      const group = groups.create({ name: '1학기' })
      const a = courses.create({ name: 'A', color: '#000' })
      const b = courses.create({ name: 'B', color: '#000' })
      const c = courses.create({ name: 'C', color: '#000' })
      courses.organize({ courseId: a.id, groupId: group.id, beforeCourseId: null })

      // Act — C joins the group; it must land right after A (end of the
      // group's block), not before the ungrouped B.
      const result = courses.organize({
        courseId: c.id,
        groupId: group.id,
        beforeCourseId: null
      })

      // Assert
      expect(result.map((course) => course.id)).toEqual([b.id, a.id, c.id])
      expect(result.find((course) => course.id === c.id)?.groupId).toBe(group.id)
      expect(result.find((course) => course.id === b.id)?.groupId).toBeNull()
    })

    test('rejects a beforeCourseId that belongs to a different group', () => {
      // Arrange
      const group = groups.create({ name: '1학기' })
      const other = groups.create({ name: '2학기' })
      const a = courses.create({ name: 'A', color: '#000' })
      const b = courses.create({ name: 'B', color: '#000' })
      courses.organize({ courseId: a.id, groupId: group.id, beforeCourseId: null })

      // Act / Assert — drop point must be inside the target group's block.
      expect(() =>
        courses.organize({ courseId: b.id, groupId: other.id, beforeCourseId: a.id })
      ).toThrow(ValidationError)
      // Nothing changed.
      expect(courses.getById(b.id).groupId).toBeNull()
    })

    test('ungroups via groupId null and rejects unknown targets', () => {
      // Arrange
      const group = groups.create({ name: '1학기' })
      const a = courses.create({ name: 'A', color: '#000' })
      courses.organize({ courseId: a.id, groupId: group.id, beforeCourseId: null })

      // Act
      const result = courses.organize({
        courseId: a.id,
        groupId: null,
        beforeCourseId: null
      })

      // Assert
      expect(result.find((course) => course.id === a.id)?.groupId).toBeNull()
      expect(() =>
        courses.organize({ courseId: a.id, groupId: 'ghost', beforeCourseId: null })
      ).toThrow(NotFoundError)
      expect(() =>
        courses.organize({ courseId: 'ghost', groupId: null, beforeCourseId: null })
      ).toThrow(NotFoundError)
      expect(() =>
        courses.organize({ courseId: a.id, groupId: null, beforeCourseId: a.id })
      ).toThrow(ValidationError)
    })

    test('keeps archived courses in the renumbered order without returning them', () => {
      // Arrange — B is archived and must keep its relative slot in sort_order.
      const a = courses.create({ name: 'A', color: '#000' })
      const b = courses.create({ name: 'B', color: '#000' })
      const c = courses.create({ name: 'C', color: '#000' })
      courses.archive({ courseId: b.id, archived: true })

      // Act — move C before A (both ungrouped).
      const result = courses.organize({
        courseId: c.id,
        groupId: null,
        beforeCourseId: a.id
      })

      // Assert — the returned list excludes archived rows...
      expect(result.map((course) => course.id)).toEqual([c.id, a.id])
      // ...but the archived row still holds a unique renumbered slot.
      const orders = ctx.db
        .prepare(
          `SELECT id, sort_order FROM courses
           WHERE deleted_at IS NULL ORDER BY sort_order ASC`
        )
        .all() as { id: string; sort_order: number }[]
      expect(orders.map((row) => row.id)).toEqual([c.id, a.id, b.id])
      expect(orders.map((row) => row.sort_order)).toEqual([0, 1, 2])
    })
  })
})
