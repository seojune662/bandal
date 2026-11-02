import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createSyncEngine, type SyncEngine } from '../../../src/main/features/sync/engine'
import { createICloudProvider, icloudRoot, type SyncProvider } from '../../../src/main/features/sync/icloud'
import { readState } from '../../../src/main/features/sync/identity'
import { repointSyncDocs } from '../../../src/main/features/sync/localDocs'
import { createPull } from '../../../src/main/features/sync/pull'
import { createTestDb, type TestDb } from '../helpers/testDb'

const PDF = readFileSync(join(__dirname, '../../../sync-fixtures/01-basic/root/pdf/b874efadd08d8148d022b60add6a0b3e942654ed646871f2c984c9c9051fb765.pdf'))
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
  const deps: Parameters<typeof createSyncEngine>[0] = {
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
  }
  const entry = { ctx, engine: createSyncEngine(deps) }
  open.push(entry)
  return {
    db: ctx.db, courses, engine: entry.engine, changed, stateFile: deps.stateFile,
    /** The app quit and opened again: a new engine on the same profile. */
    restart: async () => {
      await entry.engine.stop()
      entry.engine = createSyncEngine(deps)
      return entry.engine
    }
  }
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

test('a document that could not go up is not reported as synced, and goes up on the next try', async () => {
  mkdirSync(root, { recursive: true })
  let refuse = true
  const a = device('mac-a', {
    timing: { idleMs: 20, hintMs: 20, retryMs: 50 },
    wrap: provider => ({
      ...provider,
      write: async (path, bytes) => {
        if (refuse && path.startsWith('pdf/')) throw new Error('업로드가 끊겼어요')
        return provider.write(path, bytes)
      }
    })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '강의.pdf'), PDF)
  a.engine.start()
  await vi.waitFor(() => expect(a.engine.state()).toMatchObject({ state: 'error', message: expect.stringContaining('업로드가 끊겼어요') }), { timeout: 10_000 })
  refuse = false
  await vi.waitFor(() => expect(a.engine.state()).toMatchObject({ state: 'synced' }), { timeout: 10_000 })
  expect(readdirSync(join(root, 'pdf'))).toHaveLength(1)
})

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

const IPAD = 'bbbbbbbb-0000-4000-8000-000000000002'
const rootFile = (path: string): string => readFileSync(join(root, path), 'utf8')

test('an empty root is marked as this first upload, its device file right after, until all of it has gone up (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  const writes: string[] = []
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      writes.push(path === 'bandal.json' ? `bandal.json ${Buffer.from(bytes).toString('utf8')}` : path)
      return provider.write(path, bytes)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  const before = Date.now()
  a.engine.start()
  await a.engine.syncNow()
  const id = readState(a.stateFile).device_id as string
  // Who, and since when: until the device file is there, `started` says the upload runs.
  const mark = JSON.parse(writes[0]!.replace(/^bandal\.json /, '')) as { started: number }
  expect(mark).toEqual({ format: 2, initial_upload: id, started: expect.any(Number) })
  expect(mark.started).toBeGreaterThanOrEqual(before)
  expect(mark.started).toBeLessThanOrEqual(Date.now())
  expect(writes[1]).toBe(`devices/${id}.json`)
  expect(writes.slice(2, -1).some(path => path.startsWith('log/'))).toBe(true)
  expect(writes.at(-1)).toBe('bandal.json {"format":2}')
  expect(a.engine.state()).toMatchObject({ state: 'synced' })
})

test('a first upload cut off keeps the mark, and the next run carries on and then clears it (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  let failing = true
  const writes: string[] = []
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      if (failing && path.startsWith('log/')) throw new Error('offline')
      writes.push(path)
      return provider.write(path, bytes)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await a.engine.syncNow()
  const id = readState(a.stateFile).device_id as string
  expect(a.engine.state()).toEqual({ state: 'error', message: 'offline' })
  expect(JSON.parse(rootFile('bandal.json'))).toEqual({ format: 2, initial_upload: id, started: expect.any(Number) })
  failing = false
  writes.length = 0
  const again = await a.restart()
  again.start()
  await again.syncNow()
  // Back on its first upload: seen again before anything else goes up.
  expect(writes[0]).toBe(`devices/${id}.json`)
  expect(rootFile('bandal.json')).toBe('{"format":2}')
  expect(readdirSync(join(root, 'log', id))).toHaveLength(1)
})

