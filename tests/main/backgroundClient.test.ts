import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ app: { once: vi.fn() }, utilityProcess: { fork: mocks.fork } }))
import { createBackgroundClient } from '../../src/main/background/client'
class Child extends EventEmitter {
  sent: { id: number; kind: string }[] = []
  kill = vi.fn(() => true)
  postMessage(message: { id: number; kind: string }): void { this.sent.push(message) }
  reply(value: unknown): void { this.emit('message', { id: this.sent.at(-1)!.id, value }) }
}
let children: Child[]
beforeEach(() => { vi.useFakeTimers(); children = []; mocks.fork.mockImplementation(() => { const child = new Child(); children.push(child); return child }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
test('interactive queries precede queued indexing while only one job runs', async () => {
  const client = createBackgroundClient()
  const scan = client.request('scan', { folder: '/tmp/course', limits: { maxDepth: 12, maxEntries: 100 } })
  const refresh = client.request('searchRefresh', { dbPath: '/tmp/db', courseId: 'c', folder: '/tmp/course' }, 2)
  const query = client.request('searchQuery', { dbPath: '/tmp/db', courseId: 'c', folder: '/tmp/course', query: 'a' }, 0)
  const child = children[0]!
  expect(child.sent).toHaveLength(1)
  child.reply({ nodes: [], files: [], truncation: new Set() })
  await scan
  expect(child.sent.at(-1)!.kind).toBe('searchQuery')
  child.reply([])
  await query
  expect(child.sent.at(-1)!.kind).toBe('searchRefresh')
  child.reply(null)
  await refresh
  client.dispose()
})
test('a crashed worker rejects its request and the next request starts a fresh worker', async () => {
  const client = createBackgroundClient()
  const pending = client.request('migrate', { dbPath: '/tmp/db' })
  const assertion = expect(pending).rejects.toThrow('종료')
  children[0]!.emit('exit', 1)
  await assertion
  const retry = client.request('migrate', { dbPath: '/tmp/db' })
  expect(children).toHaveLength(2)
  children[1]!.reply(null)
  await expect(retry).resolves.toBeNull()
  client.dispose()
})
test('a hung filesystem times out instead of stranding every caller', async () => {
  const client = createBackgroundClient()
  const pending = client.request('migrate', { dbPath: '/tmp/db' })
  const assertion = expect(pending).rejects.toThrow('초과')
  vi.advanceTimersByTime(60_000)
  await assertion
  expect(children[0]!.kill).toHaveBeenCalled()
  client.dispose()
})
test('a synchronous fork failure rejects and removes the job before retry', async () => {
  mocks.fork.mockImplementationOnce(() => { throw new Error('fork failed') })
  const client = createBackgroundClient()
  await expect(client.request('migrate', { dbPath: '/tmp/db' })).rejects.toThrow('fork failed')
  const retry = client.request('migrate', { dbPath: '/tmp/db' })
  expect(children[0]!.sent).toHaveLength(1)
  children[0]!.reply(null)
  await expect(retry).resolves.toBeNull()
  expect(children[0]!.sent).toHaveLength(1)
  client.dispose()
})
test('a synchronous send failure clears the timer and allows a new worker', async () => {
  const child = new Child()
  vi.spyOn(child, 'postMessage').mockImplementationOnce(() => { throw new Error('send failed') })
  mocks.fork.mockReturnValueOnce(child)
  const client = createBackgroundClient()
  await expect(client.request('migrate', { dbPath: '/tmp/db' })).rejects.toThrow('send failed')
  expect(child.kill).toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  const retry = client.request('migrate', { dbPath: '/tmp/db' })
  children[0]!.reply(null)
  await expect(retry).resolves.toBeNull()
  client.dispose()
})
