import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import type { MetaEvent } from '../../../src/main/features/sync/format'
import type { SyncProvider } from '../../../src/main/features/sync/icloud'
import { readState } from '../../../src/main/features/sync/identity'
import { repointSyncDocs, type Scan } from '../../../src/main/features/sync/localDocs'
import { readMerged } from '../../../src/main/features/sync/pull'
import { createSyncRuntime, profileBoundElsewhere } from '../../../src/main/features/sync/runtime'
import { createTestDb, type TestDb } from '../helpers/testDb'

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

function device(machine: string, options: { boundElsewhere?: string; made?: { ok: boolean; cancelled?: boolean } } = {}) {
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
  const runtime = createSyncRuntime({
    db: ctx.db, courses, materials, userDataPath: ctx.dir, appVersion: 'test', provider, machine: async () => machine,
    scan: async folder => walk(folder), changed: () => {}, onView: () => {},
    boundElsewhere: () => options.boundElsewhere ?? null,
    newProfile: async seed => {
      seeds.push(seed)
      return options.made ?? { ok: true }
    }
  })
  runtimes.push(runtime)
  const row = (sql: string, ...params: unknown[]) => ctx.db.prepare(sql).get(...params) as Record<string, any> | undefined
  return { db: ctx.db, dir: ctx.dir, courses, runtime, seeds, row, folder: (id: string) => courses.getFolder(id) }
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
  expect(await a.runtime.prepare()).toEqual({ status: 'ready', plan: { kind: 'upload', local: { courses: 1, docs: 1 }, remote: { courses: 0, docs: 0 }, pairs: [] } })
  await a.runtime.connect('merge', [])
  await a.runtime.syncNow()
  expect(Buffer.from(root.get('bandal.json')!).toString('utf8')).toBe('{"format":2}')
  expect(a.runtime.view()).toMatchObject({ provider: 'icloud', state: { state: 'synced' }, pending: 0 })
  expect((await rootState()).courses.has(id)).toBe(true)
})

test('an empty profile takes everything from the root', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  expect(await b.runtime.prepare()).toMatchObject({ status: 'ready', plan: { kind: 'download', local: { courses: 0, docs: 0 }, remote: { courses: 1, docs: 2 } } })
  await b.runtime.connect('merge', [])
  await b.runtime.syncNow()
  expect(b.row('SELECT name FROM courses WHERE id = ?', COURSE)).toEqual({ name: '선형대수학' })
  expect(existsSync(join(b.folder(COURSE), '강의자료/1주차 벡터.pdf'))).toBe(true)
})

test('a merge joins a same-name course under its own id and takes its same PDF as the remote document', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: ' 선형대수학 ', color: 'pink' })
  writeFileSync(join(b.folder(id), '1주차.pdf'), PDF)
  writeFileSync(join(b.folder(id), 'B에만 있는 노트.md'), '# B\n')
  const prepared = await b.runtime.prepare()
  expect(prepared).toMatchObject({ status: 'ready', plan: { kind: 'choose', pairs: [{ local: id, remote: COURSE }] } })
  await b.runtime.connect('merge', [{ local: id, remote: COURSE }])
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
  await b.runtime.connect('overwrite', [])
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
  await a.runtime.connect('merge', [])
  await a.runtime.syncNow()
  a.runtime.disconnect()
  expect(readState(join(a.dir, 'sync', 'state.json')).provider).toBeNull()
  expect(await a.runtime.prepare()).toMatchObject({ status: 'ready', plan: { kind: 'resume' } })
  const c = device('mac-c')
  c.courses.create({ name: '화학', color: 'red' })
  await c.runtime.connect('import', [])
  expect(c.seeds).toEqual([{ provider: 'icloud' }])
  expect(c.runtime.view().provider).toBeNull()
})

test('a new profile releases a bound one, and leaves no sync state in an unbound one', async () => {
  root = new Map()
  const a = device('mac-a')
  a.runtime.release()
  expect(existsSync(join(a.dir, 'sync'))).toBe(false)
  await a.runtime.connect('merge', [])
  a.runtime.release()
  expect(readState(join(a.dir, 'sync', 'state.json')).provider).toBeNull()
})

