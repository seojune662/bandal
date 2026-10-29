import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ app: { once: vi.fn() }, utilityProcess: { fork: mocks.fork } }))
import { createPdfSearchClient } from '../../../src/main/features/search/pdfSearchClient'
import type { ContentSearchIndexStatus } from '../../../src/shared/types/search'
class Child extends EventEmitter {
  sent: Array<{id: number; request: unknown}> = []
  kill = vi.fn()
  postMessage(value: {id: number; request: unknown}): void { this.sent.push(value) }
  reply(status: ContentSearchIndexStatus, done = false): void { this.emit('message', { id: this.sent.at(-1)!.id, status, done }) }
}
let children: Child[]
const request = { dbPath: '/tmp/cache', courseId: 'c', folder: '/tmp/course', rootRelPath: '' }
const progress = (indexedPages: number): ContentSearchIndexStatus => ({ phase: 'indexing', totalFiles: 1, processedFiles: 0, indexedPages, failures: [] })
beforeEach(() => { vi.useFakeTimers(); children = []; mocks.fork.mockImplementation(() => { const child = new Child(); children.push(child); return child }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
test('uses an independent worker and progress permits PDFs taking longer than sixty seconds', () => {
  const changed = vi.fn(), client = createPdfSearchClient(changed)
  expect(client.refresh(request).phase).toBe('indexing')
  expect(mocks.fork.mock.calls[0]![0]).toContain('pdfSearchHost.js')
  for (let page = 1; page <= 5; page++) { vi.advanceTimersByTime(40_000); children[0]!.reply(progress(page)); client.refresh(request) }
  expect(children[0]!.kill).not.toHaveBeenCalled()
  expect(children[0]!.sent).toHaveLength(1)
  children[0]!.reply({ ...progress(5), phase: 'ready', processedFiles: 1 }, true)
  expect(client.refresh(request).phase).toBe('ready')
  expect(children[0]!.sent).toHaveLength(1)
  client.dispose()
})
test('repeated unchanged progress does not create search change loops', () => {
  const changed = vi.fn(), client = createPdfSearchClient(changed)
  client.refresh(request)
  children[0]!.reply(progress(1))
  changed.mockClear()
  vi.advanceTimersByTime(1000)
  children[0]!.reply(progress(1))
  expect(changed).not.toHaveBeenCalled()
  client.dispose()
})
test('a stalled extraction reports partial results and a course relink kills the old writer', () => {
  const client = createPdfSearchClient(vi.fn())
  client.refresh(request)
  vi.advanceTimersByTime(60_000)
  expect(children[0]!.kill).toHaveBeenCalled()
  expect(client.refresh(request).phase).toBe('partial')
  vi.advanceTimersByTime(10_000)
  client.refresh(request)
  client.refresh({ ...request, folder: '/tmp/relinked' })
  expect(children[1]!.kill).toHaveBeenCalled()
  expect(children).toHaveLength(3)
  client.dispose()
})
test('file changes bypass the cooldown and changes during extraction schedule one follow-up', () => {
  const client = createPdfSearchClient(vi.fn())
  client.refresh(request)
  children[0]!.reply({ ...progress(1), phase: 'ready', processedFiles: 1 }, true)
  client.invalidate('c')
  expect(children[0]!.sent).toHaveLength(2)
  client.invalidate('c'); client.invalidate('c')
  expect(children[0]!.sent).toHaveLength(2)
  children[0]!.reply({ ...progress(2), phase: 'ready', processedFiles: 1 }, true)
  expect(children[0]!.sent).toHaveLength(3)
  children[0]!.reply({ ...progress(2), phase: 'ready', processedFiles: 1 }, true)
  expect(children[0]!.sent).toHaveLength(3)
  client.dispose()
})
