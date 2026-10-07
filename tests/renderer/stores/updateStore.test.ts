import { beforeEach, expect, test, vi } from 'vitest'
import type { UpdateStatus } from '../../../src/shared/types/update'

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(), prepare: vi.fn() }))
vi.mock('../../../src/renderer/src/features/updates/prepareUpdateInstall', () => ({ prepareUpdateInstall: ipc.prepare }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { resetUpdateStoreForTests, useUpdateStore } from '../../../src/renderer/src/stores/updateStore'

const ready: UpdateStatus = { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' }
const idle: UpdateStatus = { phase: 'idle', currentVersion: '1.0.0', lastCheckedAt: null }
let changed: (status: UpdateStatus) => void

beforeEach(() => {
  resetUpdateStoreForTests()
  vi.clearAllMocks()
  ipc.prepare.mockResolvedValue(undefined)
  ipc.onPush.mockImplementation((_channel, callback) => { changed = callback; return () => {} })
})

test('a late initial status cannot hide a downloaded update', async () => {
  let resolve!: (status: UpdateStatus) => void
  ipc.invoke.mockReturnValue(new Promise<UpdateStatus>(done => { resolve = done }))
  useUpdateStore.getState().init()
  changed(ready)
  resolve(idle)
  await Promise.resolve()
  expect(useUpdateStore.getState().status).toEqual(ready)
})

test.each(['check', 'download'] as const)('a late %s response cannot replace newer pushed progress', async action => {
  ipc.invoke.mockResolvedValue(idle)
  useUpdateStore.getState().init()
  await Promise.resolve()
  let resolve!: (status: UpdateStatus) => void
  ipc.invoke.mockReturnValue(new Promise<UpdateStatus>(done => { resolve = done }))
  const pending = useUpdateStore.getState()[action]()
  changed(ready)
  resolve(idle)
  await pending
  expect(useUpdateStore.getState().status).toEqual(ready)
})


test.each(['check', 'download'] as const)('%s is one shared flight even before main pushes a busy phase', async action => {
  let resolve!: (status: UpdateStatus) => void
  ipc.invoke.mockReturnValue(new Promise<UpdateStatus>(done => { resolve = done }))
  const first = useUpdateStore.getState()[action]()
  expect(useUpdateStore.getState()[action]()).toBe(first)
  expect(useUpdateStore.getState().pendingAction).toBe(action)
  await Promise.resolve()
  expect(ipc.invoke).toHaveBeenCalledOnce()
  resolve(ready); await first
  expect(useUpdateStore.getState().pendingAction).toBeNull()
})

test('keeps the last available version on a download error and ignores a stale rejection after a newer push', async () => {
  ipc.invoke.mockResolvedValue(idle); useUpdateStore.getState().init(); await Promise.resolve()
  changed({ phase: 'available', currentVersion: '1.0.0', version: '1.1.0', notes: null })
  let reject!: (reason: Error) => void
  ipc.invoke.mockReturnValue(new Promise<UpdateStatus>((_resolve, fail) => { reject = fail }))
  const pending = useUpdateStore.getState().download()
  await Promise.resolve(); changed(ready); reject(new Error('old request'))
  await pending
  expect(useUpdateStore.getState()).toMatchObject({ status: ready, knownVersion: '1.1.0', actionError: null })
  changed({ phase: 'error', currentVersion: '1.0.0', message: '다운로드 실패' })
  expect(useUpdateStore.getState().knownVersion).toBe('1.1.0')
  changed(idle); expect(useUpdateStore.getState().knownVersion).toBeNull()
})

test('an explicit install waits for saves, runs once, and remains disabled after main accepts', async () => {
  useUpdateStore.setState({ status: ready })
  let saved!: () => void
  ipc.prepare.mockReturnValue(new Promise<void>(resolve => { saved = resolve }))
  ipc.invoke.mockResolvedValue({ ok: true })
  const first = useUpdateStore.getState().install()
  expect(useUpdateStore.getState().install()).toBe(first)
  await Promise.resolve(); expect(ipc.invoke).not.toHaveBeenCalled()
  saved(); await first
  expect(ipc.prepare).toHaveBeenCalledOnce()
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('update:install', {})
  expect(useUpdateStore.getState().pendingAction).toBe('install')
  await useUpdateStore.getState().install()
  expect(ipc.invoke).toHaveBeenCalledOnce()
})

test('a blocked note save never reaches install IPC and permits a later explicit retry', async () => {
  useUpdateStore.setState({ status: ready })
  ipc.prepare.mockRejectedValueOnce(new Error('필기 저장 실패'))
  await useUpdateStore.getState().install()
  expect(ipc.invoke).not.toHaveBeenCalled()
  expect(useUpdateStore.getState()).toMatchObject({ pendingAction: null, actionError: '필기 저장 실패', status: ready })
  ipc.invoke.mockResolvedValue({ ok: true })
  await useUpdateStore.getState().install()
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith('update:install', {})
})

test('main refusing install leaves ready state with an actionable error, without looping', async () => {
  useUpdateStore.setState({ status: ready }); ipc.invoke.mockResolvedValue({ ok: false })
  await useUpdateStore.getState().install()
  expect(useUpdateStore.getState().pendingAction).toBeNull()
  expect(useUpdateStore.getState().actionError).toContain('업데이트를 적용하지 못했어요')
  expect(ipc.invoke).toHaveBeenCalledOnce()
})


test('a repeated ready push during save preflight cannot hide a blocked restart', async () => {
  ipc.invoke.mockResolvedValue(ready); useUpdateStore.getState().init(); await Promise.resolve()
  let failSave!: (reason: Error) => void
  ipc.prepare.mockReturnValue(new Promise<void>((_resolve, reject) => { failSave = reject }))
  const installing = useUpdateStore.getState().install()
  await Promise.resolve(); changed(ready); failSave(new Error('필기 저장 실패'))
  await installing
  expect(ipc.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(0)
  expect(useUpdateStore.getState()).toMatchObject({ status: ready, pendingAction: null, actionError: '필기 저장 실패' })
})

test.each(['check', 'download'] as const)('intermediate %s pushes do not hide a request failure', async action => {
  const available: UpdateStatus = { phase: 'available', currentVersion: '1.0.0', version: '1.1.0', notes: null }
  ipc.invoke.mockResolvedValue(available); useUpdateStore.getState().init(); await Promise.resolve()
  let reject!: (reason: Error) => void
  ipc.invoke.mockReturnValue(new Promise<UpdateStatus>((_resolve, fail) => { reject = fail }))
  const pending = useUpdateStore.getState()[action]()
  await Promise.resolve()
  const progress: UpdateStatus = action === 'check' ? { phase: 'checking', currentVersion: '1.0.0' } : { phase: 'downloading', currentVersion: '1.0.0', version: '1.1.0', percent: 25 }
  changed(progress); reject(new Error('IPC disconnected'))
  await pending
  expect(useUpdateStore.getState().status).toEqual(progress)
  expect(useUpdateStore.getState().actionError).toContain(action === 'check' ? '업데이트를 확인하지 못했어요' : '업데이트를 다운로드하지 못했어요')
})


test('a main install failure after acceptance releases the latch and permits an explicit download retry', async () => {
  ipc.invoke.mockResolvedValue(ready); useUpdateStore.getState().init(); await Promise.resolve()
  ipc.invoke.mockResolvedValue({ ok: true }); await useUpdateStore.getState().install()
  expect(useUpdateStore.getState().pendingAction).toBe('install')
  const error: UpdateStatus = { phase: 'error', currentVersion: '1.0.0', message: '설치가 실패했어요.' }
  changed(error)
  expect(useUpdateStore.getState()).toMatchObject({ status: error, pendingAction: null, knownVersion: '1.1.0' })
  ipc.invoke.mockResolvedValue(ready); await useUpdateStore.getState().download()
  expect(ipc.invoke).toHaveBeenLastCalledWith('update:download', {})
  expect(useUpdateStore.getState().pendingAction).toBeNull()
})

test('an error push before the install reply cannot be relocked by a late ok response', async () => {
  ipc.invoke.mockResolvedValue(ready); useUpdateStore.getState().init(); await Promise.resolve()
  let accept!: (result: { ok: boolean }) => void
  ipc.invoke.mockReturnValue(new Promise<{ ok: boolean }>(resolve => { accept = resolve }))
  const pending = useUpdateStore.getState().install()
  await Promise.resolve(); await Promise.resolve()
  const error: UpdateStatus = { phase: 'error', currentVersion: '1.0.0', message: '설치가 실패했어요.' }
  changed(error); accept({ ok: true }); await pending
  expect(useUpdateStore.getState()).toMatchObject({ status: error, pendingAction: null })
})


test('quit cancellation unlocks an accepted install and the same ready version can be explicitly retried once', async () => {
  ipc.invoke.mockResolvedValue(ready); useUpdateStore.getState().init(); await Promise.resolve()
  ipc.invoke.mockResolvedValue({ ok: true }); await useUpdateStore.getState().install()
  changed({ ...ready, restartCancelled: true })
  expect(useUpdateStore.getState()).toMatchObject({ pendingAction: null, knownVersion: '1.1.0' })
  expect(useUpdateStore.getState().actionError).toContain('다시 시작을 취소했어요')
  ipc.invoke.mockImplementation(async () => { changed(ready); return { ok: true } })
  const retry = useUpdateStore.getState().install()
  expect(useUpdateStore.getState().install()).toBe(retry)
  await retry
  expect(ipc.invoke.mock.calls.filter(([channel]) => channel === 'update:install')).toHaveLength(2)
  expect(useUpdateStore.getState()).toMatchObject({ pendingAction: 'install', actionError: null })
})

test('a cancelled operation late reply cannot relatch or disturb a newer explicit restart', async () => {
  ipc.invoke.mockResolvedValue(ready); useUpdateStore.getState().init(); await Promise.resolve()
  const accepts: Array<(value: { ok: boolean }) => void> = []
  ipc.invoke.mockImplementation(() => {
    if (accepts.length > 0) changed(ready)
    return new Promise<{ ok: boolean }>(resolve => { accepts.push(resolve) })
  })
  const old = useUpdateStore.getState().install(); await Promise.resolve(); await Promise.resolve()
  changed({ ...ready, restartCancelled: true })
  expect(useUpdateStore.getState().pendingAction).toBeNull()
  const retry = useUpdateStore.getState().install(); await Promise.resolve(); await Promise.resolve()
  expect(accepts).toHaveLength(2)
  accepts[0]!({ ok: true }); await old
  expect(useUpdateStore.getState().pendingAction).toBe('install')
  expect(useUpdateStore.getState().install()).toBe(retry)
  accepts[1]!({ ok: true }); await retry
  expect(useUpdateStore.getState().pendingAction).toBe('install')
})
