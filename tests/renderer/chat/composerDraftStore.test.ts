import { beforeEach, expect, test } from 'vitest'
import { consumeComposerDraft, updateComposerDraft, useComposerDraftStore } from '../../../src/renderer/src/features/chat/composerDraftStore'
beforeEach(() => useComposerDraftStore.setState({ drafts: {} }))
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
