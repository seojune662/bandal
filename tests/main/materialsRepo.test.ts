import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createMaterialsRepo,
  kindForFile,
  MATERIAL_INDEX_STATE_REL_PATH,
  MATERIAL_SCAN_MAX_DEPTH,
  MATERIAL_SCAN_MAX_ENTRIES,
  MATERIAL_TREE_TRUNCATION_REL_PATH,
  type MaterialsScanLimits,
  type MaterialsRepo
} from '../../src/main/features/materials'
import {
  ConflictError,
  NotFoundError,
  PathTraversalError,
  ValidationError
} from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'
import { createCoursesRepo } from '../../src/main/features/courses'

describe('materialsRepo', () => {
  let ctx: TestDb
  let repo: MaterialsRepo
  let courseId: string
  let courseFolder: string
  let revealed: string[]
  let trashed: string[]

  function limitedRepo(scanLimits: MaterialsScanLimits): MaterialsRepo {
    return createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => courseFolder,
      revealItem: () => undefined,
      trashItem: async () => undefined,
      scanLimits
    })
  }

  function flattenTree(nodes: ReturnType<MaterialsRepo['tree']>): string[] {
    return nodes.flatMap((node) => [
      node.relPath,
      ...(node.kind === 'dir' ? flattenTree(node.children ?? []) : [])
    ])
  }

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
    trashed = []
    repo = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: (id) => courses.getFolder(id),
      revealItem: (absPath) => revealed.push(absPath),
      trashItem: async (absPath) => {
        trashed.push(absPath)
      }
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

    test('stops descending at the depth limit and adds a visible warning node', () => {
      expect(MATERIAL_SCAN_MAX_DEPTH).toBe(12)
      mkdirSync(join(courseFolder, 'a', 'b', 'c', 'd'), { recursive: true })
      writeFileSync(join(courseFolder, 'a', 'b', 'c', 'd', 'too-deep.pdf'), 'pdf')

      const tree = limitedRepo({ maxDepth: 2, maxEntries: 100 }).tree(courseId)
      const paths = flattenTree(tree)

      expect(paths).toContain('a/b/c')
      expect(paths).not.toContain('a/b/c/d')
      expect(paths).not.toContain('a/b/c/d/too-deep.pdf')
      expect(paths).toContain(MATERIAL_TREE_TRUNCATION_REL_PATH)
      expect(
        tree.find((node) => node.relPath === MATERIAL_TREE_TRUNCATION_REL_PATH)
          ?.name
      ).toContain('일부 자료만 표시됨')
    })

    test('stops at the entry limit and persists the truncation signal', () => {
      expect(MATERIAL_SCAN_MAX_ENTRIES).toBe(20_000)

      const tree = limitedRepo({ maxDepth: 12, maxEntries: 3 }).tree(courseId)
      const paths = flattenTree(tree)
      const returnedEntries = paths.filter(
        (path) => path !== MATERIAL_TREE_TRUNCATION_REL_PATH
      )
      const state = ctx.db
        .prepare(
          `SELECT size FROM materials_index
           WHERE course_id = ? AND rel_path = ?`
        )
        .get(courseId, MATERIAL_INDEX_STATE_REL_PATH) as { size: number }

      expect(returnedEntries.length).toBeLessThanOrEqual(3)
      expect(paths).toContain(MATERIAL_TREE_TRUNCATION_REL_PATH)
      expect(state.size).not.toBe(0)
    })
  })

  describe('tree cache', () => {
    test('serves repeat calls from cache until invalidateTree', () => {
      // Arrange — warm the cache, then change the disk out-of-band.
      repo.tree(courseId)
      writeFileSync(join(courseFolder, 'out-of-band.pdf'), 'x')

      // Act / Assert — cache hit: no rescan, so the new file is invisible.
      expect(flattenTree(repo.tree(courseId))).not.toContain('out-of-band.pdf')

      // Invalidate (프로덕션에서는 watcher 가 해 준다) → next call rescans.
      repo.invalidateTree(courseId)
      expect(flattenTree(repo.tree(courseId))).toContain('out-of-band.pdf')
    })

    test('every tree-changing repo mutation invalidates the cache itself', () => {
      repo.tree(courseId)
      repo.createFolder({ courseId, dirRelPath: '', name: 'week-2' })
      expect(flattenTree(repo.tree(courseId))).toContain('week-2')

      repo.tree(courseId)
      repo.writeFile({
        courseId,
        dirRelPath: '',
        fileName: 'clip.md',
        encoding: 'utf8',
        data: 'x'
      })
      expect(flattenTree(repo.tree(courseId))).toContain('clip.md')

      repo.tree(courseId)
      repo.rename({ courseId, relPath: 'syllabus.pdf', newName: 'outline.pdf' })
      expect(flattenTree(repo.tree(courseId))).toContain('outline.pdf')

      repo.tree(courseId)
      repo.duplicate({ courseId, relPath: 'outline.pdf' })
      expect(flattenTree(repo.tree(courseId))).toContain('outline-2.pdf')

      repo.tree(courseId)
      repo.move({ courseId, fromRelPath: 'outline.pdf', toDirRelPath: 'notes' })
      expect(flattenTree(repo.tree(courseId))).toContain('notes/outline.pdf')

      const source = join(ctx.dir, 'imported.pdf')
      writeFileSync(source, 'x')
      repo.tree(courseId)
      repo.import(courseId, [source])
      expect(flattenTree(repo.tree(courseId))).toContain('imported.pdf')
    })

    test('softDelete invalidates even though trashing is delegated to the OS', async () => {
      // The fake trash moves nothing, so prove the rescan happened via a file
      // written out-of-band while the cache was warm.
      repo.tree(courseId)
      writeFileSync(join(courseFolder, 'ghost.md'), 'x')
      expect(flattenTree(repo.tree(courseId))).not.toContain('ghost.md')

      await repo.softDelete({ courseId, relPath: 'syllabus.pdf' })

      expect(flattenTree(repo.tree(courseId))).toContain('ghost.md')
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

    test('rebuilds the index after invalidateTree so out-of-band files are found', () => {
      // Arrange — the first search builds and caches the index; a file added
      // behind the repo's back (프로덕션에서는 watcher 가 invalidate 해 준다)
      // needs an explicit invalidation before it becomes searchable.
      repo.search(courseId, 'week') // builds index + cache
      writeFileSync(join(courseFolder, 'week2-added-later.md'), 'x')
      repo.invalidateTree(courseId)

      // Act
      const hits = repo.search(courseId, 'week2')

      // Assert
      expect(hits.map((h) => h.relPath)).toEqual(['week2-added-later.md'])
    })

    test('reuses the cached scan between keystrokes (no rescan per call)', () => {
      // Arrange — warm the cache, then change the disk out-of-band.
      repo.search(courseId, 'week')
      writeFileSync(join(courseFolder, 'hidden-from-cache.md'), 'x')

      // Act / Assert — cache hit: the out-of-band file is not rescanned in.
      expect(repo.search(courseId, 'hidden-from-cache')).toEqual([])
      // Existing files keep matching from the cached index.
      expect(repo.search(courseId, 'week').map((h) => h.relPath)).toEqual([
        'notes/week1.md'
      ])
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

    test('imports into a subfolder when dirRelPath is given, prefixing relPaths', () => {
      // Arrange
      const source = join(ctx.dir, 'external.pdf')
      writeFileSync(source, 'external')
      writeFileSync(join(courseFolder, 'notes', 'external.pdf'), 'already-there')

      // Act — collision renaming happens inside the target folder.
      const result = repo.import(courseId, [source], 'notes')

      // Assert
      expect(result.failed).toHaveLength(0)
      expect(result.imported).toEqual(['notes/external (2).pdf'])
      expect(existsSync(join(courseFolder, 'notes', 'external (2).pdf'))).toBe(true)
    })

    test('rejects a dirRelPath that is missing or escapes the course folder', () => {
      // Arrange
      const source = join(ctx.dir, 'external.pdf')
      writeFileSync(source, 'external')

      // Act / Assert
      expect(() => repo.import(courseId, [source], 'ghost-folder')).toThrow(
        NotFoundError
      )
      expect(() => repo.import(courseId, [source], '../outside')).toThrow(
        PathTraversalError
      )
    })
  })

  describe('move', () => {
    test('moves a root file into a folder and back, returning posix relPaths', () => {
      // Act — root → folder.
      expect(
        repo.move({ courseId, fromRelPath: 'syllabus.pdf', toDirRelPath: 'notes' })
      ).toEqual({ relPath: 'notes/syllabus.pdf' })
      expect(existsSync(join(courseFolder, 'notes', 'syllabus.pdf'))).toBe(true)
      expect(existsSync(join(courseFolder, 'syllabus.pdf'))).toBe(false)

      // Act — folder → root ('' = course root).
      expect(
        repo.move({
          courseId,
          fromRelPath: 'notes/syllabus.pdf',
          toDirRelPath: ''
        })
      ).toEqual({ relPath: 'syllabus.pdf' })
      expect(existsSync(join(courseFolder, 'syllabus.pdf'))).toBe(true)
    })

    test('auto-renames on collision with the import (n) convention', () => {
      // Arrange
      writeFileSync(join(courseFolder, 'notes', 'syllabus.pdf'), 'occupied')

      // Act
      const result = repo.move({
        courseId,
        fromRelPath: 'syllabus.pdf',
        toDirRelPath: 'notes'
      })

      // Assert — the occupant is untouched, the mover gets the (2) suffix.
      expect(result).toEqual({ relPath: 'notes/syllabus (2).pdf' })
      expect(readFileSync(join(courseFolder, 'notes', 'syllabus.pdf'), 'utf8')).toBe(
        'occupied'
      )
      expect(
        readFileSync(join(courseFolder, 'notes', 'syllabus (2).pdf'), 'utf8')
      ).toBe('pdf-bytes')
    })

    test('is a no-op when the destination equals the current parent', () => {
      // Act — same parent, even with a same-named sibling: nothing is renamed.
      expect(
        repo.move({
          courseId,
          fromRelPath: 'notes/week1.md',
          toDirRelPath: 'notes'
        })
      ).toEqual({ relPath: 'notes/week1.md' })
      expect(existsSync(join(courseFolder, 'notes', 'week1.md'))).toBe(true)
      expect(existsSync(join(courseFolder, 'notes', 'week1 (2).md'))).toBe(false)
    })

    test('rejects moving a folder into itself or a descendant', () => {
      // Act / Assert
      expect(() =>
        repo.move({ courseId, fromRelPath: 'notes', toDirRelPath: 'notes' })
      ).toThrow(ValidationError)
      expect(() =>
        repo.move({ courseId, fromRelPath: 'notes', toDirRelPath: 'notes/img' })
      ).toThrow(ValidationError)
      // The tree is untouched.
      expect(existsSync(join(courseFolder, 'notes', 'img', 'diagram.png'))).toBe(true)
    })

    test('rejects traversal on either side and unknown destinations', () => {
      // Act / Assert
      expect(() =>
        repo.move({ courseId, fromRelPath: '../outside.pdf', toDirRelPath: '' })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.move({ courseId, fromRelPath: 'syllabus.pdf', toDirRelPath: '../out' })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.move({ courseId, fromRelPath: 'syllabus.pdf', toDirRelPath: 'ghost' })
      ).toThrow(NotFoundError)
      expect(() =>
        repo.move({ courseId, fromRelPath: 'ghost.pdf', toDirRelPath: 'notes' })
      ).toThrow(NotFoundError)
      expect(existsSync(join(courseFolder, 'syllabus.pdf'))).toBe(true)
    })

    test('moves directories with their contents', () => {
      // Arrange
      mkdirSync(join(courseFolder, 'archive'))

      // Act
      expect(
        repo.move({ courseId, fromRelPath: 'notes/img', toDirRelPath: 'archive' })
      ).toEqual({ relPath: 'archive/img' })

      // Assert
      expect(
        existsSync(join(courseFolder, 'archive', 'img', 'diagram.png'))
      ).toBe(true)
      expect(existsSync(join(courseFolder, 'notes', 'img'))).toBe(false)
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

  describe('rename', () => {
    test('renames files and folders and returns a course-relative path', () => {
      expect(
        repo.rename({
          courseId,
          relPath: 'syllabus.pdf',
          newName: 'course-outline.pdf'
        })
      ).toEqual({ relPath: 'course-outline.pdf' })
      expect(existsSync(join(courseFolder, 'course-outline.pdf'))).toBe(true)

      expect(
        repo.rename({ courseId, relPath: 'notes/img', newName: 'figures' })
      ).toEqual({ relPath: 'notes/figures' })
      expect(existsSync(join(courseFolder, 'notes', 'figures', 'diagram.png'))).toBe(
        true
      )
    })

    test('rejects collisions and basename path separators', () => {
      writeFileSync(join(courseFolder, 'already.pdf'), 'occupied')

      expect(() =>
        repo.rename({
          courseId,
          relPath: 'syllabus.pdf',
          newName: 'already.pdf'
        })
      ).toThrow(ConflictError)
      expect(() =>
        repo.rename({
          courseId,
          relPath: 'syllabus.pdf',
          newName: '../escaped.pdf'
        })
      ).toThrow(ValidationError)
      expect(() =>
        repo.rename({
          courseId,
          relPath: 'syllabus.pdf',
          newName: 'sub\\escaped.pdf'
        })
      ).toThrow(ValidationError)
    })
  })

  describe('softDelete', () => {
    test('delegates files and directories to the OS trash without unlinking', async () => {
      await expect(
        repo.softDelete({ courseId, relPath: 'syllabus.pdf' })
      ).resolves.toEqual({ ok: true })
      await expect(
        repo.softDelete({ courseId, relPath: 'notes/img' })
      ).resolves.toEqual({ ok: true })

      expect(trashed).toEqual([
        join(courseFolder, 'syllabus.pdf'),
        join(courseFolder, 'notes', 'img')
      ])
      // The fake trash implementation deliberately does not move anything;
      // this proves the repo itself never calls unlink/rm.
      expect(existsSync(join(courseFolder, 'syllabus.pdf'))).toBe(true)
      expect(existsSync(join(courseFolder, 'notes', 'img'))).toBe(true)
    })
  })

  describe('duplicate', () => {
    test('uses -2/-3 collision names and recursively copies directories', () => {
      expect(repo.duplicate({ courseId, relPath: 'syllabus.pdf' })).toEqual({
        relPath: 'syllabus-2.pdf'
      })
      expect(repo.duplicate({ courseId, relPath: 'syllabus.pdf' })).toEqual({
        relPath: 'syllabus-3.pdf'
      })
      expect(readFileSync(join(courseFolder, 'syllabus-2.pdf'), 'utf8')).toBe(
        'pdf-bytes'
      )

      expect(repo.duplicate({ courseId, relPath: 'notes/img' })).toEqual({
        relPath: 'notes/img-2'
      })
      expect(readFileSync(join(courseFolder, 'notes', 'img-2', 'diagram.png'), 'utf8')).toBe(
        'png-bytes'
      )
    })
  })

  describe('createFolder', () => {
    test('creates a folder under a validated course-relative directory', () => {
      expect(
        repo.createFolder({
          courseId,
          dirRelPath: 'notes',
          name: 'week-2'
        })
      ).toEqual({ relPath: 'notes/week-2' })
      expect(existsSync(join(courseFolder, 'notes', 'week-2'))).toBe(true)
    })

    test('rejects a name collision', () => {
      expect(() =>
        repo.createFolder({ courseId, dirRelPath: '', name: 'notes' })
      ).toThrow(ConflictError)
    })
  })

  describe('writeFile', () => {
    test('writes utf8 and base64 data under a validated directory', () => {
      expect(
        repo.writeFile({
          courseId,
          dirRelPath: 'notes',
          fileName: '붙여넣은 텍스트.md',
          encoding: 'utf8',
          data: '# 클립보드\n'
        })
      ).toEqual({ relPath: 'notes/붙여넣은 텍스트.md' })
      expect(
        readFileSync(join(courseFolder, 'notes', '붙여넣은 텍스트.md'), 'utf8')
      ).toBe('# 클립보드\n')

      expect(
        repo.writeFile({
          courseId,
          dirRelPath: '',
          fileName: 'clipboard.png',
          encoding: 'base64',
          data: Buffer.from('image-bytes').toString('base64')
        })
      ).toEqual({ relPath: 'clipboard.png' })
      expect(readFileSync(join(courseFolder, 'clipboard.png')).toString()).toBe(
        'image-bytes'
      )
    })

    test('never overwrites and shares duplicate -2/-3 collision names', () => {
      writeFileSync(join(courseFolder, 'capture.png'), 'original')

      expect(
        repo.writeFile({
          courseId,
          dirRelPath: '',
          fileName: 'capture.png',
          encoding: 'utf8',
          data: 'second'
        })
      ).toEqual({ relPath: 'capture-2.png' })
      expect(
        repo.writeFile({
          courseId,
          dirRelPath: '',
          fileName: 'capture.png',
          encoding: 'utf8',
          data: 'third'
        })
      ).toEqual({ relPath: 'capture-3.png' })
      expect(readFileSync(join(courseFolder, 'capture.png'), 'utf8')).toBe('original')
    })

    test('rejects traversal and non-basename file names before writing', () => {
      expect(() =>
        repo.writeFile({
          courseId,
          dirRelPath: '../outside',
          fileName: 'safe.md',
          encoding: 'utf8',
          data: 'nope'
        })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.writeFile({
          courseId,
          dirRelPath: '',
          fileName: '../outside.md',
          encoding: 'utf8',
          data: 'nope'
        })
      ).toThrow(ValidationError)
      expect(existsSync(join(ctx.dir, 'outside.md'))).toBe(false)
    })

    test('rejects payloads larger than 50MB before writing', () => {
      const tooLarge = 'x'.repeat(50 * 1024 * 1024 + 1)
      expect(() =>
        repo.writeFile({
          courseId,
          dirRelPath: '',
          fileName: 'too-large.md',
          encoding: 'utf8',
          data: tooLarge
        })
      ).toThrow(/too large.*maximum/i)
      expect(existsSync(join(courseFolder, 'too-large.md'))).toBe(false)
    })
  })

  describe('mutation path validation', () => {
    test('rejects traversal, absolute paths, and null bytes before mutations', async () => {
      expect(() =>
        repo.rename({ courseId, relPath: '../outside', newName: 'safe' })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.duplicate({ courseId, relPath: '/tmp/outside' })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.createFolder({ courseId, dirRelPath: '../outside', name: 'safe' })
      ).toThrow(PathTraversalError)
      await expect(
        repo.softDelete({ courseId, relPath: 'notes/\u0000outside' })
      ).rejects.toThrow(PathTraversalError)
      expect(trashed).toEqual([])
    })
  })
})

/**
 * [M7] A linked course points at an arbitrary folder outside the data root.
 * Everything must scope to that folder — including the traversal guard.
 */
describe('materialsRepo (linked course folder)', () => {
  let ctx: TestDb
  let repo: MaterialsRepo
  let courseId: string
  let linkedFolder: string

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
    // The linked folder lives in `outside/`, nowhere near the data root, and
    // has a sibling file the course must never be able to reach.
    linkedFolder = join(ctx.dir, 'outside', 'lecture-notes')
    mkdirSync(linkedFolder, { recursive: true })
    writeFileSync(join(ctx.dir, 'outside', 'secret.md'), 'nope')
    writeFileSync(join(linkedFolder, 'week1.pdf'), 'pdf')
    mkdirSync(join(linkedFolder, 'sub'), { recursive: true })
    writeFileSync(join(linkedFolder, 'sub', 'week2.md'), '# w2')

    const created = courses.addFromFolder({ folderPath: linkedFolder, color: '#000' })
    if (created.status !== 'ok') throw new Error('setup failed')
    courseId = created.course.id
    repo = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: (id) => courses.getFolder(id),
      revealItem: () => undefined,
      trashItem: async () => undefined
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('walks the linked folder', () => {
    // Act
    const tree = repo.tree(courseId)

    // Assert
    expect(tree.map((n) => n.relPath)).toEqual(['sub', 'week1.pdf'])
  })

  test('searches inside the linked folder', () => {
    // Act
    const hits = repo.search(courseId, 'week')

    // Assert
    expect(hits.map((h) => h.relPath).sort()).toEqual(['sub/week2.md', 'week1.pdf'])
    // The sibling outside the course folder is not indexed.
    expect(repo.search(courseId, 'secret')).toEqual([])
  })

  test('reads a file from the linked folder', () => {
    // Act / Assert
    expect(repo.readFile(courseId, 'sub/week2.md')).toEqual({
      encoding: 'utf8',
      data: '# w2'
    })
  })

  test('scopes the traversal guard to the linked folder, not the data root', () => {
    // Act / Assert
    expect(() => repo.readFile(courseId, '../secret.md')).toThrow(PathTraversalError)
    expect(() => repo.reveal(courseId, '../secret.md')).toThrow(PathTraversalError)
  })

  test('imports into the linked folder', () => {
    // Arrange
    const source = join(ctx.dir, 'drop.pdf')
    writeFileSync(source, 'bytes')

    // Act
    const result = repo.import(courseId, [source])

    // Assert
    expect(result.imported).toEqual(['drop.pdf'])
    expect(existsSync(join(linkedFolder, 'drop.pdf'))).toBe(true)
  })

  test('returns an empty tree once the linked folder disappears', () => {
    // Arrange — warm the cache first: a missing folder must beat a stale cache.
    expect(repo.tree(courseId)).not.toEqual([])
    rmSync(linkedFolder, { recursive: true, force: true })

    // Act / Assert
    expect(repo.tree(courseId)).toEqual([])
    expect(repo.search(courseId, 'week')).toEqual([])
  })

  test('refuses to import into a folder that disappeared', () => {
    // Arrange
    const source = join(ctx.dir, 'drop.pdf')
    writeFileSync(source, 'bytes')
    rmSync(linkedFolder, { recursive: true, force: true })

    // Act / Assert — importing must not silently re-create the stale folder.
    expect(() => repo.import(courseId, [source])).toThrow(NotFoundError)
    expect(existsSync(linkedFolder)).toBe(false)
  })
})

describe('kindForFile', () => {
  test('maps extensions to material kinds', () => {
    // Act / Assert
    expect(kindForFile('a.PDF')).toBe('pdf')
    expect(kindForFile('a.md')).toBe('note')
    expect(kindForFile('a.jpeg')).toBe('image')
    expect(kindForFile('a.mp4')).toBe('video')
    expect(kindForFile('a.M4V')).toBe('video')
    expect(kindForFile('a.webm')).toBe('video')
    expect(kindForFile('a.pptx')).toBe('other')
  })
})
