import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createLayoutRepo, type LayoutRepo } from '../../src/main/db/layoutRepo'
import { createCoursesRepo } from '../../src/main/features/courses'
import { ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('layoutRepo', () => {
  let ctx: TestDb
  let repo: LayoutRepo
  let courseId: string

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: 'Course', color: '#000' }).id
    repo = createLayoutRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('returns null for a course with no saved layout', () => {
    // Act / Assert
    expect(repo.get(courseId)).toEqual({ layout: null })
  })

  test('round-trips a layout object and overwrites on re-save', () => {
    // Arrange
    const layoutV1 = { grid: { panels: ['a'] } }
    const layoutV2 = { grid: { panels: ['a', 'b'] } }

    // Act
    repo.save(courseId, layoutV1)
    repo.save(courseId, layoutV2)

    // Assert
    expect(repo.get(courseId)).toEqual({ layout: layoutV2 })
  })

  test('rejects saving a layout for an unknown course', () => {
    // Act / Assert
    expect(() => repo.save('ghost', {})).toThrow(ValidationError)
  })
})
