import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ watch: vi.fn() }))
vi.mock('chokidar', () => ({ watch: mocks.watch }))
import { createMaterialsWatcher } from '../../src/main/features/materials/watcher'

class NativeWatch extends EventEmitter {
  close = vi.fn<() => Promise<void>>().mockResolvedValue()
}
let watches: NativeWatch[]
beforeEach(() => {
  vi.useFakeTimers()
  watches = []
  mocks.watch.mockReset().mockImplementation(() => {
    const watcher = new NativeWatch()
    watches.push(watcher)
    return watcher
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }
function setup() {
  const onChange = vi.fn()
  return { onChange, watcher: createMaterialsWatcher({ getCourseFolder: id => `/courses/${id}`, onChange }) }
}

test('nested pauses await actual native close and resume only the affected active course', async () => {
  const { watcher, onChange } = setup()
  watcher.watch('one')
  watcher.watch('two')
  await tick()
  const first = watches[0]!
  let close!: () => void
  first.close.mockImplementation(() => new Promise(resolve => { close = resolve }))
  let resolved = false
  const firstPause = watcher.pause('one').then(token => { resolved = true; return token })
  const secondPause = watcher.pause('one')
  watcher.watch('one')
  first.emit('all', 'add', '/courses/one/late.md')
  await tick()
  expect(resolved).toBe(false)
  expect(first.close).toHaveBeenCalledTimes(1)
  expect(watches[1]!.close).not.toHaveBeenCalled()
  expect(mocks.watch).toHaveBeenCalledTimes(2)
  close()
  const [resumeFirst, resumeSecond] = await Promise.all([firstPause, secondPause])
  await resumeFirst()
  expect(mocks.watch).toHaveBeenCalledTimes(2)
  await resumeSecond()
  await resumeSecond()
  expect(mocks.watch).toHaveBeenCalledTimes(3)
  first.emit('all', 'add', '/courses/one/stale.md')
  watches[2]!.emit('all', 'add', '/courses/one/current.md')
  await vi.advanceTimersByTimeAsync(300)
  expect(onChange).toHaveBeenCalledExactlyOnceWith('one', { structural: true, paths: ['current.md'] })
  watcher.dispose()
})

test('unwatch during a pause prevents restoration while later rewatch still works', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  await tick()
  const resume = await watcher.pause('one')
  watcher.unwatch('one')
  await resume()
  expect(mocks.watch).toHaveBeenCalledTimes(1)
  watcher.watch('one')
  await tick()
  expect(mocks.watch).toHaveBeenCalledTimes(2)
  const laterResume = await watcher.pause('one')
  watcher.dispose()
  await laterResume()
  expect(mocks.watch).toHaveBeenCalledTimes(2)
})

test('pause also drains a native close already started by unwatch', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  await tick()
  let close!: () => void
  watches[0]!.close.mockImplementation(() => new Promise(resolve => { close = resolve }))
  watcher.unwatch('one')
  let resolved = false
  const pause = watcher.pause('one').then(token => { resolved = true; return token })
  await tick()
  expect(resolved).toBe(false)
  close()
  await (await pause)()
  expect(mocks.watch).toHaveBeenCalledTimes(1)
})
