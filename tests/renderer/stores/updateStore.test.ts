import { beforeEach, expect, test, vi } from 'vitest'
import type { UpdateStatus } from '../../../src/shared/types/update'

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { resetUpdateStoreForTests, useUpdateStore } from '../../../src/renderer/src/stores/updateStore'

const ready: UpdateStatus = { phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' }
const idle: UpdateStatus = { phase: 'idle', currentVersion: '1.0.0', lastCheckedAt: null }
let changed: (status: UpdateStatus) => void

beforeEach(() => {
  resetUpdateStoreForTests()
  vi.clearAllMocks()
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