test('a root another profile here is bound to is refused, and a device name goes to its devices file', async () => {
  root = new Map()
  const other = device('mac-a', { boundElsewhere: '기본 프로필' })
  await expect(other.runtime.connect('merge', [])).rejects.toThrow('기본 프로필과 연결돼 있어요')
  const a = device('mac-a')
  await a.runtime.connect('merge', [])
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
  await a.runtime.connect('merge', [])
  await a.runtime.syncNow()
  await a.runtime.disconnect()
  root = new Map()
  expect(await a.runtime.prepare()).toMatchObject({ status: 'ready', plan: { kind: 'upload' } })
  await a.runtime.connect('merge', [], 'upload')
  await a.runtime.syncNow()
  expect((await rootState()).courses.get(id)?.fields.get('name')?.value).toBe('물리학')
})

test('a merge takes only the pairs the plan offered, each course once, and a plan that changed is refused', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: '선형대수학', color: 'pink' })
  const { id: other } = b.courses.create({ name: '물리학', color: 'red' })
  await expect(b.runtime.connect('merge', [], 'upload')).rejects.toThrow('다시 확인해 주세요')
  expect(b.runtime.view().provider).toBeNull()
  await b.runtime.connect('merge', [{ local: id, remote: COURSE }, { local: other, remote: COURSE }, { local: other, remote: 'c9999999-0000-4000-8000-000000000009' }], 'choose')
  expect(b.db.prepare('SELECT local_id, remote_id FROM sync_alias').all()).toEqual([{ local_id: id, remote_id: COURSE }])
})

test('a merge that fails half way leaves nothing behind, so the next connect asks again', async () => {
  root = fixture('01-basic')
  const b = device('mac-b')
  const { id } = b.courses.create({ name: '선형대수학', color: 'pink' })
  b.db.exec("CREATE TRIGGER fail_alias BEFORE INSERT ON sync_alias BEGIN SELECT RAISE(ABORT, 'disk full'); END")
  await expect(b.runtime.connect('merge', [{ local: id, remote: COURSE }], 'choose')).rejects.toThrow('disk full')
  b.db.exec('DROP TRIGGER fail_alias')
  expect(b.runtime.view().provider).toBeNull()
  expect(b.row('SELECT COUNT(*) AS n FROM sync_meta')).toEqual({ n: 0 })
  expect(await b.runtime.prepare()).toMatchObject({ plan: { kind: 'choose' } })
})

test('an import a person cancels changes nothing; one that fails says so', async () => {
  root = fixture('01-basic')
  const cancelled = device('mac-a', { made: { ok: false, cancelled: true } })
  await cancelled.runtime.connect('import', [])
  const failed = device('mac-b', { made: { ok: false, cancelled: false } })
  await expect(failed.runtime.connect('import', [])).rejects.toThrow('새 프로필을 만들지 못했어요')
})

test('another profile bound to iCloud is named by when it was made; the open one does not count', () => {
  const base = mkdtempSync(join(tmpdir(), 'bandal-profiles-'))
  try {
    const profile = join(base, 'profiles', 'p1')
    mkdirSync(join(profile, 'sync'), { recursive: true })
    writeFileSync(join(profile, 'isolated-profile.json'), JSON.stringify({ id: 'p1', createdAt: '2026-11-01T09:00:00.000Z' }))
    expect(profileBoundElsewhere(base, base)).toBeNull()
    writeFileSync(join(profile, 'sync', 'state.json'), JSON.stringify({ provider: 'icloud' }))
    expect(profileBoundElsewhere(base, base)).toBe('2026-11-01에 만든 프로필')
    expect(profileBoundElsewhere(base, profile)).toBeNull()
    mkdirSync(join(base, 'sync'))
    writeFileSync(join(base, 'sync', 'state.json'), JSON.stringify({ provider: 'icloud' }))
    expect(profileBoundElsewhere(base, profile)).toBe('기본 프로필')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
