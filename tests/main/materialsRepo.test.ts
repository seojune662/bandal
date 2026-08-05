import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createMaterialsRepo,
  kindForFile,
  type MaterialsRepo
} from '../../src/main/features/materials'
import { PathTraversalError, ValidationError } from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'
import { createCoursesRepo } from '../../src/main/features/courses'

describe('materialsRepo', () => {
  let ctx: TestDb
  let repo: MaterialsRepo
  let courseId: string
  let courseFolder: string
  let revealed: string[]

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
    const course = courses.create({ name: 'OS', color: '#000' })
    courseId = course.id
    courseFolder = course.folderPath
    revealed = []
    repo = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: (id) => courses.getFolder(id),
      revealItem: (absPath) => revealed.push(absPath)
    })

    // Fixture tree:
    //   syllabus.pdf
    //   notes/week1.md
    //   notes/img/diagram.png
    mkdirSync(join(courseFolder, 'notes', 'img'), { recursive: true })
    writeFileSync(join(courseFolder, 'syllabus.pdf'), 'pdf-bytes')
    writeFileSync(join(courseFolder, 'notes', 'week1.md'), '# w1')
    writeFileSync(join(courseFolder, 'notes', 'img', 'diagram.png'), 'png-bytes')
    writeFileSync(join(courseFolder, '.DS_Store'), 'junk')
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('tree', () => {
    test('mirrors the folder structure with dirs first and hidden files skipped', () => {
      // Act
      const tree = repo.tree(courseId)

      // Assert
      expect(tree.map((n) => n.relPath)).toEqual(['notes', 'syllabus.pdf'])
      const notes = tree[0]
      expect(notes?.kind).toBe('dir')
      expect(notes?.children?.map((n) => n.relPath)).toEqual([
        'notes/img',
        'notes/week1.md'
      ])
      const pdf = tree[1]
      expect(pdf?.kind).toBe('pdf')
      expect(pdf?.size).toBeGreaterThan(0)
      expect(pdf?.mtime).toBeGreaterThan(0)
    })
  })

  describe('search', () => {
    test('finds files by case-insensitive substring over rel paths', () => {
      // Act
      const hits = repo.search(courseId, 'WEEK')

      // Assert
      expect(hits).toHaveLength(1)
      expect(hits[0]?.relPath).toBe('notes/week1.md')
      expect(hits[0]?.kind).toBe('note')
    })

    test('ranks file-name matches above path-only matches', () => {
      // Arrange: "notes" appears in the dir path of week1.md/diagram.png and
      // in the file name of notes-summary.md.
      writeFileSync(join(courseFolder, 'notes-summary.md'), 'x')

      // Act
      const hits = repo.search(courseId, 'notes')

      // Assert
      expect(hits[0]?.relPath).toBe('notes-summary.md')
      expect(hits.map((h) => h.relPath)).toContain('notes/week1.md')
    })

    test('rebuilds the index on demand so new files are found', () => {
      // Arrange
      repo.search(courseId, 'week') // builds index
      writeFileSync(join(courseFolder, 'week2-added-later.md'), 'x')

      // Act
      const hits = repo.search(courseId, 'week2')

      // Assert
      expect(hits.map((h) => h.relPath)).toEqual(['week2-added-later.md'])
    })

    test('rejects an empty query', () => {
      // Act / Assert
      expect(() => repo.search(courseId, '  ')).toThrow(ValidationError)
    })
  })

  describe('import', () => {
    test('copies absolute paths into the course folder, renaming collisions', () => {
      // Arrange
      const source = join(ctx.dir, 'external.pdf')
      writeFileSync(source, 'external')
      writeFileSync(join(courseFolder, 'external.pdf'), 'already-there')

      // Act
      const result = repo.import(courseId, [source])

      // Assert
      expect(result.failed).toHaveLength(0)
      expect(result.imported).toEqual(['external (2).pdf'])
    })

    test('reports missing and relative source paths as failed, not thrown', () => {
      // Act
      const result = repo.import(courseId, ['relative.pdf', join(ctx.dir, 'ghost.pdf')])

      // Assert
      expect(result.imported).toHaveLength(0)
      expect(result.failed).toHaveLength(2)
      expect(result.failed[0]?.reason).toContain('absolute')
    })
  })

  describe('readFile', () => {
    test('returns utf8 for text files and base64 for binaries', () => {
      // Act
      const md = repo.readFile(courseId, 'notes/week1.md')
      const png = repo.readFile(courseId, 'notes/img/diagram.png')

      // Assert
      expect(md).toEqual({ encoding: 'utf8', data: '# w1' })
      expect(png.encoding).toBe('base64')
      expect(Buffer.from(png.data, 'base64').toString()).toBe('png-bytes')
    })

    test('rejects path traversal', () => {
      // Act / Assert
      expect(() => repo.readFile(courseId, '../outside.txt')).toThrow(PathTraversalError)
    })
  })

  describe('reveal', () => {
    test('calls the injected reveal function with the absolute path', () => {
      // Act
      repo.reveal(courseId, 'syllabus.pdf')

      // Assert
      expect(revealed).toEqual([join(courseFolder, 'syllabus.pdf')])
    })
  })
})

describe('kindForFile', () => {
  test('maps extensions to material kinds', () => {
    // Act / Assert
    expect(kindForFile('a.PDF')).toBe('pdf')
    expect(kindForFile('a.md')).toBe('note')
    expect(kindForFile('a.jpeg')).toBe('image')
    expect(kindForFile('a.pptx')).toBe('other')
  })
})
