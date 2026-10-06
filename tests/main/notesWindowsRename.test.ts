import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNotesRepo } from '../../src/main/features/notes'
import * as retry from '../../src/main/lib/retryWindowsFileOperation'

const failures = vi.hoisted(() => ({ remaining: 0, code: 'EPERM', rollback: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (failures.remaining > 0 && from.endsWith('.tmp') && to.endsWith('renamed.md')) {
        failures.remaining -= 1
        throw Object.assign(new Error('locked atomic replacement'), { code: failures.code })
      }
      if (failures.rollback && from.endsWith('renamed.md') && to.endsWith('moving.md')) {
        throw Object.assign(new Error('locked rollback'), { code: 'EPERM' })
      }
      return actual.renameSync(from, to)
    }
  }
})

describe('Windows note heading replacement recovery', () => {
  const original = '# moving\n\n원래 필기 이동 중에 쓴 초안\n'
  const nativeRetry = retry.retryWindowsFileOperation
  let directory: string
  let folder: string
  let wait: ReturnType<typeof vi.fn<(milliseconds: number) => Promise<void>>>
  let changed: ReturnType<typeof vi.fn>

  beforeEach(() => {
    failures.remaining = 0
    failures.code = 'EPERM'
    failures.rollback = false
    directory = mkdtempSync(join(tmpdir(), 'bandal-note-rename-'))
    folder = join(directory, 'course')
    mkdirSync(folder)
    writeFileSync(join(folder, 'moving.md'), original)
    wait = vi.fn(async () => undefined)
    changed = vi.fn()
    vi.spyOn(retry, 'retryWindowsFileOperation').mockImplementation((operation, options) =>
      nativeRetry(operation, { ...options, platform: 'win32', wait }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  const input = { courseId: 'course', relPath: 'moving.md', newName: 'renamed.md' }
  const repo = () => createNotesRepo({ getCourseFolder: () => folder, onPathChanged: changed })

  test.each(['EPERM', 'EBUSY'])('recovers a transient %s replacing the heading after the filename moved', async code => {
    failures.remaining = 1
    failures.code = code
    wait.mockImplementation(async () => {
      expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe(original)
      expect(existsSync(join(folder, 'renamed.md'))).toBe(false)
      expect(readdirSync(folder)).toEqual(['moving.md'])
      expect(changed).not.toHaveBeenCalled()
    })

    await expect(repo().rename(input)).resolves.toMatchObject({
      relPath: 'renamed.md', markdown: '# renamed\n\n원래 필기 이동 중에 쓴 초안\n'
    })
    expect(wait).toHaveBeenCalledExactlyOnceWith(50)
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      courseId: 'course', fromRelPath: 'moving.md', toRelPath: 'renamed.md', isDirectory: false
    })
    expect(readdirSync(folder)).toEqual(['renamed.md'])
  })

  test('stops after bounded retries with the original filename and draft intact', async () => {
    failures.remaining = 20
    await expect(repo().rename(input)).rejects.toThrow('locked atomic replacement')
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([50, 100, 200, 400, 800])
    expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe(original)
    expect(readdirSync(folder)).toEqual(['moving.md'])
    expect(changed).not.toHaveBeenCalled()
  })

  test('does not retry an incomplete rollback or disturb the surviving original bytes', async () => {
    failures.remaining = 1
    failures.rollback = true
    await expect(repo().rename(input)).rejects.toThrow(AggregateError)
    expect(wait).not.toHaveBeenCalled()
    expect(readFileSync(join(folder, 'renamed.md'), 'utf8')).toBe(original)
    expect(changed).not.toHaveBeenCalled()
  })

  test('does not retry a permanent access error', async () => {
    failures.remaining = 1
    failures.code = 'EACCES'
    await expect(repo().rename(input)).rejects.toThrow('locked atomic replacement')
    expect(wait).not.toHaveBeenCalled()
    expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe(original)
  })

  test('refuses a course relink during the lock wait', async () => {
    failures.remaining = 1
    const oldFolder = folder
    wait.mockImplementation(async () => {
      folder = join(directory, 'other-course')
      mkdirSync(folder)
      writeFileSync(join(folder, 'moving.md'), '# another note\n')
    })
    await expect(repo().rename(input)).rejects.toThrow('과목 폴더가 변경')
    expect(readFileSync(join(oldFolder, 'moving.md'), 'utf8')).toBe(original)
    expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe('# another note\n')
    expect(changed).not.toHaveBeenCalled()
  })

  test('refuses a replacement of the original note during the lock wait', async () => {
    failures.remaining = 1
    wait.mockImplementation(async () => {
      rmSync(join(folder, 'moving.md'))
      writeFileSync(join(folder, 'moving.md'), '# external replacement\n')
    })
    await expect(repo().rename(input)).rejects.toThrow('changed on disk')
    expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe('# external replacement\n')
    expect(changed).not.toHaveBeenCalled()
  })

  test('refuses a concurrent edit rather than rewriting the newer note heading', async () => {
    failures.remaining = 1
    wait.mockImplementation(async () => writeFileSync(join(folder, 'moving.md'), '# newer editor title\n\nnew body\n'))
    await expect(repo().rename(input)).rejects.toThrow('changed on disk')
    expect(readFileSync(join(folder, 'moving.md'), 'utf8')).toBe('# newer editor title\n\nnew body\n')
    expect(changed).not.toHaveBeenCalled()
  })

  test('keeps a destination created during the wait and chooses a new collision suffix', async () => {
    failures.remaining = 1
    wait.mockImplementation(async () => writeFileSync(join(folder, 'renamed.md'), '# keep external\n'))
    await expect(repo().rename(input)).resolves.toMatchObject({ relPath: 'renamed-2.md' })
    expect(readFileSync(join(folder, 'renamed.md'), 'utf8')).toBe('# keep external\n')
    expect(readFileSync(join(folder, 'renamed-2.md'), 'utf8')).toContain('이동 중에 쓴 초안')
  })
})
