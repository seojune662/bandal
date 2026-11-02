import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createDriveProvider } from '../../../src/main/features/sync/drive'
import type { MetaEvent } from '../../../src/main/features/sync/format'
import type { SyncProvider } from '../../../src/main/features/sync/icloud'
import { loadIdentity, readState } from '../../../src/main/features/sync/identity'
import { repointSyncDocs, type Scan } from '../../../src/main/features/sync/localDocs'
import { readMerged } from '../../../src/main/features/sync/pull'
import { createSyncRuntime, driveRootOf, profileBoundElsewhere } from '../../../src/main/features/sync/runtime'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createFakeDrive, fakeEncryptor, seedToken, type FakeDrive } from './fakeDrive'

const FIXTURES = join(__dirname, '../../../sync-fixtures')
const COURSE = 'c0000000-0000-4000-8000-000000000001'
const PDF_DOC = 'd0000000-0000-4000-8000-000000000001'
const NOTE_DOC = 'd0000000-0000-4000-8000-000000000002'
const PDF = readFileSync(join(FIXTURES, '01-basic/root/pdf/b874efadd08d8148d022b60add6a0b3e942654ed646871f2c984c9c9051fb765.pdf'))
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

let root: Map<string, Uint8Array>
const open: TestDb[] = [], runtimes: { stop(): Promise<void> | undefined }[] = []
afterEach(async () => {
  // A pass a connect started may still run: let it finish before its database closes.
  for (const runtime of runtimes.splice(0)) await runtime.stop()
  for (const ctx of open.splice(0)) ctx.cleanup()
  vi.unstubAllGlobals()
})

const fixture = (name: string): Map<string, Uint8Array> => {
  const dir = join(FIXTURES, name, 'root')
  return new Map(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => [relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'), readFileSync(join(entry.parentPath, entry.name))]))
}

/** The cloud root as the iCloud provider would show it. */
const provider: SyncProvider = {
  status: async () => 'ready',
  list: async () => ({
    entries: [...root].map(([path, bytes]) => ({ path, version: sha(bytes) })),
    read: async path => root.get(path) ?? Promise.reject(new Error(`${path} is missing`))
  }),
  write: async (path, bytes) => { root.set(path, Buffer.from(bytes)) },
  watch: () => () => {}
}

function walk(folder: string): Scan {
  const files = existsSync(folder) ? readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const abs = join(entry.parentPath, entry.name), info = statSync(abs)
    return { relPath: relative(folder, abs).split(sep).join('/'), size: info.size, mtime: Math.round(info.mtimeMs) }
  }) : []
  return { files, complete: true }
}

function device(machine: string, options: { boundElsewhere?: string; made?: { ok: boolean; cancelled?: boolean }; drive?: FakeDrive; logFile?: string } = {}) {
  const ctx = createTestDb()
  open.push(ctx)
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'Courses') })
  const materials = createMaterialsRepo({
    db: ctx.db, getCourseFolder: id => courses.getFolder(id), revealItem: () => {},
    trashItem: async abs => {
      mkdirSync(join(ctx.dir, 'Trash'), { recursive: true })
      renameSync(abs, join(ctx.dir, 'Trash', basename(abs)))
    },
    onPathChanged: change => ctx.db.transaction(() => {
      repointSyncDocs(ctx.db, change)
      repointMaterialPath({ ...change, db: ctx.db, courseFolder: courses.getFolder(change.courseId) })
    })()
  })
  const seeds: Record<string, unknown>[] = []
  if (options.drive) seedToken(join(ctx.dir, 'sync'))
  const launch = (driveRoot: string | null = null) => {
    const gdrive = options.drive && createDriveProvider({ dir: join(ctx.dir, 'sync'), root: driveRoot, encryptor: fakeEncryptor, activity: () => ({ focused: false, idleSeconds: 0 }) })
    const made = createSyncRuntime({
      db: ctx.db, courses, materials, userDataPath: ctx.dir, appVersion: 'test', providers: { icloud: provider, ...(gdrive ? { gdrive } : {}) }, machine: async () => machine,
      logFile: options.logFile ?? join(ctx.dir, 'logs', 'sync.log'),
      scan: async folder => walk(folder), changed: () => {}, onView: () => {},
      boundElsewhere: () => options.boundElsewhere ?? null,
      newProfile: async seed => {
        seeds.push(seed)
        return options.made ?? { ok: true }
      }
    })
    runtimes.push(made)
    return made
  }
  const runtime = launch()
  const row = (sql: string, ...params: unknown[]) => ctx.db.prepare(sql).get(...params) as Record<string, any> | undefined
  /** The lines sync.log holds, parsed. */
  const log = (): Record<string, unknown>[] => {
    const file = join(ctx.dir, 'logs', 'sync.log')
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>) : []
  }
  /** The app quit and opened again: the Drive provider starts from the folder state.json names, as the app makes it. */
  const restart = async (driveRoot: string | null) => {
    await runtime.stop()
    return launch(driveRoot)
  }
  return { db: ctx.db, dir: ctx.dir, courses, runtime, seeds, row, log, restart, folder: (id: string) => courses.getFolder(id) }
}

const events = (): MetaEvent[] => [...root].filter(([path]) => /^log\/[^/]+\/\d{8}\.json$/.test(path)).flatMap(([, bytes]) => JSON.parse(Buffer.from(bytes).toString('utf8')) as MetaEvent[])
async function rootState() {
  const read = await readMerged(await provider.list())
  if (read.status !== 'merged') throw new Error(read.status)
  return read.merged
}

test('an empty root takes everything here, and its first pass writes bandal.json', async () => {
  root = new Map()
  const a = device('mac-a')
  const { id } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.folder(id), '요약.md'), '# 요약\n')
  expect(await a.runtime.prepare('icloud')).toEqual({ status: 'ready', plan: { kind: 'upload', local: { courses: 1, docs: 1 }, remote: { courses: 0, docs: 0 }, pairs: [] } })
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  expect(Buffer.from(root.get('bandal.json')!).toString('utf8')).toBe('{"format":2}')
  expect(a.runtime.view()).toMatchObject({ provider: 'icloud', state: { state: 'synced' }, pending: 0 })
  expect((await rootState()).courses.has(id)).toBe(true)
})

test('an empty profile takes everything from the root', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  expect(await b.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'download', local: { courses: 0, docs: 0 }, remote: { courses: 1, docs: 2 } } })
  await b.runtime.connect('icloud', 'merge', [])
  await b.runtime.syncNow()
  expect(b.row('SELECT name FROM courses WHERE id = ?', COURSE)).toEqual({ name: '선형대수학' })
  expect(existsSync(join(b.folder(COURSE), '강의자료/1주차 벡터.pdf'))).toBe(true)
})

