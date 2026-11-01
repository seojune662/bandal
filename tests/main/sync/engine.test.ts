import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createSyncEngine, type SyncEngine } from '../../../src/main/features/sync/engine'
import { createICloudProvider, icloudRoot, type SyncProvider } from '../../../src/main/features/sync/icloud'
import { repointSyncDocs } from '../../../src/main/features/sync/localDocs'
import { createPull } from '../../../src/main/features/sync/pull'
import { createTestDb, type TestDb } from '../helpers/testDb'

let home: string, root: string
const open: { ctx: TestDb; engine: SyncEngine }[] = []
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bandal-engine-'))
  root = icloudRoot(home)
  mkdirSync(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true })
})
afterEach(() => {
  for (const { ctx, engine } of open.splice(0)) {
    engine.stop()
    ctx.cleanup()
  }
  rmSync(home, { recursive: true, force: true })
})

function device(machine: string, options: {
  timing?: Record<string, number>; wrap?: (provider: SyncProvider) => SyncProvider
  wrapPull?: (pull: ReturnType<typeof createPull>) => ReturnType<typeof createPull>
} = {}) {
  const ctx = createTestDb()
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') })
  const materials = createMaterialsRepo({
    db: ctx.db, getCourseFolder: id => courses.getFolder(id), revealItem: () => {},
    trashItem: async abs => {
      mkdirSync(join(ctx.dir, 'Trash'), { recursive: true })
      renameSync(abs, join(ctx.dir, 'Trash', basename(abs)))
    },
    onPathChanged: change => repointSyncDocs(ctx.db, change)
  })
  const changed: string[] = []
  const engine = createSyncEngine({
    db: ctx.db,
    provider: (options.wrap ?? (provider => provider))(createICloudProvider({ root, tmpDir: join(ctx.dir, 'sync', 'tmp') })),
    pull: (options.wrapPull ?? (pull => pull))(createPull({ db: ctx.db, courses, materials })),
    stateFile: join(ctx.dir, 'sync', 'state.json'),
    machine: async () => machine,
    device: () => ({ name: machine, platform: 'macos', app_version: 'test' }),
    scan: async folder => ({
      complete: true,
      files: readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
        const abs = join(entry.parentPath, entry.name), info = statSync(abs)
        return { relPath: relative(folder, abs).split(sep).join('/'), size: info.size, mtime: Math.round(info.mtimeMs) }
      })
    }),
    changed: result => changed.push(...result.changed),
    // Passes run on syncNow only, so each step below is one known pass.
    timing: { idleMs: 3_600_000, hintMs: 3_600_000, rescanMs: 3_600_000, waitingMs: 3_600_000, ...options.timing }
  })
  open.push({ ctx, engine })
  return { db: ctx.db, courses, engine, changed }
}

test('two Macs meet through the iCloud folder: what one makes, the other gets', async () => {
  const a = device('mac-a'), b = device('mac-b')
  // Made before sync was ever on: the first pass compares everything with the empty base.
  const { id: course } = a.courses.create({ name: '선형대수학', color: 'violet' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  mkdirSync(root, { recursive: true })
  a.engine.start()
  await a.engine.syncNow()
  expect(a.engine.state()).toMatchObject({ state: 'synced' })
  expect(readFileSync(join(root, 'bandal.json'), 'utf8')).toBe('{"format":2}')
  expect(readdirSync(join(root, 'devices'))).toHaveLength(1)

  b.engine.start()
  await b.engine.syncNow()
  expect(b.db.prepare('SELECT name, color FROM courses WHERE id = ?').get(course)).toEqual({ name: '선형대수학', color: 'violet' })
  expect(readFileSync(join(b.courses.getFolder(course), '요약.md'), 'utf8')).toBe('# 요약\n')
  expect(b.changed).toContain(course)

  // A change made while the engine runs reaches the outbox through the triggers.
  b.courses.rename({ courseId: course, name: '선형대수학 2' })
  await b.engine.syncNow()
  await a.engine.syncNow()
  expect(a.db.prepare('SELECT name FROM courses WHERE id = ?').get(course)).toEqual({ name: '선형대수학 2' })
})

test('without the container the engine waits for the iPad, then starts once it appears', async () => {
  const a = device('mac-a')
  a.engine.start()
  await a.engine.syncNow()
  expect(a.engine.state()).toEqual({ state: 'needs-ipad' })
  expect(a.db.prepare('SELECT enabled FROM sync_runtime').get()).toEqual({ enabled: 1 })
  mkdirSync(root, { recursive: true })
  await a.engine.syncNow()
  expect(a.engine.state()).toMatchObject({ state: 'synced' })
})

test('a backup pause lets the running pass finish and starts no other until resumed', async () => {
  const a = device('mac-a')
  mkdirSync(root, { recursive: true })
  a.engine.start()
  await a.engine.pause()
  expect(readdirSync(root).sort()).toEqual(['bandal.json', 'devices'])
  a.courses.create({ name: '물리학', color: 'green' })
  await a.engine.syncNow()
  expect(readdirSync(root)).not.toContain('log')
  a.engine.resume()
  await a.engine.syncNow()
  expect(readdirSync(root)).toContain('log')
})

test('a write that keeps failing waits for the backoff instead of running a pass on every hint', async () => {
  mkdirSync(root, { recursive: true })
  let passes = 0
  const a = device('mac-a', {
    timing: { idleMs: 20, hintMs: 20, retryMs: 3_600_000 },
    wrap: provider => ({
      ...provider,
      status: () => {
        passes += 1
        return provider.status()
      },
      write: async (path, bytes) => {
        if (path.startsWith('log/')) throw new Error('disk full')
        return provider.write(path, bytes)
      }
    })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await vi.waitFor(() => expect(a.engine.state()).toEqual({ state: 'error', message: 'disk full' }), { timeout: 10_000 })
  // Hints from the files that did get written, and the still outbox, keep coming: none of them may run a pass.
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(passes).toBe(1)
})

/** A provider call that waits until the test lets it go, after telling the test it was reached. */
function gate() {
  let reached!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { reached = resolve }), open = new Promise<void>(resolve => { release = resolve })
  return { entered, release, pass: async () => { reached(); await open } }
}

test('stopping while the root is listed writes nothing, not even bandal.json', async () => {
  mkdirSync(root, { recursive: true })
  const listing = gate()
  const a = device('mac-a', { wrap: provider => ({ ...provider, list: async () => { await listing.pass(); return provider.list() } }) })
  a.engine.start()
  await listing.entered
  const stopped = a.engine.stop()
  listing.release()
  await stopped
  expect(readdirSync(root)).toEqual([])
})

test('stopping while a pull applies lets it finish but exports nothing after', async () => {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'bandal.json'), '{"format":2}')
  const pulling = gate()
  const a = device('mac-a', { wrapPull: pull => async snapshot => { await pulling.pass(); return pull(snapshot) } })
  a.courses.create({ name: '물리학', color: 'green' })
  a.engine.start()
  await pulling.entered
  const stopped = a.engine.stop()
  pulling.release()
  await stopped
  expect(readdirSync(root)).toEqual(['bandal.json'])
  expect(a.engine.state()).toEqual({ state: 'off' })
})
