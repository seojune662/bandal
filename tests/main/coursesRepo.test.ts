import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCoursesRepo, slugify, type CoursesRepo } from '../../src/main/features/courses'
import { NotFoundError, ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('coursesRepo', () => {
  let ctx: TestDb
  let repo: CoursesRepo
  let dataRoot: string

  beforeEach(() => {
    ctx = createTestDb()
    dataRoot = join(ctx.dir, 'Bandal')
    repo = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('create', () => {
    test('creates a row and the course folder under dataRoot/<slug>', () => {
      // Act
      const course = repo.create({ name: 'Operating Systems', color: '#ff8800' })

      // Assert
      expect(course.slug).toBe('operating-systems')
      expect(course.folderPath).toBe(join(dataRoot, 'operating-systems'))
      expect(existsSync(course.folderPath)).toBe(true)
      expect(repo.getById(course.id).name).toBe('Operating Systems')
    })

    test('keeps Hangul course names in the slug', () => {
      // Act
      const course = repo.create({ name: '자료구조 및 실습', color: '#00f' })

      // Assert
      expect(course.slug).toBe('자료구조-및-실습')
      expect(existsSync(course.folderPath)).toBe(true)
    })

    test('appends a numeric suffix when the slug collides', () => {
      // Arrange
      repo.create({ name: 'Algorithms', color: '#111' })

      // Act
      const second = repo.create({ name: 'Algorithms', color: '#222' })

      // Assert
      expect(second.slug).toBe('algorithms-2')
      expect(existsSync(join(dataRoot, 'algorithms-2'))).toBe(true)
    })

    test('falls back to "course" when the name has no safe characters', () => {
      // Act
      const course = repo.create({ name: '???', color: '#000' })

      // Assert
      expect(course.slug).toBe('course')
    })

    test('rejects an empty name', () => {
      // Act / Assert
      expect(() => repo.create({ name: '   ', color: '#000' })).toThrow(ValidationError)
    })
  })

  describe('list', () => {
    test('excludes soft-deleted courses', () => {
      // Arrange
      const keep = repo.create({ name: 'Keep', color: '#000' })
      const gone = repo.create({ name: 'Gone', color: '#000' })

      // Act
      repo.softDelete({ courseId: gone.id })

      // Assert
      expect(repo.list().map((c) => c.id)).toEqual([keep.id])
    })

    test('excludes archived courses unless includeArchived is set', () => {
      // Arrange
      const live = repo.create({ name: 'Live', color: '#000' })
      const archived = repo.create({ name: 'Old', color: '#000' })
      repo.archive({ courseId: archived.id, archived: true })

      // Act / Assert
      expect(repo.list().map((c) => c.id)).toEqual([live.id])
      expect(repo.list({ includeArchived: true }).map((c) => c.id)).toEqual([
        live.id,
        archived.id
      ])
    })
  })

  describe('rename', () => {
    test('changes the name but keeps slug and folder stable', () => {
      // Arrange
      const course = repo.create({ name: 'Databases', color: '#000' })

      // Act
      const renamed = repo.rename({ courseId: course.id, name: 'Databases II' })

      // Assert
      expect(renamed.name).toBe('Databases II')
      expect(renamed.slug).toBe(course.slug)
      expect(renamed.folderPath).toBe(course.folderPath)
    })
  })

  describe('softDelete', () => {
    test('leaves the folder on disk untouched', () => {
      // Arrange
      const course = repo.create({ name: 'Compilers', color: '#000' })

      // Act
      repo.softDelete({ courseId: course.id })

      // Assert
      expect(existsSync(course.folderPath)).toBe(true)
      expect(() => repo.getById(course.id)).toThrow(NotFoundError)
    })

    test('throws NotFoundError for an unknown id', () => {
      // Act / Assert
      expect(() => repo.softDelete({ courseId: 'nope' })).toThrow(NotFoundError)
    })
  })
})

describe('slugify', () => {
  test('lowercases, hyphenates whitespace and strips unsafe characters', () => {
    // Act / Assert
    expect(slugify('  Intro to  CS: Part 1! ')).toBe('intro-to-cs-part-1')
  })
})
