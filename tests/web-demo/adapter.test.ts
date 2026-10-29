// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChatEventBatch } from '../../src/shared/ipc/events'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

test('sample PDF previews use its real SHA-256 and every saved first-page mark with scoped updates', async () => {
  const { adapter, courseId } = await fixture()
  const { PDF } = await import('../../web-demo/state')
  const { PDF_DOCUMENT_REVISION, PDF_SAMPLE_BYTES } = await import('../../web-demo/sample')
  const bytes = readFileSync(resolve('web-demo/public/sample.pdf'))
  expect(PDF_DOCUMENT_REVISION).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(PDF_SAMPLE_BYTES).toBe(bytes.length)
  expect(await adapter.invoke('materials:hoverPreview', { courseId, relPath: PDF })).toMatchObject({ relPath: PDF, size: bytes.length, content: { kind: 'pdf' } })
  expect((await adapter.invoke('pdfNotes:info', { courseId, relPath: PDF })).documentRevision).toBe(PDF_DOCUMENT_REVISION)
  const changed = vi.fn(); const off = adapter.on('pdf:markupChanged', changed)
  const input = { courseId, relPath: PDF, documentRevision: PDF_DOCUMENT_REVISION, page: 1, kind: 'rect' as const, data: { box: { x: .1, y: .2, width: .3, height: .2 } }, style: { color: 'ink' as const, width: .003, opacity: 1 } }
  const drawing = await adapter.invoke('drawings:create', input)
  await adapter.invoke('drawings:create', { ...input, page: 2 })
  const annotation = await adapter.invoke('annotations:create', { courseId, relPath: PDF, documentRevision: PDF_DOCUMENT_REVISION, page: 1, color: 'pink', rects: [{ x: .1, y: .2, width: .3, height: .1 }], anchor: { quote: 'hash', prefix: '', suffix: '' } })
  expect(await adapter.invoke('pdf:previewSnapshot', { courseId, relPath: PDF })).toMatchObject({ documentRevision: PDF_DOCUMENT_REVISION, drawings: [drawing], annotations: [annotation] })
  await adapter.invoke('drawings:update', { id: drawing.id, documentRevision: PDF_DOCUMENT_REVISION, style: { color: 'blue', width: .003, opacity: 1 } })
  expect((await adapter.invoke('pdf:previewSnapshot', { courseId, relPath: PDF })).drawings[0]?.style.color).toBe('blue')
  await adapter.invoke('drawings:delete', { ids: [drawing.id], documentRevision: PDF_DOCUMENT_REVISION })
  await adapter.invoke('annotations:delete', { id: annotation.id, documentRevision: PDF_DOCUMENT_REVISION })
  expect(await adapter.invoke('pdf:previewSnapshot', { courseId, relPath: PDF })).toMatchObject({ drawings: [], annotations: [] })
  expect(changed).toHaveBeenCalledTimes(6)
  expect(changed).toHaveBeenLastCalledWith({ courseId, relPath: PDF, documentRevision: PDF_DOCUMENT_REVISION })
  await expect(adapter.invoke('drawings:create', { ...input, documentRevision: 'a'.repeat(64) })).rejects.toThrow('원본이 변경')
  expect(changed).toHaveBeenCalledTimes(6)
  off()
})

test('demo content search scopes before limiting results and searches the actual sample PDF pages', async () => {
  const { adapter, courseId } = await fixture()
  const { commit, key, PDF } = await import('../../web-demo/state')
  commit(next => {
    for (const relPath of ['Folder/a.md', 'Folder/sub/b.md', 'Folder2/leak.md']) next.notes[key(courseId, relPath)] = { courseId, relPath, mtime: 1, markdown: '중력 LAW and gravity' }
    next.notes[key('demo-course-1', 'Folder/foreign.md')] = { courseId: 'demo-course-1', relPath: 'Folder/foreign.md', mtime: 1, markdown: '중력 LAW' }
  })
  const scoped = await adapter.invoke('search:query', { courseId, rootRelPath: 'Folder', query: '중력 law'.normalize('NFD'), limit: 1 })
  expect(scoped.hits.map(hit => hit.relPath)).toEqual(['Folder/a.md'])
  expect(scoped.indexing).toMatchObject({ phase: 'ready', totalFiles: 2, indexedPages: 0, failures: [] })
  const pages = await adapter.invoke('search:query', { courseId, rootRelPath: '', query: 'h(key)', limit: 10 })
  expect(pages.hits.map(hit => [hit.relPath, hit.page])).toEqual([[PDF, 1], [PDF, 2], [PDF, 3]])
  expect(pages.indexing).toMatchObject({ phase: 'ready', indexedPages: 3 })
})
