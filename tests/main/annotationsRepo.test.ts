import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createAnnotationsRepo,
  type AnnotationsRepo
} from '../../src/main/features/annotations'
import { createCoursesRepo } from '../../src/main/features/courses'
import { NotFoundError, ValidationError } from '../../src/main/db/errors'
import type { CreateAnnotationInput } from '../../src/shared/types/annotation'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('annotationsRepo', () => {
  let ctx: TestDb
  let repo: AnnotationsRepo
  let courseId: string

  function validInput(): CreateAnnotationInput {
    return {
      courseId,
      relPath: 'slides/week1.pdf',
      page: 3,
      color: 'yellow',
      rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }],
      anchor: { quote: 'the quote', prefix: 'before ', suffix: ' after' }
    }
  }

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: 'PDF Course', color: '#000' }).id
    repo = createAnnotationsRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('create persists an annotation and round-trips rects and anchor', () => {
    // Act
    const created = repo.create(validInput())
    const listed = repo.listForFile({ courseId, relPath: 'slides/week1.pdf' })

    // Assert
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(created)
    expect(listed[0]?.rects[0]?.width).toBeCloseTo(0.5)
    expect(listed[0]?.anchor.quote).toBe('the quote')
  })

  test('create rejects an unknown course', () => {
    // Act / Assert
    expect(() => repo.create({ ...validInput(), courseId: 'ghost' })).toThrow(
      NotFoundError
    )
  })

  test('create rejects an invalid color and empty rects', () => {
    // Act / Assert
    expect(() =>
      repo.create({ ...validInput(), color: 'purple' as never })
    ).toThrow(ValidationError)
    expect(() => repo.create({ ...validInput(), rects: [] })).toThrow(ValidationError)
  })

  test('create rejects a page below 1', () => {
    // Act / Assert
    expect(() => repo.create({ ...validInput(), page: 0 })).toThrow(ValidationError)
  })

  test('update changes color and comment, keeping other fields', () => {
    // Arrange
    const created = repo.create(validInput())

    // Act
    const updated = repo.update({ id: created.id, color: 'blue', comment: 'revisit' })

    // Assert
    expect(updated.color).toBe('blue')
    expect(updated.comment).toBe('revisit')
    expect(updated.page).toBe(created.page)
    expect(updated.rects).toEqual(created.rects)
  })

  test('listForFile only returns annotations for that file', () => {
    // Arrange
    repo.create(validInput())
    repo.create({ ...validInput(), relPath: 'slides/week2.pdf' })

    // Act
    const listed = repo.listForFile({ courseId, relPath: 'slides/week2.pdf' })

    // Assert
    expect(listed).toHaveLength(1)
    expect(listed[0]?.relPath).toBe('slides/week2.pdf')
  })

  test('softDelete hides the annotation from listings and later updates', () => {
    // Arrange
    const created = repo.create(validInput())

    // Act
    repo.softDelete({ id: created.id })

    // Assert
    expect(repo.listForFile({ courseId, relPath: 'slides/week1.pdf' })).toHaveLength(0)
    expect(() => repo.update({ id: created.id, comment: 'x' })).toThrow(NotFoundError)
  })
})
