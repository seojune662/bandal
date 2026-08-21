import {
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ValidationError } from '../../src/main/db/errors'
import { createCoursesRepo } from '../../src/main/features/courses'
import {
  createMaterialsRepo,
  type MaterialsRepo
} from '../../src/main/features/materials'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('materialsRepo realpath boundary', () => {
  let ctx: TestDb
  let repo: MaterialsRepo
  let courseId: string
  let courseFolder: string
  let outside: string

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
    const course = courses.create({ name: 'Security', color: '#000' })
    courseId = course.id
    courseFolder = course.folderPath
    outside = join(ctx.dir, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'secret.md'), 'outside secret')
    symlinkSync(outside, join(courseFolder, 'linked'), 'dir')
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

  test('readFile rejects a symlink escape', () => {
    expect(() => repo.readFile(courseId, 'linked/secret.md')).toThrow(
      ValidationError
    )
  })

  test('tree scanning skips symlink directories instead of descending', () => {
    expect(repo.tree(courseId).map((entry) => entry.relPath)).not.toContain(
      'linked'
    )
  })

  test('writeFile rejects a symlink escape without creating an outside file', () => {
    expect(() =>
      repo.writeFile({
        courseId,
        dirRelPath: 'linked',
        fileName: 'escaped.md',
        encoding: 'utf8',
        data: 'must stay inside'
      })
    ).toThrow(ValidationError)
    expect(existsSync(join(outside, 'escaped.md'))).toBe(false)
  })
})
