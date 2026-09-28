import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ app: { once: vi.fn() }, utilityProcess: { fork: mocks.fork } }))
import { createBackgroundMaterialsWatcher } from '../../src/main/background/materialsWatcher'
class Child extends EventEmitter {
  postMessage = vi.fn()
  kill = vi.fn(() => true)
}
let children: Child[]
beforeEach(() => { vi.useFakeTimers(); children = []; mocks.fork.mockImplementation(() => { const child = new Child(); children.push(child); return child }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
function setup() {
  const onChange = vi.fn()
  const watcher = createBackgroundMaterialsWatcher({ getCourseFolder: id => `/courses/${id}`, onChange, ignoreContentChange: (_id, path) => path === 'active.wav' })
  return { watcher, onChange }
}
test('forwards document changes and structural changes while ignoring active recording churn', () => {
  const { watcher, onChange } = setup()
  watcher.watch('one')
  const child = children[0]!
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: false, paths: ['active.wav'] })
  expect(onChange).not.toHaveBeenCalled()
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: false, paths: ['active.wav', 'note.md'] })
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: true, paths: ['active.wav'] })
  expect(onChange).toHaveBeenCalledTimes(2)
  watcher.dispose()
})
test('restarts all retained watches after a worker crash and rejects late messages', async () => {
  const { watcher, onChange } = setup()
  watcher.watch('one')
  watcher.watch('two')
  const old = children[0]!
  old.emit('exit', 1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(children).toHaveLength(2)
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'two', folder: '/courses/two' })
  old.emit('message', { courseId: 'one', folder: '/courses/one', structural: true, paths: [] })
  watcher.unwatch('one')
  children[1]!.emit('message', { courseId: 'one', structural: true, paths: [] })
  expect(onChange).not.toHaveBeenCalled()
  watcher.dispose()
  children[1]!.emit('exit', 0)
  await vi.advanceTimersByTimeAsync(2000)
  expect(children).toHaveLength(2)
})
test('retries a failed launch without losing the requested course', async () => {
  mocks.fork.mockImplementationOnce(() => { throw new Error('launch failed') })
  const { watcher } = setup()
  watcher.watch('one')
  await vi.advanceTimersByTimeAsync(1000)
  expect(children[0]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  watcher.dispose()
})
