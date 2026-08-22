import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNotesRepo, type NotesRepo } from '../../src/main/features/notes'
import {
  ConflictError,
  NotFoundError,
  PathTraversalError,
  ValidationError
} from '../../src/main/db/errors'
import { createTestDb, type TestDb } from './helpers/testDb'

const COURSE_ID = 'course-1'

const injectedFsFailure = vi.hoisted(() => ({ failNextFsync: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    fsyncSync: (...args: Parameters<typeof actual.fsyncSync>) => {
      if (injectedFsFailure.failNextFsync) {
        injectedFsFailure.failNextFsync = false
        throw new Error('injected fsync failure')
      }
      return actual.fsyncSync(...args)
    }
  }
})

describe('notesRepo', () => {
  let ctx: TestDb
  let repo: NotesRepo
  let courseFolder: string

  beforeEach(() => {
    injectedFsFailure.failNextFsync = false
    ctx = createTestDb()
    courseFolder = join(ctx.dir, 'course')
    mkdirSync(courseFolder, { recursive: true })
    repo = createNotesRepo({ getCourseFolder: () => courseFolder })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('rename', () => {
    test('renames the file and rewrites the first H1 to the final name', () => {
      writeFileSync(
        join(courseFolder, 'old.md'),
        '# 예전 제목\n\n본문은 그대로.\n',
        'utf8'
      )

      const result = repo.rename({
        courseId: COURSE_ID,
        relPath: 'old.md',
        newName: '해시 테이블 정리'
      })

      expect(result.relPath).toBe('해시 테이블 정리.md')
      expect(result.title).toBe('해시 테이블 정리')
      expect(result.markdown).toBe('# 해시 테이블 정리\n\n본문은 그대로.\n')
      const renamed = repo.read({ courseId: COURSE_ID, relPath: result.relPath })
      expect(renamed.markdown).toBe('# 해시 테이블 정리\n\n본문은 그대로.\n')
      expect(existsSync(join(courseFolder, 'old.md'))).toBe(false)
    })

    test('resolves collisions with a suffix and titles match the final name', () => {
      writeFileSync(join(courseFolder, '정리.md'), '# x\n', 'utf8')
      writeFileSync(join(courseFolder, 'old.md'), '# y\n', 'utf8')

      const result = repo.rename({
        courseId: COURSE_ID,
        relPath: 'old.md',
        newName: '정리.md'
      })

      expect(result.relPath).toBe('정리-2.md')
      expect(result.title).toBe('정리-2')
      expect(result.markdown).toBe('# 정리-2\n')
      expect(
        repo.read({ courseId: COURSE_ID, relPath: '정리-2.md' }).markdown
      ).toBe('# 정리-2\n')
    })

    test('same-name rename still syncs the heading and keeps the file', () => {
      writeFileSync(join(courseFolder, '동일.md'), '# 다른 제목\n', 'utf8')

      const result = repo.rename({
        courseId: COURSE_ID,
        relPath: '동일.md',
        newName: '동일'
      })

      expect(result.relPath).toBe('동일.md')
      expect(repo.read({ courseId: COURSE_ID, relPath: '동일.md' }).markdown).toBe(
        '# 동일\n'
      )
    })

    test('prepends an H1 when the note has none', () => {
      writeFileSync(join(courseFolder, 'no-title.md'), '그냥 본문\n', 'utf8')

      const result = repo.rename({
        courseId: COURSE_ID,
        relPath: 'no-title.md',
        newName: '새 제목'
      })

      expect(
        repo.read({ courseId: COURSE_ID, relPath: result.relPath }).markdown
      ).toBe('# 새 제목\n\n그냥 본문\n')
    })

    test('rejects names with no filesystem-safe characters', () => {
      writeFileSync(join(courseFolder, 'a.md'), '# a\n', 'utf8')
      expect(() =>
        repo.rename({ courseId: COURSE_ID, relPath: 'a.md', newName: '///' })
      ).toThrow(ValidationError)
    })

    test('restores the original filename and propagates an H1 write failure', () => {
      const original = '# 예전 제목\n\n보존할 본문\n'
      writeFileSync(join(courseFolder, 'old.md'), original, 'utf8')
      injectedFsFailure.failNextFsync = true

      expect(() =>
        repo.rename({
          courseId: COURSE_ID,
          relPath: 'old.md',
          newName: '새 제목'
        })
      ).toThrow('injected fsync failure')

      expect(readFileSync(join(courseFolder, 'old.md'), 'utf8')).toBe(original)
      expect(existsSync(join(courseFolder, '새 제목.md'))).toBe(false)
      expect(readdirSync(courseFolder).filter((name) => name.endsWith('.tmp'))).toEqual(
        []
      )
    })
  })

  describe('path-traversal guard', () => {
    test('rejects relPaths that escape the course folder via ..', () => {
      // Act / Assert
      expect(() =>
        repo.read({ courseId: COURSE_ID, relPath: '../outside.md' })
      ).toThrow(PathTraversalError)
      expect(() =>
        repo.write({ courseId: COURSE_ID, relPath: 'a/../../evil.md', markdown: 'x' })
      ).toThrow(PathTraversalError)
    })

    test('rejects absolute relPaths', () => {
      // Act / Assert
      expect(() =>
        repo.read({ courseId: COURSE_ID, relPath: '/etc/passwd.md' })
      ).toThrow(PathTraversalError)
    })

    test('rejects a dirRelPath escaping the course folder on create', () => {
      // Act / Assert
      expect(() =>
        repo.create({ courseId: COURSE_ID, dirRelPath: '../..', title: 'evil' })
      ).toThrow(PathTraversalError)
    })

    test('rejects a symlink that escapes the course folder', () => {
      const outside = join(ctx.dir, 'outside-notes')
      mkdirSync(outside)
      symlinkSync(outside, join(courseFolder, 'escape'), 'dir')

      expect(() =>
        repo.write({
          courseId: COURSE_ID,
          relPath: 'escape/stolen.md',
          markdown: 'must stay inside'
        })
      ).toThrow('path resolves outside the course folder')
      expect(existsSync(join(outside, 'stolen.md'))).toBe(false)
    })
  })

  describe('read', () => {
    test('returns markdown and mtime for an existing note', () => {
      // Arrange
      writeFileSync(join(courseFolder, 'week1.md'), '# Week 1\n', 'utf8')

      // Act
      const note = repo.read({ courseId: COURSE_ID, relPath: 'week1.md' })

      // Assert
      expect(note.markdown).toBe('# Week 1\n')
      expect(note.mtime).toBeGreaterThan(0)
    })

    test('throws NotFoundError for a missing note', () => {
      // Act / Assert
      expect(() => repo.read({ courseId: COURSE_ID, relPath: 'missing.md' })).toThrow(
        NotFoundError
      )
    })

    test('rejects non-markdown paths', () => {
      // Act / Assert
      expect(() => repo.read({ courseId: COURSE_ID, relPath: 'notes.txt' })).toThrow(
        ValidationError
      )
    })
  })

  describe('write', () => {
    test('writes content atomically, returns mtime, and leaves no temp file', () => {
      // Act
      const result = repo.write({
        courseId: COURSE_ID,
        relPath: 'new.md',
        markdown: 'hello'
      })

      // Assert
      expect(result.mtime).toBeGreaterThan(0)
      expect(repo.read({ courseId: COURSE_ID, relPath: 'new.md' }).markdown).toBe('hello')
      expect(readdirSync(courseFolder).filter((name) => name.endsWith('.tmp'))).toEqual(
        []
      )
    })

    test('keeps the original and removes the temp file when fsync fails', () => {
      const abs = join(courseFolder, 'note.md')
      writeFileSync(abs, 'original', 'utf8')
      injectedFsFailure.failNextFsync = true

      expect(() =>
        repo.write({
          courseId: COURSE_ID,
          relPath: 'note.md',
          markdown: 'replacement'
        })
      ).toThrow('injected fsync failure')

      expect(readFileSync(abs, 'utf8')).toBe('original')
      expect(readdirSync(courseFolder).filter((name) => name.endsWith('.tmp'))).toEqual(
        []
      )
    })

    test('fails with ConflictError when the file changed since expectedMtime', () => {
      // Arrange
      repo.write({ courseId: COURSE_ID, relPath: 'note.md', markdown: 'v1' })

      // Act / Assert
      expect(() =>
        repo.write({
          courseId: COURSE_ID,
          relPath: 'note.md',
          markdown: 'v2',
          expectedMtime: 12345
        })
      ).toThrow(ConflictError)
    })

    test('uses the exact fractional-millisecond mtime token for reads and conflicts', () => {
      const abs = join(courseFolder, 'precise.md')
      writeFileSync(abs, 'v1', 'utf8')
      const seconds = 1_700_000_000.123456
      utimesSync(abs, seconds, seconds)
      const exact = Number(statSync(abs, { bigint: true }).mtimeNs) / 1e6

      expect(Number.isInteger(exact)).toBe(false)
      expect(repo.read({ courseId: COURSE_ID, relPath: 'precise.md' }).mtime).toBe(exact)
      expect(() =>
        repo.write({
          courseId: COURSE_ID,
          relPath: 'precise.md',
          markdown: 'must not replace',
          expectedMtime: Math.round(exact)
        })
      ).toThrow(ConflictError)
      expect(readFileSync(abs, 'utf8')).toBe('v1')

      const result = repo.write({
        courseId: COURSE_ID,
        relPath: 'precise.md',
        markdown: 'v2',
        expectedMtime: exact
      })
      expect(result.mtime).toBe(
        Number(statSync(abs, { bigint: true }).mtimeNs) / 1e6
      )
    })
  })

  describe('create', () => {
    test('creates <title>.md in the requested directory', () => {
      // Act
      const ref = repo.create({ courseId: COURSE_ID, dirRelPath: '', title: 'Lecture 1' })

      // Assert
      expect(ref.relPath).toBe('Lecture 1.md')
      expect(repo.read(ref).markdown).toContain('# Lecture 1')
    })

    test('appends a numeric suffix when the file name collides', () => {
      // Arrange
      repo.create({ courseId: COURSE_ID, dirRelPath: '', title: 'Summary' })

      // Act
      const second = repo.create({ courseId: COURSE_ID, dirRelPath: '', title: 'Summary' })

      // Assert
      expect(second.relPath).toBe('Summary-2.md')
    })

    test('strips path separators from the title', () => {
      // Act
      const ref = repo.create({
        courseId: COURSE_ID,
        dirRelPath: '',
        title: '../evil/name'
      })

      // Assert
      expect(ref.relPath).toBe('evilname.md')
    })

    test('does not publish a note or leave a temp file when fsync fails', () => {
      injectedFsFailure.failNextFsync = true

      expect(() =>
        repo.create({ courseId: COURSE_ID, dirRelPath: '', title: '실패할 노트' })
      ).toThrow('injected fsync failure')

      expect(existsSync(join(courseFolder, '실패할 노트.md'))).toBe(false)
      expect(readdirSync(courseFolder).filter((name) => name.endsWith('.tmp'))).toEqual(
        []
      )
    })
  })

  /**
   * [M7] A linked course folder can vanish (moved / unmounted). Writing must
   * fail instead of re-creating the tree under a stale path.
   */
  describe('missing course folder', () => {
    beforeEach(() => {
      rmSync(courseFolder, { recursive: true, force: true })
    })

    test('read throws NotFoundError', () => {
      // Act / Assert
      expect(() => repo.read({ courseId: COURSE_ID, relPath: 'a.md' })).toThrow(
        NotFoundError
      )
    })

    test('write does not re-create the folder', () => {
      // Act / Assert
      expect(() =>
        repo.write({ courseId: COURSE_ID, relPath: 'a.md', markdown: 'x' })
      ).toThrow(NotFoundError)
      expect(existsSync(courseFolder)).toBe(false)
    })

    test('create does not re-create the folder', () => {
      // Act / Assert
      expect(() =>
        repo.create({ courseId: COURSE_ID, dirRelPath: '', title: 'New' })
      ).toThrow(NotFoundError)
      expect(existsSync(courseFolder)).toBe(false)
    })
  })
})

/** [M7] The traversal guard scopes to the course folder, wherever it is. */
describe('notesRepo (linked course folder)', () => {
  let ctx: TestDb
  let repo: NotesRepo
  let linkedFolder: string

  beforeEach(() => {
    ctx = createTestDb()
    linkedFolder = join(ctx.dir, 'outside', 'lecture-notes')
    mkdirSync(linkedFolder, { recursive: true })
    writeFileSync(join(ctx.dir, 'outside', 'secret.md'), 'nope')
    repo = createNotesRepo({ getCourseFolder: () => linkedFolder })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('writes and reads inside the linked folder', () => {
    // Act
    repo.write({ courseId: COURSE_ID, relPath: 'sub/note.md', markdown: '# hi' })

    // Assert
    expect(existsSync(join(linkedFolder, 'sub', 'note.md'))).toBe(true)
    expect(repo.read({ courseId: COURSE_ID, relPath: 'sub/note.md' }).markdown).toBe(
      '# hi'
    )
  })

  test('cannot escape the linked folder', () => {
    // Act / Assert
    expect(() =>
      repo.write({ courseId: COURSE_ID, relPath: '../secret.md', markdown: 'x' })
    ).toThrow(PathTraversalError)
    expect(() =>
      repo.create({ courseId: COURSE_ID, dirRelPath: '..', title: 'evil' })
    ).toThrow(PathTraversalError)
  })
})