test('two computers sync through Google Drive, and a base from one root is never resumed against another', async () => {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  const a = device('mac-a', { drive })
  const { id } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.folder(id), '요약.md'), '# 요약\n')
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  await a.runtime.disconnect()
  // A Drive root: what this profile synced with iCloud says nothing about it.
  expect(await a.runtime.prepare('gdrive')).toMatchObject({ status: 'ready', plan: { kind: 'upload', local: { courses: 1, docs: 1 } } })
  await a.runtime.connect('gdrive', 'merge', [], 'upload')
  await a.runtime.syncNow()
  expect(a.runtime.view()).toMatchObject({ provider: 'gdrive', account: 'me@example.com', state: { state: 'synced' }, pending: 0 })
  // Looking for a root while bound would move the provider in use.
  expect(await a.runtime.prepare('gdrive')).toMatchObject({ status: 'error' })

  const b = device('mac-b', { drive })
  expect(await b.runtime.prepare('gdrive')).toMatchObject({ plan: { kind: 'download', remote: { courses: 1, docs: 1 } } })
  await b.runtime.connect('gdrive', 'merge', [], 'download')
  await b.runtime.syncNow()
  expect(b.row('SELECT name FROM courses WHERE id = ?', id)).toEqual({ name: '물리학' })
  expect(readFileSync(join(b.folder(id), '요약.md'), 'utf8')).toBe('# 요약\n')

  // Back to iCloud, which holds the same course: the base is from Drive now, so it asks instead of resuming.
  await a.runtime.disconnect()
  expect(existsSync(join(a.dir, 'sync', 'gdrive-token.enc'))).toBe(false)
  expect(await a.runtime.prepare('icloud')).toMatchObject({ plan: { kind: 'choose' } })
})

test('a merge joins a same-name course under its own id and takes its same PDF as the remote document', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: ' 선형대수학 ', color: 'pink' })
  writeFileSync(join(b.folder(id), '1주차.pdf'), PDF)
  writeFileSync(join(b.folder(id), 'B에만 있는 노트.md'), '# B\n')
  const prepared = await b.runtime.prepare('icloud')
  expect(prepared).toMatchObject({ status: 'ready', plan: { kind: 'choose', pairs: [{ local: id, remote: COURSE }] } })
  await b.runtime.connect('icloud', 'merge', [{ local: id, remote: COURSE }])
  await b.runtime.syncNow()
  // One course, under this profile's id, with the root's name, colour and places.
  expect(b.row('SELECT COUNT(*) AS n FROM courses')).toEqual({ n: 1 })
  expect(b.row('SELECT name, color FROM courses WHERE id = ?', id)).toEqual({ name: '선형대수학', color: 'blue' })
  expect(b.row('SELECT document_id FROM sync_docs WHERE local_path = ?', '강의자료/1주차 벡터.pdf')).toEqual({ document_id: PDF_DOC })
  expect(existsSync(join(b.folder(id), '1주차.pdf'))).toBe(false)
  expect(readFileSync(join(b.folder(id), '요약.md'), 'utf8')).toContain('# 요약')
  expect(b.row("SELECT COUNT(*) AS n FROM pdf_drawings WHERE rel_path = '강의자료/1주차 벡터.pdf'")!.n).toBeGreaterThan(0)
  // What went up: only the note that was here alone, under the root's course id.
  const merged = await rootState()
  expect([...merged.courses.keys()]).toEqual([COURSE])
  const mine = [...merged.docs].filter(([doc]) => doc !== PDF_DOC && doc !== NOTE_DOC)
  expect(mine.map(([, entity]) => [entity.fields.get('name')?.value, entity.fields.get('course_id')?.value])).toEqual([['B에만 있는 노트.md', COURSE]])
  expect(events().filter(event => event.op === 'course.upsert' && event.id === id)).toEqual([])
})

test('an overwrite deletes what only the root had, everywhere, and uploads this profile', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: '선형대수학', color: 'pink' })
  writeFileSync(join(b.folder(id), 'B 노트.md'), '# B\n')
  await b.runtime.connect('icloud', 'overwrite', [])
  await b.runtime.syncNow()
  const merged = await rootState()
  expect(merged.courses.get(COURSE)!.deleted?.value).toBe(true)
  expect([PDF_DOC, NOTE_DOC].map(doc => merged.docs.get(doc)!.deleted?.value)).toEqual([true, true])
  expect(merged.courses.get(id)!.deleted?.value).toBe(false)
  expect(b.row('SELECT COUNT(*) AS n FROM courses')).toEqual({ n: 1 })
  // Root files are never removed.
  expect(root.has('pdf/b874efadd08d8148d022b60add6a0b3e942654ed646871f2c984c9c9051fb765.pdf')).toBe(true)
})

test('a profile that synced with this root resumes without asking, and an import only seeds a new profile', async () => {
  root = new Map()
  const a = device('mac-a')
  a.courses.create({ name: '물리학', color: 'green' })
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  a.runtime.disconnect()
  expect(readState(join(a.dir, 'sync', 'state.json')).provider).toBeNull()
  expect(await a.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'resume' } })
  const c = device('mac-c')
  c.courses.create({ name: '화학', color: 'red' })
  await c.runtime.connect('icloud', 'import', [])
  expect(c.seeds).toEqual([{ provider: 'icloud', root: 'icloud' }])
  expect(c.runtime.view().provider).toBeNull()
})

test('a new profile releases a bound one, and leaves no sync state in an unbound one', async () => {
  root = new Map()
  const a = device('mac-a')
  a.runtime.release()
  expect(existsSync(join(a.dir, 'sync'))).toBe(false)
  await a.runtime.connect('icloud', 'merge', [])
  a.runtime.release()
  expect(readState(join(a.dir, 'sync', 'state.json')).provider).toBeNull()
})

test('a root another profile here is bound to is refused, and a device name goes to its devices file', async () => {
  root = new Map()
  const other = device('mac-a', { boundElsewhere: '기본 프로필' })
  await expect(other.runtime.connect('icloud', 'merge', [])).rejects.toThrow('기본 프로필과 연결돼 있어요')
  const a = device('mac-a')
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  a.runtime.rename('  서준의 MacBook  ')
  await a.runtime.syncNow()
  const id = a.runtime.view().device.id!
  expect(JSON.parse(Buffer.from(root.get(`devices/${id}.json`)!).toString('utf8'))).toMatchObject({ name: '서준의 MacBook', platform: 'macos' })
  expect(a.runtime.view().devices).toEqual([expect.objectContaining({ id, name: '서준의 MacBook', self: true })])
  expect(() => a.runtime.rename('')).toThrow('1~64자')
})

