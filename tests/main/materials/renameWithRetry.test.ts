import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { opendir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createMaterialsRepo } from '../../../src/main/features/materials'
import * as retryModule from '../../../src/main/features/materials/renameWithRetry'
import { createTestDb, type TestDb } from '../helpers/testDb'

function fileError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('Windows material rename recovery', () => {
  let ctx: TestDb
  let courseId: string
  let courseFolder: string
  const nativeRetry = retryModule.renameWithRetry

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => join(ctx.dir, 'root')
    })
    const course = courses.create({ name: '영어 자료', color: '#000' })
    courseId = course.id
    courseFolder = course.folderPath
    mkdirSync(join(courseFolder, 'Reading', '.bandal', 'learning'), { recursive: true })
    writeFileSync(join(courseFolder, 'Reading', '.bandal', 'learning', 'state.json'), '{"words":["retain"]}')
    writeFileSync(join(courseFolder, 'Reading', '단어장.md'), 'retain — 보존하다')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ctx.cleanup()
  })

  function makeRepo(onPathChanged = vi.fn()) {
    return createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: () => courseFolder,
      revealItem: () => undefined,
      trashItem: async () => undefined,
      onPathChanged
    })
  }

  test.each(['rename', 'move'] as const)('waits for an open scanner handle before %s of the full learning folder', async (action) => {
    const source = join(courseFolder, 'Reading')
    if (action === 'move') mkdirSync(join(courseFolder, 'Library'))
    const destinationRelPath = action === 'move' ? 'Library/Reading' : 'Library'
    const destination = join(courseFolder, destinationRelPath)
    const directory = await opendir(source)
    await directory.read()
    let open = true
    const changed = vi.fn(() => {
      expect(existsSync(source)).toBe(false)
      expect(readFileSync(join(destination, '.bandal', 'learning', 'state.json'), 'utf8')).toBe('{"words":["retain"]}')
    })
    const operation = vi.fn<typeof rename>(async (from, to) => {
      if (open) throw fileError('EPERM')
      await rename(from, to)
    })
    vi.spyOn(retryModule, 'renameWithRetry').mockImplementation((from, to, validate) => nativeRetry(from, to, validate, {
      platform: 'win32',
      rename: operation,
      wait: async () => {
        expect(changed).not.toHaveBeenCalled()
        await directory.close()
        open = false
      }
    }))

    try {
      const repo = makeRepo(changed)
      const result = action === 'move'
        ? repo.move({ courseId, fromRelPath: 'Reading', toDirRelPath: 'Library' })
        : repo.rename({ courseId, relPath: 'Reading', newName: 'Library' })
      await expect(result).resolves.toEqual({ relPath: destinationRelPath })
      expect(operation).toHaveBeenCalledTimes(2)
      expect(readFileSync(join(destination, '단어장.md'), 'utf8')).toBe('retain — 보존하다')
      expect(changed).toHaveBeenCalledExactlyOnceWith({ courseId, fromRelPath: 'Reading', toRelPath: destinationRelPath, isDirectory: true })
    } finally {
      if (open) await directory.close()
    }
  })

  test('keeps files and path references untouched after a persistent Windows lock exhausts the bounded retries', async () => {
    const locked = fileError('EBUSY')
    const operation = vi.fn<typeof rename>().mockRejectedValue(locked)
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue()
    const changed = vi.fn()
    vi.spyOn(retryModule, 'renameWithRetry').mockImplementation((from, to, validate) => nativeRetry(from, to, validate, {
      platform: 'win32', rename: operation, wait
    }))

    await expect(makeRepo(changed).rename({ courseId, relPath: 'Reading', newName: 'Library' })).rejects.toBe(locked)
    expect(operation).toHaveBeenCalledTimes(6)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([50, 100, 200, 400, 800])
    expect(existsSync(join(courseFolder, 'Library'))).toBe(false)
    expect(readFileSync(join(courseFolder, 'Reading', '단어장.md'), 'utf8')).toBe('retain — 보존하다')
    expect(changed).not.toHaveBeenCalled()
  })

  test.each(['rename', 'move'] as const)('does not overwrite a destination created while %s waits for a lock', async (action) => {
    if (action === 'move') mkdirSync(join(courseFolder, 'Library'))
    const destination = action === 'move' ? join(courseFolder, 'Library', 'Reading') : join(courseFolder, 'Library')
    const changed = vi.fn()
    const operation = vi.fn<typeof rename>().mockRejectedValueOnce(fileError('EPERM'))
    vi.spyOn(retryModule, 'renameWithRetry').mockImplementation((from, to, validate) => nativeRetry(from, to, validate, {
      platform: 'win32',
      rename: operation,
      wait: async () => {
        mkdirSync(destination)
        writeFileSync(join(destination, 'existing.md'), 'external data')
      }
    }))

    const repo = makeRepo(changed)
    const result = action === 'move'
      ? repo.move({ courseId, fromRelPath: 'Reading', toDirRelPath: 'Library' })
      : repo.rename({ courseId, relPath: 'Reading', newName: 'Library' })
    await expect(result).rejects.toThrow('already exists')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(destination, 'existing.md'), 'utf8')).toBe('external data')
    expect(existsSync(join(courseFolder, 'Reading', '.bandal', 'learning', 'state.json'))).toBe(true)
    expect(changed).not.toHaveBeenCalled()
  })

  test.each([
    ['darwin', 'EPERM'],
    ['win32', 'EACCES'],
    ['win32', 'ENOENT']
  ] as const)('does not retry %s %s errors', async (platform, code) => {
    const failure = fileError(code)
    const operation = vi.fn<typeof rename>().mockRejectedValue(failure)
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue()

    await expect(nativeRetry('source', 'destination', () => undefined, { platform, rename: operation, wait })).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })
})
