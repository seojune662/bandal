import { beforeEach, expect, test, vi } from 'vitest'
import { consumeComposerDraft, updateComposerDraft, useComposerDraftStore, hydrateComposerDraft, flushComposerDraft, type ComposerDraft } from '../../../src/renderer/src/features/chat/composerDraftStore'
import { composerDraftPersistence } from '../../../src/renderer/src/features/chat/composerDraftPersistence'
vi.mock('../../../src/renderer/src/features/chat/composerDraftPersistence', () => ({ composerDraftPersistence: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) } }))
beforeEach(async () => {
  await Promise.all(Object.keys(useComposerDraftStore.getState().drafts).map(flushComposerDraft))
  useComposerDraftStore.setState({ drafts: {}, hydrated: {}, persistenceErrors: {} })
  vi.mocked(composerDraftPersistence.read).mockReset().mockResolvedValue(undefined)
  vi.mocked(composerDraftPersistence.write).mockClear()
})
test('successful sends preserve text, quotes and attachments added while sending', () => {
  updateComposerDraft('chat', { text: 'first', quotes: [{ text: 'first quote', source: 'one' }], files: [{ name: 'first', relPath: 'first.pdf' }], images: [{ mediaType: 'image/png', dataBase64: 'old' }] })
  const sent = useComposerDraftStore.getState().drafts.chat!
  // A second renderer broadcasts copies of the old items plus its new work.
  updateComposerDraft('chat', { text: 'next message', quotes: [...structuredClone(sent.quotes!), { text: 'next quote', source: 'two' }], files: [...structuredClone(sent.files), { name: 'next', relPath: 'next.pdf' }], images: [...structuredClone(sent.images), { mediaType: 'image/png', dataBase64: 'new' }], screen: true })
  consumeComposerDraft('chat', sent)
  expect(useComposerDraftStore.getState().drafts.chat).toMatchObject({
    text: 'next message', quotes: [{ text: 'next quote', source: 'two' }], files: [{ name: 'next', relPath: 'next.pdf' }], images: [{ mediaType: 'image/png', dataBase64: 'new' }], screen: true
  })
})
test('clears a successfully sent draft and preserves deliberate duplicate additions', () => {
  const image = { mediaType: 'image/png', dataBase64: 'same' }
  updateComposerDraft('chat', { text: 'send', images: [image], browser: true })
  const sent = useComposerDraftStore.getState().drafts.chat!
  updateComposerDraft('chat', { images: [image, { ...image }] })
  consumeComposerDraft('chat', sent)
  expect(useComposerDraftStore.getState().drafts.chat).toMatchObject({ text: '', images: [image], browser: false })
})

test('mixed-pane annotation snapshots and later comment edits survive an in-flight send', () => {
  const reference = { id: 'pdf-ref', kind: 'pdf' as const, courseId: 'c1', sourcePanelId: 'pdf-1', title: 'PDF', page: 3, rect: { x: 0, y: 0, width: 1, height: 1 }, capturedAt: '2026-10-23T00:00:00Z', documentEpoch: 'one', comment: '원래 요청' }
  updateComposerDraft('chat', { references: [reference] })
  const sent = useComposerDraftStore.getState().drafts.chat!
  updateComposerDraft('chat', { references: [{ ...reference, comment: '편집한 요청' }, { ...reference, id: 'web-ref', kind: 'browser', sourcePanelId: 'browser-1' }] })
  consumeComposerDraft('chat', sent)
  expect(useComposerDraftStore.getState().drafts.chat?.references).toHaveLength(2)
  expect(useComposerDraftStore.getState().drafts.chat?.references?.[0]?.comment).toBe('편집한 요청')
})
test('hydrates saved snapshots without overwriting text entered during the read, then persists cleared sends', async () => {
  let resolveRead!: (draft: ComposerDraft) => void
  vi.mocked(composerDraftPersistence.read).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
  const hydration = hydrateComposerDraft('restored')
  updateComposerDraft('restored', { text: 'newer typing' })
  const reference = { id: 'r', kind: 'region' as const, courseId: 'c', sourcePanelId: 'p', title: 'Source', rect: { x: 0, y: 0, width: 1, height: 1 }, capturedAt: 'now', documentEpoch: 'one', imageDataUrl: 'data:image/png;base64,AAAA' }
  updateComposerDraft('restored', current => ({ files: [...current.files, { name: 'second.pdf', relPath: 'second.pdf' }], references: [...current.references ?? [], { ...reference, id: 'new' }] }))
  resolveRead({ text: 'saved text', files: [{ name: 'source.pdf', relPath: 'source.pdf' }], references: [reference], images: [], skills: [], creation: null, browser: false, screen: false })
  await hydration; await flushComposerDraft('restored')
  const restored = useComposerDraftStore.getState().drafts.restored!
  expect(restored).toMatchObject({ text: 'newer typing', files: [{ relPath: 'source.pdf' }, { relPath: 'second.pdf' }], references: [reference, { ...reference, id: 'new' }] })
  expect(composerDraftPersistence.write).toHaveBeenLastCalledWith('restored', restored)
  consumeComposerDraft('restored', restored)
  await flushComposerDraft('restored')
  expect(composerDraftPersistence.write).toHaveBeenLastCalledWith('restored', expect.objectContaining({ text: '', references: [], files: [] }))
})
test('failed hydration does not overwrite a persisted draft and reports a retryable error', async () => {
  vi.mocked(composerDraftPersistence.read).mockRejectedValue(new Error('read failed'))
  updateComposerDraft('unread', { text: 'local' })
  await flushComposerDraft('unread')
  expect(useComposerDraftStore.getState().hydrated.unread).toBeFalsy()
  expect(useComposerDraftStore.getState().persistenceErrors.unread).toContain('불러오지')
  expect(composerDraftPersistence.write).not.toHaveBeenCalled()
})