test('a profile that synced with another root goes up whole to an empty one', async () => {
  root = new Map()
  const a = device('mac-a')
  const { id } = a.courses.create({ name: '물리학', color: 'green' })
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  await a.runtime.disconnect()
  root = new Map()
  expect(await a.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'upload' } })
  await a.runtime.connect('icloud', 'merge', [], 'upload')
  await a.runtime.syncNow()
  expect((await rootState()).courses.get(id)?.fields.get('name')?.value).toBe('물리학')
})

test('a merge takes only the pairs the plan offered, each course once, and a plan that changed is refused', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: '선형대수학', color: 'pink' })
  const { id: other } = b.courses.create({ name: '물리학', color: 'red' })
  await expect(b.runtime.connect('icloud', 'merge', [], 'upload')).rejects.toThrow('다시 확인해 주세요')
  expect(b.runtime.view().provider).toBeNull()
  await b.runtime.connect('icloud', 'merge', [{ local: id, remote: COURSE }, { local: other, remote: COURSE }, { local: other, remote: 'c9999999-0000-4000-8000-000000000009' }], 'choose')
  expect(b.db.prepare('SELECT local_id, remote_id FROM sync_alias').all()).toEqual([{ local_id: id, remote_id: COURSE }])
})

test('a merge that fails half way leaves nothing behind, so the next connect asks again', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: '선형대수학', color: 'pink' })
  b.db.exec("CREATE TRIGGER fail_alias BEFORE INSERT ON sync_alias BEGIN SELECT RAISE(ABORT, 'disk full'); END")
  await expect(b.runtime.connect('icloud', 'merge', [{ local: id, remote: COURSE }], 'choose')).rejects.toThrow('disk full')
  b.db.exec('DROP TRIGGER fail_alias')
  expect(b.runtime.view().provider).toBeNull()
  expect(b.row('SELECT COUNT(*) AS n FROM sync_meta')).toEqual({ n: 0 })
  expect(await b.runtime.prepare('icloud')).toMatchObject({ plan: { kind: 'choose' } })
})

test('an import a person cancels changes nothing; one that fails says so', async () => {
  root = fixture('01-basic')
  const cancelled = device('mac-a', { made: { ok: false, cancelled: true } })
  await cancelled.runtime.connect('icloud', 'import', [])
  const failed = device('mac-b', { made: { ok: false, cancelled: false } })
  await expect(failed.runtime.connect('icloud', 'import', [])).rejects.toThrow('새 프로필을 만들지 못했어요')
})

test('another profile bound to iCloud is named by when it was made; the open one does not count', () => {
  const base = mkdtempSync(join(tmpdir(), 'bandal-profiles-'))
  try {
    const profile = join(base, 'profiles', 'p1')
    mkdirSync(join(profile, 'sync'), { recursive: true })
    writeFileSync(join(profile, 'isolated-profile.json'), JSON.stringify({ id: 'p1', createdAt: '2026-11-01T09:00:00.000Z' }))
    expect(profileBoundElsewhere(base, base, 'icloud')).toBeNull()
    writeFileSync(join(profile, 'sync', 'state.json'), JSON.stringify({ provider: 'icloud' }))
    expect(profileBoundElsewhere(base, base, 'icloud')).toBe('2026-11-01에 만든 프로필')
    expect(profileBoundElsewhere(base, profile, 'icloud')).toBeNull()
    mkdirSync(join(base, 'sync'))
    writeFileSync(join(base, 'sync', 'state.json'), JSON.stringify({ provider: 'icloud' }))
    expect(profileBoundElsewhere(base, profile, 'icloud')).toBe('기본 프로필')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

const IPAD = 'bbbbbbbb-0000-4000-8000-000000000002'
const ipadFile = (lastSeen: number) => Buffer.from(JSON.stringify({ name: 'iPad Pro', platform: 'ipados', app_version: '1.3.0', last_seen: lastSeen }))

test('a root another device is still filling is waited on, and connected to once that device is done (v2.6)', async () => {
  root = fixture('01-basic')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
  root.set(`devices/${IPAD}.json`, ipadFile(Date.now() - 5 * 60_000))
  const b = device('mac-b')
  expect(await b.runtime.prepare('icloud')).toEqual({ status: 'uploading', device: 'iPad Pro' })
  // Looking leaves an unbound profile without sync state.
  expect(existsSync(join(b.dir, 'sync'))).toBe(false)
  await expect(b.runtime.connect('icloud', 'merge', [])).rejects.toThrow('다른 기기(iPad Pro)가 아직 올리고 있어요')
  expect(b.runtime.view().provider).toBeNull()
  expect(b.log().map(line => [line.step, line.outcome])).toEqual([['prepare', 'uploading: iPad Pro'], ['connect', 'error: 다른 기기(iPad Pro)가 아직 올리고 있어요. 다 올린 뒤 다시 연결해 주세요.']])
  expect(b.log()[0]).toMatchObject({ provider: 'icloud', root: { key: 'icloud', bandal_json: true, initial_upload: IPAD } })
  // The iPad is done: its mark is gone.
  root.set('bandal.json', Buffer.from('{"format":2}'))
  expect(await b.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'download' } })
  await b.runtime.connect('icloud', 'merge', [])
  expect(b.runtime.view().provider).toBe('icloud')
})

test('a first upload that stopped, by an hour unseen or with neither a device file nor started, allows merge and import but not overwrite (v2.6)', async () => {
  root = fixture('01-basic')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
  root.set(`devices/${IPAD}.json`, ipadFile(Date.now() - 61 * 60_000))
  const a = device('mac-a')
  a.courses.create({ name: '물리학', color: 'green' })
  expect(await a.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'choose', interrupted: 'iPad Pro' } })
  await expect(a.runtime.connect('icloud', 'overwrite', [], 'choose')).rejects.toThrow('다른 기기(iPad Pro)가 처음 올리다 멈춘 클라우드라 덮어쓸 수 없어요')
  expect(a.runtime.view().provider).toBeNull()
  // Importing into a new profile only receives: allowed.
  await a.runtime.connect('icloud', 'import', [], 'choose')
  expect(a.seeds).toEqual([{ provider: 'icloud', root: 'icloud' }])
  // No device file, and no started to go by: stopped as well, named by the start of its id.
  root.delete(`devices/${IPAD}.json`)
  expect(await a.runtime.prepare('icloud')).toMatchObject({ status: 'ready', plan: { kind: 'choose', interrupted: 'bbbbbbbb' } })
  await a.runtime.connect('icloud', 'merge', [], 'choose')
  expect(a.runtime.view().provider).toBe('icloud')
  // Never this device's mark to clear.
  await a.runtime.syncNow()
  expect(Buffer.from(root.get('bandal.json')!).toString('utf8')).toBe(`{"format":2,"initial_upload":"${IPAD}"}`)
})