test('during its own first upload the device file is never ten minutes old, even inside one long export (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(Date.UTC(2026, 10, 2))
    // Every write takes four minutes: one export of these notes runs far past ten.
    const devices: number[] = []
    const a = device('mac-a', {
      wrap: provider => ({ ...provider, write: async (path, bytes) => {
        if (path.startsWith('devices/')) devices.push(Date.now())
        await provider.write(path, bytes)
        vi.setSystemTime(Date.now() + 4 * 60_000)
      } })
    })
    const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
    for (let week = 1; week <= 8; week++) writeFileSync(join(a.courses.getFolder(course), `${week}주차.md`), `# ${week}주차\n`)
    a.engine.start()
    await a.engine.syncNow()
    expect(rootFile('bandal.json')).toBe('{"format":2}')
    expect(devices.length).toBeGreaterThanOrEqual(3)
    // A device file at most every ten minutes, plus the write it waited behind.
    for (let index = 1; index < devices.length; index++) {
      expect(devices[index]! - devices[index - 1]!).toBeGreaterThanOrEqual(10 * 60_000)
      expect(devices[index]! - devices[index - 1]!).toBeLessThanOrEqual(14 * 60_000)
    }
  } finally {
    vi.useRealTimers()
  }
})

test('a device syncing the root leaves another device\'s first upload mark alone (v2.6)', async () => {
  mkdirSync(join(root, 'devices'), { recursive: true })
  const mark = `{"format":2,"initial_upload":"${IPAD}"}`
  writeFileSync(join(root, 'bandal.json'), mark)
  writeFileSync(join(root, 'devices', `${IPAD}.json`), JSON.stringify({ name: 'iPad Pro', platform: 'ipados', app_version: '1.3.0', last_seen: Date.now() }))
  const a = device('mac-a')
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await a.engine.syncNow()
  expect(a.engine.state()).toMatchObject({ state: 'synced' })
  expect(rootFile('bandal.json')).toBe(mark)
  expect(readdirSync(join(root, 'log'))).toEqual([readState(a.stateFile).device_id])
})

test('a PDF that could not go up keeps the mark until a pass gets everything up (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  let refusing = true
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      if (refusing && path.startsWith('pdf/')) throw new Error('quota')
      return provider.write(path, bytes)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '1주차.pdf'), PDF)
  a.engine.start()
  await a.engine.syncNow()
  const id = readState(a.stateFile).device_id as string
  expect(a.engine.state()).toEqual({ state: 'error', message: 'quota' })
  expect(JSON.parse(rootFile('bandal.json'))).toEqual({ format: 2, initial_upload: id, started: expect.any(Number) })
  refusing = false
  await a.engine.syncNow()
  expect(rootFile('bandal.json')).toBe('{"format":2}')
  expect(readdirSync(join(root, 'pdf'))).toHaveLength(1)
})

test('stopping while the mark is written writes nothing after it (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  const marking = gate()
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      if (path === 'bandal.json') await marking.pass()
      return provider.write(path, bytes)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await marking.entered
  const stopped = a.engine.stop()
  marking.release()
  await stopped
  expect(existsSync(join(root, 'devices'))).toBe(false)
  expect(existsSync(join(root, 'log'))).toBe(false)
})

test('a mark another device put over this one while it uploaded is left for that device (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  const theirs = `{"format":2,"initial_upload":"${IPAD}"}`
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      await provider.write(path, bytes)
      // The iPad started the same empty root a moment later and marked it as its own.
      if (path.startsWith('log/')) writeFileSync(join(root, 'bandal.json'), theirs)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await a.engine.syncNow()
  expect(a.engine.state()).toMatchObject({ state: 'synced' })
  expect(rootFile('bandal.json')).toBe(theirs)
})

test('a root emptied under a syncing device is marked again, its device file next (v2.6)', async () => {
  mkdirSync(root, { recursive: true })
  const writes: string[] = []
  const a = device('mac-a', {
    wrap: provider => ({ ...provider, write: async (path, bytes) => {
      writes.push(path)
      return provider.write(path, bytes)
    } })
  })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.courses.getFolder(course), '요약.md'), '# 요약\n')
  a.engine.start()
  await a.engine.syncNow()
  const id = readState(a.stateFile).device_id as string
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root)
  writes.length = 0
  await a.engine.syncNow()
  expect(writes.slice(0, 2)).toEqual(['bandal.json', `devices/${id}.json`])
})
