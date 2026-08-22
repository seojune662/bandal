import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createCoursesRepo,
  normalizeFolderPath,
  slugify,
  type CoursesRepo
} from '../../src/main/features/courses'
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
      expect(course.source).toBe('managed')
      expect(course.missing).toBe(false)
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

    test('removes the newly-created empty folder when the course insert fails', () => {
      ctx.db.exec(`
        CREATE TRIGGER fail_course_insert
        BEFORE INSERT ON courses
        BEGIN
          SELECT RAISE(ABORT, 'injected course insert failure');
        END
      `)

      expect(() => repo.create({ name: 'Algorithms', color: '#111' })).toThrow(
        'injected course insert failure'
      )
      expect(existsSync(join(dataRoot, 'algorithms'))).toBe(false)
    })

    test('preserves an existing course folder when a suffixed insert fails', () => {
      const existing = join(dataRoot, 'algorithms')
      mkdirSync(existing, { recursive: true })
      writeFileSync(join(existing, 'keep.txt'), 'keep', 'utf8')
      ctx.db.exec(`
        CREATE TRIGGER fail_course_insert
        BEFORE INSERT ON courses
        BEGIN
          SELECT RAISE(ABORT, 'injected course insert failure');
        END
      `)

      expect(() => repo.create({ name: 'Algorithms', color: '#111' })).toThrow(
        'injected course insert failure'
      )
      expect(existsSync(join(existing, 'keep.txt'))).toBe(true)
      expect(existsSync(join(dataRoot, 'algorithms-2'))).toBe(false)
    })

    test('does not remove a newly-created folder if it gained content before failure', () => {
      const folderPath = join(dataRoot, 'algorithms')
      ctx.db.function('populate_failed_course_folder', () => {
        writeFileSync(join(folderPath, 'concurrent.txt'), 'keep', 'utf8')
      })
      ctx.db.exec(`
        CREATE TRIGGER fail_course_insert
        BEFORE INSERT ON courses
        BEGIN
          SELECT populate_failed_course_folder();
          SELECT RAISE(ABORT, 'injected course insert failure');
        END
      `)

      expect(() => repo.create({ name: 'Algorithms', color: '#111' })).toThrow(
        'injected course insert failure'
      )
      expect(existsSync(join(folderPath, 'concurrent.txt'))).toBe(true)
    })
  })

  describe('addFromFolder', () => {
    /** Creates a real folder inside the test dir and returns its path. */
    function makeFolder(name: string): string {
      const path = join(ctx.dir, name)
      mkdirSync(path, { recursive: true })
      return path
    }

    test('registers an arbitrary folder outside the data root', () => {
      // Arrange
      const folder = makeFolder('강의자료')

      // Act
      const result = repo.addFromFolder({ folderPath: folder, color: '#111' })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.course.folderPath).toBe(normalizeFolderPath(folder))
      expect(result.course.source).toBe('linked')
      expect(result.course.missing).toBe(false)
      // Nothing was created under the data root.
      expect(existsSync(dataRoot)).toBe(false)
    })

    test('defaults the course name to the folder basename', () => {
      // Arrange
      const folder = makeFolder('선형대수학')

      // Act
      const result = repo.addFromFolder({ folderPath: folder, color: '#111' })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.course.name).toBe('선형대수학')
    })

    test('prefers an explicit name over the basename', () => {
      // Arrange
      const folder = makeFolder('cs101')

      // Act
      const result = repo.addFromFolder({
        folderPath: folder,
        name: '컴퓨터개론',
        color: '#111'
      })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.course.name).toBe('컴퓨터개론')
    })

    test('falls back to the basename when the given name is blank', () => {
      // Arrange
      const folder = makeFolder('discrete-math')

      // Act
      const result = repo.addFromFolder({
        folderPath: folder,
        name: '   ',
        color: '#111'
      })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.course.name).toBe('discrete-math')
    })

    test('returns the existing course when the folder is already registered', () => {
      // Arrange
      const folder = makeFolder('dup')
      const first = repo.addFromFolder({ folderPath: folder, color: '#111' })

      // Act
      const second = repo.addFromFolder({ folderPath: folder, color: '#222' })

      // Assert
      expect(second.status).toBe('duplicate')
      if (second.status === 'failed' || first.status !== 'ok') return
      expect(second.course.id).toBe(first.course.id)
      expect(repo.list()).toHaveLength(1)
    })

    test('treats a symlink to a registered folder as a duplicate', () => {
      // Arrange
      const real = makeFolder('real-folder')
      const link = join(ctx.dir, 'linked-folder')
      symlinkSync(real, link, 'dir')
      const first = repo.addFromFolder({ folderPath: real, color: '#111' })

      // Act
      const second = repo.addFromFolder({ folderPath: link, color: '#111' })

      // Assert
      expect(second.status).toBe('duplicate')
      if (second.status === 'failed' || first.status !== 'ok') return
      expect(second.course.id).toBe(first.course.id)
    })

    test('revives an archived course when its folder is re-registered', () => {
      // Arrange
      const folder = makeFolder('archived')
      const first = repo.addFromFolder({ folderPath: folder, color: '#111' })
      if (first.status !== 'ok') throw new Error('setup failed')
      repo.archive({ courseId: first.course.id, archived: true })

      // Act
      const again = repo.addFromFolder({ folderPath: folder, color: '#111' })

      // Assert
      expect(again.status).toBe('duplicate')
      if (again.status === 'failed') return
      expect(again.course.archived).toBe(false)
      expect(repo.list().map((c) => c.id)).toEqual([first.course.id])
    })

    test('fails with "missing" when the folder does not exist', () => {
      // Act
      const result = repo.addFromFolder({
        folderPath: join(ctx.dir, 'nope'),
        color: '#111'
      })

      // Assert
      expect(result).toEqual({ status: 'failed', reason: 'missing' })
    })

    test('fails with "not-a-directory" for a regular file', () => {
      // Arrange
      const file = join(ctx.dir, 'notes.md')
      writeFileSync(file, '# hi')

      // Act
      const result = repo.addFromFolder({ folderPath: file, color: '#111' })

      // Assert
      expect(result).toEqual({ status: 'failed', reason: 'not-a-directory' })
    })

    test('rejects a relative folder path', () => {
      // Act / Assert
      expect(() =>
        repo.addFromFolder({ folderPath: 'relative/dir', color: '#111' })
      ).toThrow(ValidationError)
    })

    test('gives colliding basenames distinct slugs', () => {
      // Arrange
      mkdirSync(join(ctx.dir, 'a'), { recursive: true })
      mkdirSync(join(ctx.dir, 'b'), { recursive: true })
      const first = repo.addFromFolder({
        folderPath: join(ctx.dir, 'a'),
        name: 'Algorithms',
        color: '#111'
      })
      const second = repo.addFromFolder({
        folderPath: join(ctx.dir, 'b'),
        name: 'Algorithms',
        color: '#111'
      })

      // Assert
      expect(first.status).toBe('ok')
      expect(second.status).toBe('ok')
      if (first.status !== 'ok' || second.status !== 'ok') return
      expect(second.course.slug).toBe('algorithms-2')
    })

    test('does not need a configured data root', () => {
      // Arrange
      dataRoot = ''
      const folder = join(ctx.dir, 'rootless')
      mkdirSync(folder)

      // Act
      const result = repo.addFromFolder({ folderPath: folder, color: '#111' })

      // Assert
      expect(result.status).toBe('ok')
    })
  })

  describe('purge', () => {
    test('rejects a live course', () => {
      const course = repo.create({ name: '임시', color: 'gold' })
      expect(() => repo.purge({ courseId: course.id })).toThrow(ValidationError)
    })

    test('rejects a linked course even after soft delete', () => {
      const outside = join(ctx.dir, 'external-notes')
      mkdirSync(outside, { recursive: true })
      const { course } = repo.addFromFolder({ folderPath: outside, color: 'blue' })
      repo.softDelete({ courseId: course.id })
      expect(() => repo.purge({ courseId: course.id })).toThrow(ValidationError)
    })

    test('purges a course that has FK children across the whole graph', () => {
      const course = repo.create({ name: '반달 튜토리얼', color: 'gold' })
      const now = new Date().toISOString()
      ctx.db
        .prepare(
          `INSERT INTO agent_sessions (id, course_id, provider, status, created_at, updated_at)
           VALUES ('s1', ?, 'claude-code', 'idle', ?, ?)`
        )
        .run(course.id, now, now)
      ctx.db
        .prepare(
          `INSERT INTO messages (id, course_id, session_id, role, turn_seq, created_at, updated_at)
           VALUES ('m1', ?, 's1', 'user', 1, ?, ?)`
        )
        .run(course.id, now, now)
      ctx.db
        .prepare(
          `INSERT INTO message_blocks (message_id, ord, kind, payload_json, created_at, updated_at)
           VALUES ('m1', 0, 'text', '{"text":"hi"}', ?, ?)`
        )
        .run(now, now)
      ctx.db
        .prepare(
          `INSERT INTO materials_index (id, course_id, rel_path, kind, size, mtime, created_at, updated_at)
           VALUES ('mi1', ?, 'note.md', 'note', 1, 0, ?, ?)`
        )
        .run(course.id, now, now)
      repo.softDelete({ courseId: course.id })

      const result = repo.purge({ courseId: course.id })

      expect(result.ok).toBe(true)
      const remaining = ctx.db
        .prepare('SELECT count(*) AS n FROM messages WHERE course_id = ?')
        .get(course.id) as { n: number }
      expect(remaining.n).toBe(0)
      expect(
        ctx.db.prepare('SELECT id FROM courses WHERE id = ?').get(course.id)
      ).toBeUndefined()
    })

    test('[R3] purges a managed course even after dataRoot changed', () => {
      // Arrange: 옛 dataRoot 아래에 managed 과목을 만들고, 그 뒤 설정에서
      // dataRoot 가 다른 곳으로 옮겨진 상황을 재현한다.
      const course = repo.create({ name: '반달 튜토리얼', color: 'gold' })
      repo.softDelete({ courseId: course.id })
      const movedRoot = join(ctx.dir, 'BandalMoved')
      mkdirSync(movedRoot, { recursive: true })
      const repoAfterMove = createCoursesRepo({
        db: ctx.db,
        getDataRoot: () => movedRoot
      })

      // Act
      const result = repoAfterMove.purge({ courseId: course.id })

      // Assert: managed + soft-deleted 두 겹 가드만 남았으므로 성공해야 한다.
      expect(result.ok).toBe(true)
      expect(result.folderPath).toBe(normalizeFolderPath(course.folderPath))
      expect(
        ctx.db.prepare('SELECT id FROM courses WHERE id = ?').get(course.id)
      ).toBeUndefined()
    })

    test('hard-deletes a soft-deleted managed course and returns its folder', () => {
      const course = repo.create({ name: '반달 튜토리얼', color: 'gold' })
      repo.softDelete({ courseId: course.id })

      const result = repo.purge({ courseId: course.id })

      expect(result.folderPath).toBe(normalizeFolderPath(course.folderPath))
      const row = ctx.db
        .prepare('SELECT id FROM courses WHERE id = ?')
        .get(course.id)
      expect(row).toBeUndefined()
    })
  })

  describe('missing folders', () => {
    test('marks a course whose folder disappeared as missing', () => {
      // Arrange
      const folder = join(ctx.dir, 'vanishing')
      mkdirSync(folder)
      const created = repo.addFromFolder({ folderPath: folder, color: '#111' })
      if (created.status !== 'ok') throw new Error('setup failed')

      // Act
      rmSync(folder, { recursive: true, force: true })

      // Assert
      expect(repo.getById(created.course.id).missing).toBe(true)
      expect(repo.list()[0]?.missing).toBe(true)
    })
  })

  describe('relink', () => {
    test('repoints a course at another folder and flips it to linked', () => {
      // Arrange
      const course = repo.create({ name: 'Networks', color: '#111' })
      const moved = join(ctx.dir, 'moved-networks')
      mkdirSync(moved)

      // Act
      const result = repo.relink({ courseId: course.id, folderPath: moved })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status === 'failed') return
      expect(result.course.folderPath).toBe(normalizeFolderPath(moved))
      expect(result.course.source).toBe('linked')
      expect(result.course.missing).toBe(false)
      expect(repo.getFolder(course.id)).toBe(normalizeFolderPath(moved))
      // Identity is preserved so notes / annotations stay attached.
      expect(result.course.id).toBe(course.id)
      expect(result.course.slug).toBe(course.slug)
    })

    test('refuses a folder another live course already owns', () => {
      // Arrange
      const takenFolder = join(ctx.dir, 'taken')
      mkdirSync(takenFolder)
      const owner = repo.addFromFolder({ folderPath: takenFolder, color: '#111' })
      const other = repo.create({ name: 'Other', color: '#222' })
      if (owner.status !== 'ok') throw new Error('setup failed')

      // Act
      const result = repo.relink({ courseId: other.id, folderPath: takenFolder })

      // Assert
      expect(result.status).toBe('duplicate')
      if (result.status === 'failed') return
      expect(result.course.id).toBe(owner.course.id)
      expect(repo.getFolder(other.id)).toBe(other.folderPath)
    })

    test('is a no-op when re-linked to the folder it already uses', () => {
      // Arrange
      const folder = join(ctx.dir, 'same')
      mkdirSync(folder)
      const created = repo.addFromFolder({ folderPath: folder, color: '#111' })
      if (created.status !== 'ok') throw new Error('setup failed')

      // Act
      const result = repo.relink({ courseId: created.course.id, folderPath: folder })

      // Assert
      expect(result.status).toBe('ok')
      if (result.status === 'failed') return
      expect(result.course.folderPath).toBe(created.course.folderPath)
    })

    test('fails with "missing" for a folder that does not exist', () => {
      // Arrange
      const course = repo.create({ name: 'Compilers', color: '#111' })

      // Act
      const result = repo.relink({
        courseId: course.id,
        folderPath: join(ctx.dir, 'ghost')
      })

      // Assert
      expect(result).toEqual({ status: 'failed', reason: 'missing' })
      expect(repo.getFolder(course.id)).toBe(course.folderPath)
    })

    test('throws NotFoundError for an unknown course', () => {
      // Act / Assert
      expect(() =>
        repo.relink({ courseId: 'nope', folderPath: ctx.dir })
      ).toThrow(NotFoundError)
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