test('this device\'s own unfinished first upload is not waited on, and its next run clears the mark (v2.6)', async () => {
  root = new Map()
  const a = device('mac-a')
  const { device_id: own } = loadIdentity(join(a.dir, 'sync', 'state.json'), 'mac-a')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${own}"}`))
  root.set(`devices/${own}.json`, Buffer.from(JSON.stringify({ name: 'mac-a', platform: 'macos', app_version: 'test', last_seen: Date.now() })))
  const { id } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.folder(id), '요약.md'), '# 요약\n')
  const prepared = await a.runtime.prepare('icloud')
  expect(prepared).toMatchObject({ status: 'ready', plan: { kind: 'upload' } })
  expect(prepared.status === 'ready' && prepared.plan.interrupted).toBeUndefined()
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  expect(Buffer.from(root.get('bandal.json')!).toString('utf8')).toBe('{"format":2}')
  expect((await rootState()).courses.has(id)).toBe(true)
})

test('a Drive root with files but no bandal.json fails to connect, and the log names the folders looked at (X6)', async () => {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  // An iPad build before v2.6 had made the folder and begun its PDFs; bandal.json came last.
  const folder = drive.folder(), pdf = drive.folder('pdf', folder.id, {})
  drive.file(`${sha(PDF)}.pdf`, pdf.id, PDF)
  drive.folder('Bandal', 'ROOT', {})
  const a = device('mac-a', { drive })
  expect(await a.runtime.prepare('gdrive')).toEqual({ status: 'error', message: 'bandal.json: missing-root' })
  expect(a.log()).toEqual([{
    at: expect.any(String), step: 'prepare', provider: 'gdrive', outcome: 'error: bandal.json: missing-root',
    root: { key: `gdrive:${folder.id}`, entries: 1, bandal_json: false, initial_upload: null },
    candidates: { folders: [{ id: folder.id, name: 'Bandal', created: folder.createdTime, by: 'mark', bandal_json: false }], chosen: folder.id, made: false }
  }])
})

test('another device\'s upload is told from bandal.json and its device file alone, before the rest of the root has arrived (v2.6)', async () => {
  root = fixture('01-basic')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
  root.set(`devices/${IPAD}.json`, ipadFile(Date.now() - 5 * 60_000))
  // A log still arriving through iCloud: a full read waits for it.
  root.set(`log/${IPAD}/.00000002.json.icloud`, Buffer.from(''))
  const b = device('mac-b')
  expect(await b.runtime.prepare('icloud')).toEqual({ status: 'uploading', device: 'iPad Pro' })
  // The marking device's own file still arriving (the rest is here): nothing to tell yet, so the screen waits.
  root.delete(`log/${IPAD}/.00000002.json.icloud`)
  root.delete(`devices/${IPAD}.json`)
  root.set(`devices/.${IPAD}.json.icloud`, Buffer.from(''))
  expect(await b.runtime.prepare('icloud')).toEqual({ status: 'waiting' })
  expect(b.log().at(-1)).toMatchObject({ outcome: 'waiting', root: { initial_upload: IPAD } })
  // Its file there but not read this once (a download that failed): still not judged as stopped.
  root.delete(`devices/.${IPAD}.json.icloud`)
  root.set(`devices/${IPAD}.json`, ipadFile(Date.now()))
  const list = provider.list
  let refused = false
  provider.list = async () => {
    const listed = await list()
    return { ...listed, read: async path => {
      if (path === `devices/${IPAD}.json` && !refused) {
        refused = true
        throw new Error('download failed')
      }
      return listed.read(path)
    } }
  }
  try {
    expect(await b.runtime.prepare('icloud')).toEqual({ status: 'waiting' })
  } finally {
    provider.list = list
  }
  expect(await b.runtime.prepare('icloud')).toEqual({ status: 'uploading', device: 'iPad Pro' })
})

test('a first upload runs while its device was seen within the hour either way, and its name is kept short (v2.6)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const now = Date.UTC(2026, 10, 2, 3)
    vi.setSystemTime(now)
    root = fixture('01-basic')
    root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
    const b = device('mac-b')
    const seen = async (lastSeen: number, name = 'iPad Pro'): Promise<string> => {
      root.set(`devices/${IPAD}.json`, Buffer.from(JSON.stringify({ name, platform: 'ipados', app_version: '1.3.0', last_seen: lastSeen })))
      const prepared = await b.runtime.prepare('icloud')
      return prepared.status === 'uploading' ? prepared.device : prepared.status === 'ready' ? `stopped: ${prepared.plan.interrupted}` : prepared.status
    }
    expect(await seen(now - 60 * 60_000)).toBe('iPad Pro')
    expect(await seen(now - 60 * 60_000 - 1)).toBe('stopped: iPad Pro')
    // A clock an hour ahead would hold everyone back for as long: stopped too.
    expect(await seen(now + 60 * 60_000)).toBe('iPad Pro')
    expect(await seen(now + 60 * 60_000 + 1)).toBe('stopped: iPad Pro')
    expect(await seen(now, '가'.repeat(100))).toBe('가'.repeat(64))
    expect(await seen(now, '  ')).toBe('bbbbbbbb')
  } finally {
    vi.useRealTimers()
  }
})

