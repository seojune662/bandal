import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { Database } from 'better-sqlite3'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), getSession: vi.fn(), writeFileSync: vi.fn() }))
vi.mock('electron', () => ({ app: { on: vi.fn(), off: vi.fn(), getAppPath: () => '/app', isPackaged: false }, dialog: {}, Menu: { getApplicationMenu: () => null }, shell: {} }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(),
  existsSync: () => true, mkdirSync: vi.fn(), writeFileSync: mocks.writeFileSync, unlinkSync: vi.fn(), readFileSync: () => { throw new Error('not found') } }))
vi.mock('../../../src/main/features/account/config', () => ({ readSupabaseConfig: () => ({ url: 'https://example.invalid', publishableKey: 'test' }) }))
import { IPadCompanion } from '../../../src/main/features/ipadSync/runtime'
Object.defineProperty(process, 'resourcesPath', { value: '/resources', configurable: true })

type Internal = { prepareGeometry(exchange: string): Promise<void>; perform(command: string, exchange: string, extra?: string[]): Promise<Array<Record<string, unknown>>>; boundUserID: string | null }
const instances: IPadCompanion[] = []
afterEach(() => { instances.splice(0).forEach(instance => instance.dispose()); vi.clearAllMocks(); vi.unstubAllEnvs() })
function fixture() {
  const runtime = new IPadCompanion({ db: { prepare: () => ({ all: () => [], get: () => undefined }) } as unknown as Database,
    userDataPath: '/profile', getClient: () => ({ auth: { getSession: mocks.getSession } }) as never, changed: vi.fn() })
  const internals = runtime as unknown as Internal
  internals.boundUserID = '11111111-1111-4111-8111-111111111111'
  instances.push(runtime)
  return { runtime, internals }
}
function child() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(), exitCode: null, signalCode: null, pid: 42 }) as unknown as ChildProcess
}

test('pause drains geometry work and prevents spawning a helper after logout', async () => {
  const f = fixture()
  let release!: () => void
  vi.spyOn(f.internals, 'prepareGeometry').mockImplementation(() => new Promise(resolve => { release = resolve }))
  const operation = f.internals.perform('cycle', '/exchange').catch(error => error)
  let drained = false
  const waiting = f.runtime.pauseAndDrain().then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  release()
  expect(await operation).toBeInstanceOf(Error)
  await waiting
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('a previous pause retains the process until later backup drain sees its exit', async () => {
  const f = fixture(), process = child()
  mocks.spawn.mockReturnValue(process)
  vi.spyOn(f.internals, 'prepareGeometry').mockResolvedValue()
  const operation = f.internals.perform('cycle', '/exchange').catch(error => error)
  await Promise.resolve()
  expect(mocks.spawn).toHaveBeenCalledOnce()
  f.runtime.pause()
  expect(process.kill).not.toHaveBeenCalled()
  expect(mocks.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/cancel-.*\.flag$/), 'cancelled', { mode: 0o600 })
  let drained = false
  const waiting = f.runtime.pauseAndDrain().then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  process.emit('exit', 0)
  process.emit('close', 0)
  await operation
  await waiting
  expect(drained).toBe(true)
})

test('account sync is retired unless the legacy flag is set', async () => {
  const f = fixture()
  expect(f.runtime.state()).toMatchObject({ available: false, enabled: false })
  await expect(f.runtime.setEnabled(true)).rejects.toThrow('계정 동기화는 종료됐습니다')
  await expect(f.runtime.synchronize(true)).rejects.toThrow('계정 동기화는 종료됐습니다')
  expect(f.runtime.enabled).toBe(false)
  expect(mocks.getSession).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('a session read that completes after pause never starts a sync cycle', async () => {
  vi.stubEnv('BANDAL_LEGACY_IPAD_SYNC', '1')
  const f = fixture()
  f.runtime.enabled = true
  let release!: (value: unknown) => void
  mocks.getSession.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const perform = vi.spyOn(f.internals, 'perform')
  const sync = f.runtime.synchronize()
  await f.runtime.pauseAndDrain()
  release({ data: { session: { user: { id: f.internals.boundUserID }, access_token: 'test' } }, error: null })
  await sync
  expect(perform).not.toHaveBeenCalled()
  expect(mocks.spawn).not.toHaveBeenCalled()
})

test('local pending ink can be listed and recovered before sync account binding', async () => {
  const f = fixture()
  f.internals.boundUserID = null
  const id = 'pending-ink:11111111-1111-4111-8111-111111111111'
  const perform = vi.spyOn(f.internals, 'perform').mockResolvedValue([{ conflicts: [{ id, kind: 'pending-ink' }], status: { conflicts: 1 } }])
  expect(await f.runtime.conflicts()).toEqual([{ id, kind: 'pending-ink' }])
  expect(perform).toHaveBeenCalledWith('conflicts', '/profile/ipad-companion/offline')
  await f.runtime.resolveConflict(id, 'local')
  expect(perform).toHaveBeenCalledWith('resolve-conflict', '/profile/ipad-companion/offline', ['--conflict-id', id, '--choice', 'local'])
})

test('UTF-8 conflict JSON survives byte-split stdout and data arriving after exit', async () => {
  const f = fixture(), process = child()
  mocks.spawn.mockReturnValue(process)
  const operation = f.internals.perform('conflicts', '/exchange')
  const report = { conflicts: [{ label: '한글 노트 📝', reason: '변경된 페이지 필기' }], status: { conflicts: 1 } }
  const bytes = Buffer.from(JSON.stringify(report) + '\n', 'utf8')
  for (const byte of bytes.subarray(0, bytes.length - 2)) (process.stdout as PassThrough).write(Buffer.from([byte]))
  process.emit('exit', 0)
  let completed = false
  void operation.then(() => { completed = true })
  await Promise.resolve()
  expect(completed).toBe(false)
  ;(process.stdout as PassThrough).end(bytes.subarray(bytes.length - 2))
  process.emit('close', 0)
  expect(await operation).toEqual([report])
})

test('UTF-8 diagnostic text survives byte-split stderr', async () => {
  const f = fixture(), process = child()
  mocks.spawn.mockReturnValue(process)
  const operation = f.internals.perform('conflicts', '/exchange').catch(error => error)
  const detail = '자료 작업이 중단되었습니다. 대기 중인 필기 📝는 보관됩니다.'
  for (const byte of Buffer.from(detail, 'utf8')) (process.stderr as PassThrough).write(Buffer.from([byte]))
  ;(process.stderr as PassThrough).end()
  process.emit('exit', 1)
  process.emit('close', 1)
  expect((await operation as Error).message).toBe(detail)
})
