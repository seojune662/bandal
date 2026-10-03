import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../src/main/features/materials/materialsRepo'
import { scanMaterialTree } from '../../src/main/features/materials/scanMaterialTree'
import { createTestDb, type TestDb } from './helpers/testDb'

let ctx: TestDb
beforeEach(() => { ctx = createTestDb() })
afterEach(() => { vi.restoreAllMocks(); ctx.cleanup() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const course = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'courses') }).create({ name: '영어 읽기', color: 'blue' })
  mkdirSync(join(course.folderPath, 'Reading', 'Science', '.bandal', 'learning'), { recursive: true })
  writeFileSync(join(course.folderPath, 'Reading', 'Science', '.bandal', 'learning', 'state.json'), '{"revision":2}')
  return { course, deps: { db: ctx.db, getCourseFolder: () => course.folderPath, revealItem: () => {}, trashItem: async () => {} } }
}

test('rename drains an invalidated active filesystem walk while concurrent trees wait without a recursive-rescan deadlock', async () => {
  const { course, deps } = setup()
  const opened = deferred()
  const finish = deferred()
  let calls = 0
  let closed = false
  const resume = vi.fn<() => Promise<void>>().mockResolvedValue()
  const pauseWatching = vi.fn(async () => resume)
  const onPathChanged = vi.fn(() => { expect(closed).toBe(true) })
  const repo = createMaterialsRepo({
    ...deps, pauseWatching, onPathChanged,
    scan: async (folder, limits) => {
      if (++calls !== 1) return scanMaterialTree(folder, limits)
      const directory = await opendir(join(folder, 'Reading', 'Science'))
      opened.resolve()
      await finish.promise
      await directory.close()
      closed = true
      return { nodes: [], files: [], truncation: new Set() }
    }
  })
  const firstTree = repo.tree(course.id)
  await opened.promise
  repo.invalidateTree(course.id)
  const rename = repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })
  await vi.waitFor(() => expect(pauseWatching).toHaveBeenCalledTimes(1))
  const secondTree = repo.tree(course.id)
  await Promise.resolve()
  expect(calls).toBe(1)
  expect(existsSync(join(course.folderPath, 'Reading'))).toBe(true)
  expect(onPathChanged).not.toHaveBeenCalled()
  finish.resolve()
  await expect(rename).resolves.toEqual({ relPath: 'Library' })
  const [first, second] = await Promise.all([firstTree, secondTree])
  expect(first.map(node => node.relPath)).toEqual(['Library'])
  expect(second).toEqual(first)
  expect(calls).toBe(2)
  expect(resume).toHaveBeenCalledTimes(1)
  expect(readFileSync(join(course.folderPath, 'Library', 'Science', '.bandal', 'learning', 'state.json'), 'utf8')).toBe('{"revision":2}')
})

test('concurrent course mutations serialize pause, filesystem change and resume without reopening a scan in their critical sections', async () => {
  const { course, deps } = setup()
  mkdirSync(join(course.folderPath, 'Other'))
  const closeFirst = deferred()
  const events: string[] = []
  let pauses = 0
  const pauseWatching = vi.fn(async () => {
    const number = ++pauses
    events.push(`pause${number}`)
    if (number === 1) await closeFirst.promise
    return async () => { events.push(`resume${number}`) }
  })
  const scan = vi.fn(scanMaterialTree)
  const repo = createMaterialsRepo({ ...deps, pauseWatching, scan, onPathChanged: change => { events.push(change.toRelPath) } })
  const first = repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })
  const second = repo.rename({ courseId: course.id, relPath: 'Other', newName: 'Other2' })
  await vi.waitFor(() => expect(pauseWatching).toHaveBeenCalledTimes(1))
  const tree = repo.tree(course.id)
  await Promise.resolve()
  expect(scan).not.toHaveBeenCalled()
  closeFirst.resolve()
  await Promise.all([first, second])
  await tree
  expect(events).toEqual(['pause1', 'Library', 'resume1', 'pause2', 'Other2', 'resume2'])
  expect(existsSync(join(course.folderPath, 'Library', 'Science'))).toBe(true)
  expect(existsSync(join(course.folderPath, 'Other2'))).toBe(true)
})

test('a rejected close never mutates files or path references and does not poison the next mutation', async () => {
  const { course, deps } = setup()
  const resume = vi.fn<() => Promise<void>>().mockResolvedValue()
  const pauseWatching = vi.fn<() => Promise<() => Promise<void>>>().mockRejectedValueOnce(new Error('close failed')).mockResolvedValue(resume)
  const onPathChanged = vi.fn()
  const repo = createMaterialsRepo({ ...deps, pauseWatching, onPathChanged })
  await expect(repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })).rejects.toThrow('close failed')
  expect(existsSync(join(course.folderPath, 'Reading', 'Science'))).toBe(true)
  expect(onPathChanged).not.toHaveBeenCalled()
  await expect(repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })).resolves.toEqual({ relPath: 'Library' })
  expect(resume).toHaveBeenCalledTimes(1)
})

test('a filesystem conflict still restores the watch and frees waiting tree reads', async () => {
  const { course, deps } = setup()
  const resume = vi.fn<() => Promise<void>>().mockResolvedValue()
  const pauseWatching = vi.fn(async () => {
    mkdirSync(join(course.folderPath, 'Library'))
    writeFileSync(join(course.folderPath, 'Library', 'external.md'), 'keep')
    return resume
  })
  const onPathChanged = vi.fn()
  const repo = createMaterialsRepo({ ...deps, pauseWatching, onPathChanged })
  await expect(repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })).rejects.toThrow('already exists')
  expect(resume).toHaveBeenCalledTimes(1)
  expect(onPathChanged).not.toHaveBeenCalled()
  expect((await repo.tree(course.id)).map(node => node.relPath)).toEqual(['Library', 'Reading'])
  expect(readFileSync(join(course.folderPath, 'Library', 'external.md'), 'utf8')).toBe('keep')
})

test('watch restoration errors are reported without claiming a successful rename failed', async () => {
  const { course, deps } = setup()
  const restoreFailure = new Error('resume channel lost')
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const repo = createMaterialsRepo({ ...deps, pauseWatching: async () => async () => { throw restoreFailure } })
  await expect(repo.rename({ courseId: course.id, relPath: 'Reading', newName: 'Library' })).resolves.toEqual({ relPath: 'Library' })
  expect(error).toHaveBeenCalledWith(expect.stringContaining('watcher restoration failed'), restoreFailure)
  expect((await repo.tree(course.id)).map(node => node.relPath)).toEqual(['Library'])
})