test('until its device file has a last_seen, a first upload runs for five minutes from started either way (v2.6)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const now = Date.UTC(2026, 10, 2, 3)
    vi.setSystemTime(now)
    root = fixture('01-basic')
    const b = device('mac-b')
    const marked = async (started: number | undefined, deviceFile?: Record<string, unknown>): Promise<string> => {
      root.set('bandal.json', Buffer.from(JSON.stringify({ format: 2, initial_upload: IPAD, started })))
      if (deviceFile) root.set(`devices/${IPAD}.json`, Buffer.from(JSON.stringify(deviceFile)))
      else root.delete(`devices/${IPAD}.json`)
      const prepared = await b.runtime.prepare('icloud')
      return prepared.status === 'uploading' ? prepared.device : prepared.status === 'ready' ? `stopped: ${prepared.plan.interrupted}` : prepared.status
    }
    // Marked, and its device file not written yet.
    expect(await marked(now - 5 * 60_000)).toBe('bbbbbbbb')
    expect(await marked(now - 5 * 60_000 - 1)).toBe('stopped: bbbbbbbb')
    expect(await marked(now + 5 * 60_000)).toBe('bbbbbbbb')
    expect(await marked(now + 5 * 60_000 + 1)).toBe('stopped: bbbbbbbb')
    // Nothing to go by: no started, or one that is not a whole ms.
    expect(await marked(undefined)).toBe('stopped: bbbbbbbb')
    expect(await marked(now - 0.5)).toBe('stopped: bbbbbbbb')
    // A device file without last_seen: started still stands in.
    expect(await marked(now, { name: 'iPad Pro' })).toBe('iPad Pro')
    expect(await marked(now - 6 * 60_000, { name: 'iPad Pro' })).toBe('stopped: iPad Pro')
    // Once there is a last_seen, started says nothing.
    expect(await marked(now - 24 * 60 * 60_000, { name: 'iPad Pro', last_seen: now })).toBe('iPad Pro')
    expect(await marked(now, { name: 'iPad Pro', last_seen: now - 61 * 60_000 })).toBe('stopped: iPad Pro')
  } finally {
    vi.useRealTimers()
  }
})

test('a profile copied from another computer does not take that computer\'s mark as its own (v2.6)', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { device_id: theirs } = loadIdentity(join(b.dir, 'sync', 'state.json'), 'mac-a')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${theirs}"}`))
  root.set(`devices/${theirs}.json`, Buffer.from(JSON.stringify({ name: 'mac-a', platform: 'macos', app_version: 'test', last_seen: Date.now() })))
  expect(await b.runtime.prepare('icloud')).toEqual({ status: 'uploading', device: 'mac-a' })
})

test('a log that cannot be written changes nothing, and past 1 MiB it starts over (v2.6)', async () => {
  root = fixture('01-basic')
  root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
  root.set(`devices/${IPAD}.json`, ipadFile(Date.now()))
  const blocker = join(mkdtempSync(join(tmpdir(), 'bandal-log-')), 'not-a-folder')
  writeFileSync(blocker, '')
  const a = device('mac-a', { logFile: join(blocker, 'sync.log') })
  expect(await a.runtime.prepare('icloud')).toEqual({ status: 'uploading', device: 'iPad Pro' })
  const b = device('mac-b')
  mkdirSync(join(b.dir, 'logs'))
  writeFileSync(join(b.dir, 'logs', 'sync.log'), 'x'.repeat((1 << 20) + 1))
  await b.runtime.prepare('icloud')
  expect(b.log()).toEqual([expect.objectContaining({ outcome: 'uploading: iPad Pro' })])
})

test('each Drive attempt logs its own lookup, and a connect that made a new folder says so (v2.6)', async () => {
  root = new Map()
  const drive = createFakeDrive()
  let failing = false
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
    failing && String(input).startsWith('https://www.googleapis.com/drive/v3/files?') ? Promise.resolve(Response.json({ error: { message: 'backend' } }, { status: 500 })) : drive.fetch(input, init))
  const a = device('mac-a', { drive })
  expect(await a.runtime.prepare('gdrive')).toMatchObject({ status: 'ready', plan: { kind: 'upload' } })
  await a.runtime.connect('gdrive', 'merge', [])
  expect(a.log().at(-1)).toMatchObject({ step: 'connect', outcome: 'made a new root folder', candidates: { made: true } })
  await a.runtime.syncNow()
  const b = device('mac-b', { drive })
  expect(await b.runtime.prepare('gdrive')).toMatchObject({ status: 'ready' })
  // The next lookup fails before it sees any folder: its line holds that, not the folders found before.
  failing = true
  await expect(b.runtime.prepare('gdrive')).rejects.toThrow()
  expect(b.log().at(-1)).toMatchObject({ step: 'prepare', root: null, candidates: { folders: [], chosen: null, made: false } })
})

const STROKES = ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004']
const NEW_STROKE = 'e0000000-0000-4000-8000-000000000009'
/** The Drive root folder as root paths and bytes. */
const inDrive = (drive: FakeDrive): Map<string, Uint8Array> => new Map([...drive.files.values()]
  .filter(file => file.bytes !== undefined && !file.trashed && drive.pathOf(file.id).startsWith('Bandal/'))
  .map(file => [drive.pathOf(file.id).slice('Bandal/'.length), file.bytes!]))
async function mergedOf(files: Map<string, Uint8Array>) {
  const read = await readMerged({ entries: [...files].map(([path, bytes]) => ({ path, version: sha(bytes) })), read: async path => files.get(path)! })
  if (read.status !== 'merged') throw new Error(read.status)
  return read.merged
}
const json = (bytes: Uint8Array | undefined): any => bytes && JSON.parse(Buffer.from(bytes).toString('utf8'))

