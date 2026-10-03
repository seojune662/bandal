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

function acknowledge(child: Child, action: 'pause' | 'resume') {
  const command = child.postMessage.mock.calls.map(([value]) => value as { action: string; requestId: number; folder?: string }).findLast(value => value.action === action)!
  expect(command).toBeDefined()
  child.emit('message', { requestId: command.requestId })
  return command
}

test('nested pauses require the worker close ACK and restore only after the final token', async () => {
  const { watcher, onChange } = setup()
  watcher.watch('one')
  watcher.watch('two')
  const child = children[0]!
  let resolved = false
  const first = watcher.pause('one').then(token => { resolved = true; return token })
  const second = watcher.pause('one')
  await Promise.resolve()
  expect(resolved).toBe(false)
  expect(child.postMessage.mock.calls.filter(([value]) => value.action === 'pause')).toHaveLength(1)
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: true, paths: [] })
  child.emit('message', { courseId: 'two', folder: '/courses/two', structural: true, paths: [] })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('two', expect.anything())
  acknowledge(child, 'pause')
  const [resumeFirst, resumeSecond] = await Promise.all([first, second])
  await resumeFirst()
  expect(child.postMessage.mock.calls.some(([value]) => value.action === 'resume')).toBe(false)
  const restoring = resumeSecond()
  acknowledge(child, 'resume')
  await restoring
  await resumeSecond()
  expect(child.postMessage.mock.calls.filter(([value]) => value.action === 'resume')).toHaveLength(1)
  expect(child.kill).not.toHaveBeenCalled()
  watcher.dispose()
})

test.each(['before', 'during'] as const)('unwatch %s a pause drains the watch and releases its token without reattaching it', async (timing) => {
  const { watcher, onChange } = setup()
  watcher.watch('one')
  const child = children[0]!
  if (timing === 'before') watcher.unwatch('one')
  const paused = watcher.pause('one')
  acknowledge(child, 'pause')
  const resume = await paused
  if (timing === 'during') watcher.unwatch('one')
  const restore = resume()
  expect(acknowledge(child, 'resume').folder).toBeUndefined()
  await restore
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: true, paths: [] })
  expect(onChange).not.toHaveBeenCalled()
  watcher.watch('one')
  expect(child.postMessage).toHaveBeenLastCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  child.emit('message', { courseId: 'one', folder: '/courses/one', structural: true, paths: [] })
  expect(onChange).toHaveBeenCalledTimes(1)
  watcher.dispose()
})

test('worker restart excludes a successfully paused course until it is resumed', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  watcher.watch('two')
  const old = children[0]!
  const paused = watcher.pause('one')
  acknowledge(old, 'pause')
  const resume = await paused
  old.emit('exit', 1)
  await vi.advanceTimersByTimeAsync(1000)
  const fresh = children[1]!
  expect(fresh.postMessage.mock.calls.filter(([value]) => value.action === 'watch')).toEqual([[{ action: 'watch', courseId: 'two', folder: '/courses/two' }]])
  const restoring = resume()
  expect(acknowledge(fresh, 'resume').folder).toBe('/courses/one')
  await restoring
  watcher.dispose()
})

test('a lost close ACK aborts the pause and retires the worker before any replacement can reopen handles', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  watcher.watch('two')
  const old = children[0]!
  const paused = watcher.pause('one')
  const rejected = expect(paused).rejects.toThrow('핸들 해제')
  await vi.advanceTimersByTimeAsync(5000)
  await rejected
  expect(old.kill).toHaveBeenCalledTimes(1)
  await expect(watcher.pause('one')).rejects.toThrow('종료를 기다리고')
  await vi.advanceTimersByTimeAsync(1000)
  expect(children).toHaveLength(1)
  old.emit('exit', 0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(children).toHaveLength(2)
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'two', folder: '/courses/two' })
  watcher.dispose()
})

test('worker exit during close rejects the mutation guard and retains desired watches for recovery', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  const old = children[0]!
  const paused = watcher.pause('one')
  const rejected = expect(paused).rejects.toThrow('감시 프로세스가 종료')
  old.emit('exit', 1)
  await rejected
  const fresh = children[1]!
  expect(fresh.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  acknowledge(fresh, 'resume')
  watcher.dispose()
})

test('failed initial watch replay cannot leave an untracked live worker holding directory handles', async () => {
  const { watcher } = setup()
  mocks.fork.mockImplementationOnce(() => {
    const child = new Child()
    child.postMessage.mockImplementation(() => { throw new Error('channel lost') })
    children.push(child)
    return child
  })
  watcher.watch('one')
  const failed = children[0]!
  expect(failed.kill).toHaveBeenCalledTimes(1)
  await expect(watcher.pause('one')).rejects.toThrow('종료를 기다리고')
  failed.emit('exit', 0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  watcher.dispose()
})

test('an explicit native close failure rejects the guard and retires possibly leaked handles', async () => {
  const { watcher } = setup()
  watcher.watch('one')
  const failed = children[0]!
  const pause = watcher.pause('one')
  const rejected = expect(pause).rejects.toThrow('native close failed')
  const command = failed.postMessage.mock.calls.map(([value]) => value as { action: string; requestId: number }).findLast(value => value.action === 'pause')!
  failed.emit('message', { requestId: command.requestId, error: 'native close failed' })
  await rejected
  expect(failed.kill).toHaveBeenCalledTimes(1)
  await expect(watcher.pause('one')).rejects.toThrow('종료를 기다리고')
  failed.emit('exit', 0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(children[1]!.postMessage).toHaveBeenCalledWith({ action: 'watch', courseId: 'one', folder: '/courses/one' })
  watcher.dispose()
})
