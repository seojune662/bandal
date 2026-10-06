// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChatEventBatch } from '../../src/shared/ipc/events'

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

async function fixture() {
  const { adapter } = await import('../../web-demo/adapter')
  const { courseId, NOTE } = await import('../../web-demo/state')
  return { adapter, courseId, NOTE }
}

test('deleting a conversation cancels its scheduled answer instead of recreating it', async () => {
  const { adapter, courseId } = await fixture()
  await adapter.invoke('chat:send', { courseId, sessionId: 'deleted', content: 'Question' })
  await adapter.invoke('chat:deleteConversation', { courseId, sessionId: 'deleted' })
  await vi.advanceTimersByTimeAsync(600)
  expect((await adapter.invoke('chat:conversations', { courseId })).conversations).toEqual([])
})

test('duplicate send is rejected and event sequences are independent per conversation', async () => {
  const { adapter, courseId } = await fixture()
  const batches: ChatEventBatch[] = []
  adapter.on('chat:event-batch', value => batches.push(value))
  await adapter.invoke('chat:send', { courseId, sessionId: 'one', content: 'Question 1' })
  await expect(adapter.invoke('chat:send', { courseId, sessionId: 'one', content: 'Duplicate' })).rejects.toThrow('완료하거나')
  await adapter.invoke('chat:send', { courseId, sessionId: 'two', content: 'Question 2' })
  await vi.advanceTimersByTimeAsync(600)
  await adapter.invoke('chat:send', { courseId, sessionId: 'one', content: 'Question 3' })
  await vi.advanceTimersByTimeAsync(600)
  expect(batches.map(({ sessionId, seq }) => [sessionId, seq])).toEqual([['one', 1], ['two', 1], ['one', 2]])
})

test('a delayed save cannot recreate a deleted note and same-name rename remains stable', async () => {
  const { adapter, courseId, NOTE } = await fixture()
  expect((await adapter.invoke('notes:rename', { courseId, relPath: NOTE, newName: NOTE })).relPath).toBe(NOTE)
  await adapter.invoke('materials:delete', { courseId, relPath: NOTE })
  await expect(adapter.invoke('notes:write', { courseId, relPath: NOTE, markdown: 'stale' })).rejects.toThrow('찾을 수')
  await expect(adapter.invoke('notes:read', { courseId, relPath: NOTE })).rejects.toThrow('찾을 수')
})

test('a browser quota failure ends the pending demo turn with a visible error', async () => {
  const { adapter, courseId } = await fixture()
  const batches: ChatEventBatch[] = []
  adapter.on('chat:event-batch', value => batches.push(value))
  await adapter.invoke('chat:send', { courseId, sessionId: 'quota', content: 'Question' })
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  try {
    await vi.advanceTimersByTimeAsync(600)
    expect(batches[0]?.events).toMatchObject([{ type: 'error' }, { type: 'turn-complete', stopReason: 'error' }])
  } finally { storage.mockRestore() }
})