test('a move goes up whole to the empty storage, then tells the old root; a device that follows sends only what changed (v2.7)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const at = (minutes: number): number => {
      vi.setSystemTime(Date.UTC(2026, 10, 2, 3) + minutes * 60_000)
      return Date.now()
    }
    at(0)
    root = fixture('01-basic')
    const drive = createFakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const a = device('mac-a', { drive }), b = device('mac-b', { drive })
    for (const [side, name] of [[a, 'A의 Mac'], [b, 'B의 Mac']] as const) {
      await side.runtime.connect('icloud', 'merge', [])
      side.runtime.rename(name)
      await side.runtime.syncNow()
    }
    const ids = { a: a.runtime.view().device.id!, b: b.runtime.view().device.id! }

    // A moves to Google Drive, which holds nothing yet: everything goes up there under the ids every device shares.
    const moved = at(1)
    expect(await a.runtime.prepareMove('icloud')).toEqual({ status: 'error', message: '이미 iCloud와 동기화하고 있어요.' })
    expect(await a.runtime.prepareMove('gdrive')).toMatchObject({ status: 'ready', plan: { kind: 'upload', local: { courses: 1, docs: 2 }, pairs: [] } })
    await a.runtime.move('gdrive', 'upload')
    expect(a.runtime.view()).toMatchObject({ provider: 'gdrive' })
    await a.runtime.syncNow()
    expect(a.runtime.view()).toMatchObject({ provider: 'gdrive', moving: null, state: { state: 'synced' } })
    const up = await mergedOf(inDrive(drive))
    expect(up.initialUpload).toBeNull()
    expect([...up.courses.keys()]).toEqual([COURSE])
    expect([...up.docs.keys()].sort()).toEqual([PDF_DOC, NOTE_DOC])
    expect([...up.ink.keys()].sort()).toEqual(STROKES)
    // The old root learns where A went, and nothing else of A's changes there.
    expect(json(root.get(`devices/${ids.a}.json`))).toMatchObject({ name: 'A의 Mac', moved_to: { provider: 'drive', t: moved } })
    expect([...root.keys()].filter(path => path.includes(ids.a) && !path.startsWith('devices/'))).toEqual([])

    // B, still on iCloud, is offered the move; meanwhile it renames the course, erases a stroke and draws one.
    at(2)
    await b.runtime.syncNow()
    expect(b.runtime.view()).toMatchObject({ moved: { device: 'A의 Mac', provider: 'gdrive', t: moved }, devices: expect.arrayContaining([expect.objectContaining({ id: ids.a, moved_to: { provider: 'gdrive', t: moved } })]) })
    b.courses.rename({ courseId: COURSE, name: '선형대수학 2' })
    const erased = new Date().toISOString()
    b.db.prepare('UPDATE pdf_drawings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(erased, erased, STROKES[0])
    b.db.prepare(`INSERT INTO pdf_drawings (id, course_id, rel_path, page, kind, data_json, style_json, created_at, updated_at) VALUES (?, ?, ?, 1, 'ink', ?, ?, ?, ?)`)
      .run(NEW_STROKE, COURSE, '강의자료/1주차 벡터.pdf', JSON.stringify({ inkVersion: 5, points: [{ x: 0.5, y: 0.5, p: 0.5, t: 0 }, { x: 0.6, y: 0.6, p: 0.5, t: 8 }] }),
        JSON.stringify({ color: 'red', width: 0.003, opacity: 1 }), erased, erased)
    await b.runtime.syncNow()
    // A, on Drive, recolours the course after that.
    at(3)
    a.courses.setColor({ courseId: COURSE, color: 'red' })
    await a.runtime.syncNow()

    // B follows in one step: the root holds data, so it merges by id.
    const followed = at(4)
    expect(await b.runtime.prepareMove('gdrive')).toMatchObject({ status: 'ready', plan: { kind: 'join', remote: { courses: 1, docs: 2 }, pairs: [] } })
    const before = new Set(drive.files.keys())
    await b.runtime.move('gdrive', 'join')
    await b.runtime.syncNow()
    expect(b.runtime.view()).toMatchObject({ provider: 'gdrive', moving: null, moved: null, state: { state: 'synced' } })
    // What B wrote there: its device file, its rename and its two strokes. No document, note, PDF or course field went up again.
    const sent = [...drive.files.values()].filter(file => !before.has(file.id) && file.bytes !== undefined).map(file => drive.pathOf(file.id).slice('Bandal/'.length)).sort()
    expect(sent).toEqual([`devices/${ids.b}.json`, expect.stringMatching(new RegExp(`^ink/${PDF_DOC}/1/${ids.b}-\\d{8}\\.json\\.gz$`)), expect.stringMatching(new RegExp(`^log/${ids.b}/\\d{8}\\.json$`))])
    const files = inDrive(drive)
    expect([...files].filter(([path]) => path.startsWith(`log/${ids.b}/`)).flatMap(([, bytes]) => json(bytes))).toEqual([{ t: followed, op: 'course.upsert', id: COURSE, fields: { name: '선형대수학 2' } }])
    const now = await mergedOf(files)
    // The later change wins on each side: B's rename and its strokes, A's colour.
    expect(Object.fromEntries([...now.courses.get(COURSE)!.fields].map(([key, field]) => [key, field.value]))).toMatchObject({ name: '선형대수학 2', color: 'red' })
    expect(now.ink.get(STROKES[0])!.value.object.del).toBe(true)
    expect(now.ink.get(NEW_STROKE)!.value.object).toMatchObject({ kind: 'ink', style: { color: 'red' } })
    expect(b.row('SELECT name, color FROM courses WHERE id = ?', COURSE)).toEqual({ name: '선형대수학 2', color: 'red' })
    expect(json(root.get(`devices/${ids.b}.json`))).toMatchObject({ name: 'B의 Mac', moved_to: { provider: 'drive', t: followed } })
    // A takes it from there as from any device.
    await a.runtime.syncNow()
    expect(a.row('SELECT name, color FROM courses WHERE id = ?', COURSE)).toEqual({ name: '선형대수학 2', color: 'red' })
    expect(a.row('SELECT deleted_at FROM pdf_drawings WHERE id = ?', STROKES[0])!.deleted_at).not.toBeNull()
    expect(a.row('SELECT kind FROM pdf_drawings WHERE id = ?', NEW_STROKE)).toEqual({ kind: 'ink' })
  } finally {
    vi.useRealTimers()
  }
})

test('a deletion made in the old root after the other device left reaches the new one, and "나중에" hides the offer (v2.7)', async () => {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  const a = device('mac-a', { drive }), b = device('mac-b', { drive })
  const { id: kept } = a.courses.create({ name: '물리학', color: 'green' }), { id: gone } = a.courses.create({ name: '화학', color: 'red' })
  writeFileSync(join(a.folder(gone), '반응식.md'), '# 반응식\n')
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  await b.runtime.connect('icloud', 'merge', [], 'download')
  await b.runtime.syncNow()
  await a.runtime.move('gdrive', 'upload')
  await a.runtime.syncNow()
  await b.runtime.syncNow()
  const offer = b.runtime.view().moved!
  expect(offer).toMatchObject({ provider: 'gdrive' })
  b.runtime.dismissMove(offer.t)
  expect(b.runtime.view().moved).toBeNull()
  // Still on iCloud, B deletes a course A took to Drive; then it moves after all, from Settings.
  await new Promise(resolve => setTimeout(resolve, 5))
  b.courses.softDelete({ courseId: gone })
  await b.runtime.syncNow()
  await b.runtime.move('gdrive', 'join')
  await b.runtime.syncNow()
  const now = await mergedOf(inDrive(drive))
  expect(now.courses.get(gone)!.deleted?.value).toBe(true)
  expect([...now.docs.values()].filter(entity => entity.fields.get('course_id')?.value === gone).map(entity => entity.deleted?.value)).toEqual([true])
  expect(now.courses.get(kept)!.deleted?.value).toBe(false)
  await a.runtime.syncNow()
  expect(a.row('SELECT deleted_at FROM courses WHERE id = ?', gone)!.deleted_at).not.toBeNull()
})

