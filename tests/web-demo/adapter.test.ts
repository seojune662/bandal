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

test('native print menu state updates do not display an unsupported-action notice', async () => {
  const { adapter } = await fixture()
  const unavailable = vi.fn()
  window.addEventListener('bandal-demo-unavailable', unavailable)
  try {
    await expect(adapter.invoke('window:setPrintEnabled', { enabled: true })).resolves.toEqual({ ok: true })
    await expect(adapter.invoke('window:setPrintEnabled', { enabled: false })).resolves.toEqual({ ok: true })
    expect(unavailable).not.toHaveBeenCalled()
  } finally { window.removeEventListener('bandal-demo-unavailable', unavailable) }
})

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

test('renaming a note in another course preserves the default scene and returns the saved heading', async () => {
  const { adapter, courseId, NOTE } = await fixture()
  const renamed = await adapter.invoke('notes:rename', { courseId: 'demo-course-1', relPath: NOTE, newName: 'Operating systems.MD' })
  const { data, key } = await import('../../web-demo/state')
  expect(data.primaryNotePath).toBe(NOTE)
  expect(data.notes[key(courseId, data.primaryNotePath!)]).toBeDefined()
  expect(renamed.title).toBe('Operating systems')
  expect(renamed.markdown.startsWith('# Operating systems\n')).toBe(true)
  expect((await adapter.invoke('notes:read', { courseId: 'demo-course-1', relPath: renamed.relPath })).markdown).toBe(renamed.markdown)
})

test('switching back to linked notes follows their renamed path', async () => {
  const { adapter, courseId } = await fixture()
  const { PAGE_NOTE, currentPageNoteDescriptor } = await import('../../web-demo/state')
  const renamed = await adapter.invoke('notes:rename', { courseId, relPath: PAGE_NOTE, newName: 'My linked notes' })
  expect(currentPageNoteDescriptor().payload.relPath).toBe(renamed.relPath)
  expect((await adapter.invoke('notes:read', currentPageNoteDescriptor().payload)).markdown).toBe(renamed.markdown)
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

test('export recovers all courses and the complete live draft without requiring browser storage', async () => {
  const { adapter, courseId, NOTE } = await fixture()
  const { notesMarkdownForExport } = await import('../../web-demo/adapter')
  const { registerOpenNoteSession } = await import('../../src/renderer/src/features/notes/noteSessionRegistry')
  await adapter.invoke('notes:create', { courseId: 'demo-course-1', title: 'Other course note' })
  const markdown = '# Unsaved\n' + 'complete text '.repeat(2000)
  const flush = vi.fn(async () => ({ status: 'error' as const, detail: 'storage full' }))
  const dispose = registerOpenNoteSession({ panelId: 'export-draft', ref: () => ({ courseId, relPath: NOTE }), snapshot: () => markdown, flush, retarget() {} })
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  try {
    const exported = notesMarkdownForExport()
    expect(exported).toContain('Other course note')
    expect(exported).toContain(markdown)
    expect(exported).not.toContain('<!-- 자료구조 / 중간고사 정리.md -->\n# 해시 테이블과 충돌 해결')
    expect(flush).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
  } finally { dispose(); storage.mockRestore() }
})
