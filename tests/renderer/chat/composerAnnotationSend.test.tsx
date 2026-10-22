// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceKey: 'workspace-a' }) } }))
vi.mock('../../../src/renderer/src/features/chat/composerDraftPersistence', () => ({ composerDraftPersistence: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) } }))
vi.mock('../../../src/renderer/src/features/chat/ContextChips', () => ({ ContextChips: () => null }))
vi.mock('../../../src/renderer/src/features/chat/AccessPolicyMenu', () => ({ AccessPolicyMenu: () => null }))
vi.mock('../../../src/renderer/src/features/chat/AddMenu', () => ({ AddMenu: () => null }))
vi.mock('../../../src/renderer/src/features/annotation/revealAnnotation', () => ({ revealAnnotation: vi.fn() }))
import { Composer } from '../../../src/renderer/src/features/chat/Composer'
import { beginAnnotationCapture, useAnnotationStore } from '../../../src/renderer/src/features/annotation/annotationStore'
import { hydrateComposerDraft, updateComposerDraft, useComposerDraftStore } from '../../../src/renderer/src/features/chat/composerDraftStore'

test.each(['button', 'enter'])('%s finishes selection and sends the final native/image references to its original conversation', async trigger => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  const conversationId = `original-${trigger}`
  await hydrateComposerDraft(conversationId); updateComposerDraft(conversationId, { text: 'Explain these' })
  useAnnotationStore.getState().begin(conversationId, 'course-a')
  const capture = beginAnnotationCapture(useAnnotationStore.getState().session!)!
  const onSend = vi.fn(async () => undefined)
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<Composer courseId="course-a" conversationId={conversationId} value="Explain these" onChange={() => undefined} onSend={onSend} onCancel={() => undefined} isStreaming={false} isWaitingPermission={false} limit={null} disabled={false} />))
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      if (trigger === 'button') (container.querySelector('[aria-label="메시지 보내기"]') as HTMLButtonElement).click()
      else { textarea.focus(); textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })) }
    })
    expect(useAnnotationStore.getState().session).toBeNull(); expect(onSend).not.toHaveBeenCalled()
    const reference = { id: 'last-browser-pick', kind: 'browser' as const, courseId: 'source-owner', sourcePanelId: 'source', title: 'Last clicked source', quote: 'The last accepted quote', rect: { x: 0, y: 0, width: 1, height: 1 }, capturedAt: new Date().toISOString(), documentEpoch: 'epoch' }
    await act(async () => {
      capture.append(reference); capture.image(reference.id, 'data:image/png;base64,AAAA')
      updateComposerDraft(conversationId, { text: 'A newer unsent request' })
      capture.finish()
    })
    expect(onSend).toHaveBeenCalledExactlyOnceWith([], expect.objectContaining({ references: [expect.objectContaining({ quote: reference.quote, imageDataUrl: 'data:image/png;base64,AAAA', workspaceKey: 'workspace-a' })] }))
    expect(useComposerDraftStore.getState().drafts[conversationId]).toMatchObject({ text: 'A newer unsent request', references: [] })
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() }
})