test('a move from Google Drive lets its sign-in go once iCloud holds everything, even across a restart (v2.7)', async () => {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  const a = device('mac-a', { drive })
  const { id } = a.courses.create({ name: '물리학', color: 'green' })
  await a.runtime.connect('gdrive', 'merge', [])
  await a.runtime.syncNow()
  const self = a.runtime.view().device.id!
  // iCloud cannot take the files yet: the move stays unfinished.
  const write = provider.write
  provider.write = async () => { throw new Error('offline') }
  try {
    await a.runtime.move('icloud', 'upload')
    await a.runtime.syncNow()
    expect(a.runtime.view()).toMatchObject({ provider: 'icloud', moving: 'gdrive', state: { state: 'error' } })
  } finally {
    provider.write = write
  }
  // The app quits and opens again: the Drive folder left behind is still known, and told once iCloud holds everything.
  const state = readState(join(a.dir, 'sync', 'state.json'))
  expect(driveRootOf(state)).toBe(String(state.moving && (state.moving as { root: string }).root).slice('gdrive:'.length))
  const again = await a.restart(driveRootOf(state))
  await again.syncNow()
  expect(again.view()).toMatchObject({ provider: 'icloud', moving: null, account: null, state: { state: 'synced' } })
  expect((await rootState()).courses.has(id)).toBe(true)
  expect(json(inDrive(drive).get(`devices/${self}.json`))).toMatchObject({ moved_to: { provider: 'icloud' } })
  expect(existsSync(join(a.dir, 'sync', 'gdrive-token.enc'))).toBe(false)
})

test('a move waits for another device still filling the new root, and stops telling an old root it cannot reach after a week (v2.7)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(Date.UTC(2026, 10, 2, 3))
    root = new Map()
    const drive = createFakeDrive()
    vi.stubGlobal('fetch', drive.fetch)
    const a = device('mac-a', { drive })
    await a.runtime.connect('gdrive', 'merge', [])
    await a.runtime.syncNow()
    root.set('bandal.json', Buffer.from(`{"format":2,"initial_upload":"${IPAD}"}`))
    root.set(`devices/${IPAD}.json`, ipadFile(Date.now()))
    expect(await a.runtime.prepareMove('icloud')).toEqual({ status: 'uploading', device: 'iPad Pro' })
    await expect(a.runtime.move('icloud')).rejects.toThrow('다른 기기(iPad Pro)가 아직 올리고 있어요')
    expect(a.runtime.view()).toMatchObject({ provider: 'gdrive', state: { state: 'synced' } })
    // The iPad is done. Once A has moved, Google Drive stops answering: each pass tries again, for a week.
    root.set('bandal.json', Buffer.from('{"format":2}'))
    await a.runtime.move('icloud', 'upload')
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await a.runtime.syncNow()
    vi.setSystemTime(Date.UTC(2026, 10, 9, 2))
    await a.runtime.syncNow()
    expect(a.runtime.view()).toMatchObject({ provider: 'icloud', moving: 'gdrive' })
    vi.setSystemTime(Date.UTC(2026, 10, 9, 4))
    await a.runtime.syncNow()
    expect(a.runtime.view()).toMatchObject({ provider: 'icloud', moving: null })
    expect(a.log().at(-1)).toMatchObject({ step: 'move', provider: 'gdrive', outcome: expect.stringMatching(/^gave up telling the old root/) })
  } finally {
    vi.useRealTimers()
  }
})

/** Two computers on one iCloud root, both synced, with a course holding a note. */
async function bothOnICloud() {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  const a = device('mac-a', { drive }), b = device('mac-b', { drive })
  const { id: course } = a.courses.create({ name: '물리학', color: 'green' })
  writeFileSync(join(a.folder(course), '질문.md'), '# 질문\n')
  await a.runtime.connect('icloud', 'merge', [])
  await a.runtime.syncNow()
  await b.runtime.connect('icloud', 'merge', [], 'download')
  await b.runtime.syncNow()
  return { drive, a, b, course }
}
/** Google Drive answers only once let go. */
function holdDrive(drive: FakeDrive): () => void {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    await held
    return drive.fetch(input, init)
  })
  return release
}
const at = (minutes: number): number => {
  vi.setSystemTime(Date.UTC(2026, 10, 2, 3) + minutes * 60_000)
  return Date.now()
}

test('a move goes only after a last pass with the old storage went through, from either side (v2.7)', async () => {
  const { drive, a, b, course } = await bothOnICloud()
  a.courses.rename({ courseId: course, name: '물리학 II' })
  await a.runtime.syncNow()
  // A log file neither has read yet cannot be read (iCloud still downloading it): the last pass waits.
  const list = provider.list
  provider.list = async () => {
    const listed = await list()
    return { ...listed, read: async path => (path.startsWith('log/') ? Promise.reject(new Error('not downloaded yet')) : listed.read(path)) }
  }
  try {
    for (const side of [a, b]) {
      await expect(side.runtime.move('gdrive', 'upload')).rejects.toThrow('iCloud와 아직 다 맞추지 못했어요')
      expect(side.runtime.view()).toMatchObject({ provider: 'icloud', moving: null })
    }
    expect(inDrive(drive).size).toBe(0)
  } finally {
    provider.list = list
  }
  await a.runtime.move('gdrive', 'upload')
  await a.runtime.syncNow()
  expect(a.runtime.view()).toMatchObject({ provider: 'gdrive', moving: null })
})

test('a disconnect while a move is under way ends it: nothing is bound again (v2.7)', async () => {
  const { drive, a } = await bothOnICloud()
  const release = holdDrive(drive)
  const moved = a.runtime.move('gdrive', 'upload').then(() => 'moved', (error: Error) => error.message)
  await new Promise(resolve => setTimeout(resolve, 20))
  await a.runtime.disconnect()
  release()
  expect(await moved).toBe('동기화 연결이 해제돼 옮기지 않았어요.')
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(a.runtime.view()).toMatchObject({ provider: null, moving: null })
  expect(readState(join(a.dir, 'sync', 'state.json')).provider).toBeNull()
  expect(inDrive(drive).size).toBe(0)
})

test('a profile held for a backup while it moves starts the new storage held too (v2.7)', async () => {
  const { drive, a } = await bothOnICloud()
  const release = holdDrive(drive)
  const moved = a.runtime.move('gdrive', 'upload')
  await new Promise(resolve => setTimeout(resolve, 20))
  await a.runtime.pause()
  release()
  await moved
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(inDrive(drive).has('bandal.json')).toBe(false)
  a.runtime.resume()
  await a.runtime.syncNow()
  expect(json(inDrive(drive).get('bandal.json'))).toEqual({ format: 2 })
})

test('what another device changes in the old storage while the mover still uploads wins once it follows (v2.7)', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    at(0)
    const { drive, a, b, course } = await bothOnICloud()
    at(1)
    await a.runtime.move('gdrive', 'upload')
    // A's upload is slow (Google Drive held); meanwhile B, still on iCloud, renames the course.
    const release = holdDrive(drive)
    at(2)
    b.courses.rename({ courseId: course, name: '물리학 II' })
    await b.runtime.syncNow()
    at(3)
    release()
    vi.stubGlobal('fetch', drive.fetch)
    await a.runtime.syncNow()
    // A's upload carries the root as A left it, stamped from that root's clock: older than B's rename.
    const up = await mergedOf(inDrive(drive))
    expect(up.courses.get(course)!.fields.get('name')).toMatchObject({ value: '물리학' })
    expect(up.courses.get(course)!.fields.get('name')!.t).toBeLessThan(Date.UTC(2026, 10, 2, 3, 2))
    at(4)
    await b.runtime.syncNow()
    await b.runtime.move('gdrive', 'join')
    await b.runtime.syncNow()
    expect((await mergedOf(inDrive(drive))).courses.get(course)!.fields.get('name')!.value).toBe('물리학 II')
    at(5)
    await a.runtime.syncNow()
    expect(a.row('SELECT name FROM courses WHERE id = ?', course)).toEqual({ name: '물리학 II' })
    // A's own edits after its upload are stamped as usual.
    a.courses.setColor({ courseId: course, color: 'red' })
    await a.runtime.syncNow()
    expect((await mergedOf(inDrive(drive))).courses.get(course)!.fields.get('color')!.t).toBe(Date.now())
  } finally {
    vi.useRealTimers()
  }
})

for (const later of ['the mover', 'the follower'] as const) {
  test(`a note changed in both storages around a move keeps both texts, ${later} writing later (v2.7)`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      at(0)
      const { a, b, course } = await bothOnICloud()
      at(1)
      await a.runtime.move('gdrive', 'upload')
      await a.runtime.syncNow()
      const edit = async (side: ReturnType<typeof device>, line: string): Promise<void> => {
        writeFileSync(join(side.folder(course), '질문.md'), `# 질문\n${line}\n`)
        side.db.prepare("INSERT INTO sync_outbox (kind, id) VALUES ('docs', ?)").run(course)
        await side.runtime.syncNow()
      }
      const [first, second] = later === 'the mover' ? [[b, 'B가 iCloud에서 고친 줄'], [a, 'A가 Drive에서 고친 줄']] as const : [[a, 'A가 Drive에서 고친 줄'], [b, 'B가 iCloud에서 고친 줄']] as const
      at(2)
      await edit(...first)
      at(3)
      await edit(...second)
      at(4)
      await b.runtime.syncNow()
      await b.runtime.move('gdrive', 'join')
      await b.runtime.syncNow()
      at(5)
      await a.runtime.syncNow()
      await b.runtime.syncNow()
      // One text is the note, the other its conflict copy: the same on both computers, and neither lost.
      const texts = (side: ReturnType<typeof device>): string[] => readdirSync(side.folder(course)).filter(name => name.endsWith('.md'))
        .map(name => readFileSync(join(side.folder(course), name), 'utf8')).sort()
      expect(texts(b)).toEqual(['# 질문\nA가 Drive에서 고친 줄\n', '# 질문\nB가 iCloud에서 고친 줄\n'])
      expect(texts(a)).toEqual(texts(b))
    } finally {
      vi.useRealTimers()
    }
  })
}

test('a disconnect before the new storage\'s first pull applies nothing and keeps the base with the root it still describes (v2.7)', async () => {
  root = new Map()
  const drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  const a = device('mac-a', { drive }), b = device('mac-b', { drive })
  a.courses.create({ name: '물리학', color: 'green' })
  await a.runtime.connect('gdrive', 'merge', [])
  await a.runtime.syncNow()
  await b.runtime.connect('gdrive', 'merge', [], 'download')
  await b.runtime.syncNow()
  await a.runtime.move('icloud', 'upload')
  await a.runtime.syncNow()
  const left = readState(join(b.dir, 'sync', 'state.json')).root
  // B follows; its first pull in iCloud waits on reading bandal.json (the move itself reads it twice), and the person disconnects meanwhile.
  const list = provider.list
  let release!: () => void, reached!: () => void, reads = 0
  const held = new Promise<void>(resolve => { release = resolve }), reading = new Promise<void>(resolve => { reached = resolve })
  provider.list = async () => {
    const listed = await list()
    return { ...listed, read: async path => {
      if (path === 'bandal.json' && ++reads === 3) {
        reached()
        await held
      }
      return listed.read(path)
    } }
  }
  try {
    await b.runtime.move('icloud', 'join')
    const base = b.db.prepare('SELECT entity_id, field, t, device_id FROM sync_meta ORDER BY entity_id, field').all()
    await reading
    const off = b.runtime.disconnect()
    release()
    await off
    expect(reads).toBe(3)
    expect(b.db.prepare('SELECT entity_id, field, t, device_id FROM sync_meta ORDER BY entity_id, field').all()).toEqual(base)
  } finally {
    provider.list = list
  }
  expect(readState(join(b.dir, 'sync', 'state.json'))).toMatchObject({ provider: null, root: left, moving: null })
})

test('moving back to the storage it left offers this device nothing, and its own moved_to there goes (v2.7)', async () => {
  const { drive, a } = await bothOnICloud()
  const self = a.runtime.view().device.id!
  await a.runtime.move('gdrive', 'upload')
  await a.runtime.syncNow()
  expect(json(root.get(`devices/${self}.json`))).toMatchObject({ moved_to: { provider: 'drive' } })
  // Its own file in iCloud says it went to Drive until it is written again, which fails here for a while. It is never offered its own move.
  const write = provider.write
  provider.write = async (path, bytes) => (path === `devices/${self}.json` ? Promise.reject(new Error('busy')) : write(path, bytes))
  try {
    await a.runtime.move('icloud', 'join')
    await a.runtime.syncNow()
    expect(a.runtime.view()).toMatchObject({ provider: 'icloud', state: { state: 'error' }, moved: null })
    expect(a.runtime.view().devices).toEqual(expect.arrayContaining([expect.objectContaining({ id: self, moved_to: { provider: 'gdrive', t: expect.any(Number) } })]))
  } finally {
    provider.write = write
  }
  await a.runtime.syncNow()
  expect(a.runtime.view()).toMatchObject({ provider: 'icloud', moving: null, moved: null, account: null })
  expect(json(root.get(`devices/${self}.json`)).moved_to).toBeUndefined()
  expect(json(inDrive(drive).get(`devices/${self}.json`))).toMatchObject({ moved_to: { provider: 'icloud' } })
})
