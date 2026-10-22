// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ workspace: { activeWorkspaceKey: 'workspace-a', surface: 'course' }, subscribers: new Set<(state: any) => void>(), target: null as any, current: true, invoke: vi.fn(), frames: [] as FrameRequestCallback[] }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => fixture.workspace, subscribe: (fn: (state: any) => void) => { fixture.subscribers.add(fn); return () => fixture.subscribers.delete(fn) } } }))
vi.mock('../../../src/renderer/src/features/browser/browserGuestsStore', () => ({ useBrowserGuests: { getState: () => ({ liveGuests: [] }) } }))
vi.mock('../../../src/renderer/src/features/workspace/panels/browserAnchor', () => ({ getBrowserAnchorRect: () => null }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: fixture.invoke }))
vi.mock('../../../src/renderer/src/features/annotation/documentAdapters', () => ({ documentAnnotationAtPoint: () => fixture.target, targetStillCurrent: () => fixture.current }))
vi.mock('../../../src/renderer/src/features/chat/composerDraftPersistence', () => ({ composerDraftPersistence: { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) } }))
import { AnnotationOverlay } from '../../../src/renderer/src/features/annotation/AnnotationOverlay'
import { beginAnnotationCapture, finishAnnotationSelection, useAnnotationStore } from '../../../src/renderer/src/features/annotation/annotationStore'
import { hydrateComposerDraft, updateComposerDraft, useComposerDraftStore } from '../../../src/renderer/src/features/chat/composerDraftStore'
let root: Root
const image = 'data:image/png;base64,AAAA'
const references = () => useComposerDraftStore.getState().drafts['conversation-a']?.references
const flushFrames = async () => { await act(async () => { while (fixture.frames.length) fixture.frames.shift()!(0) }) }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fixture.workspace = { activeWorkspaceKey: 'workspace-a', surface: 'course' }; fixture.current = true; fixture.frames = []; fixture.invoke.mockReset()
  useAnnotationStore.setState({ session: null, busy: false, error: null, pending: {}, captureErrors: {} })
  useComposerDraftStore.setState({ drafts: {}, hydrated: {}, persistenceErrors: {} })
  await hydrateComposerDraft('conversation-a')
  document.body.innerHTML = '<div id="root"></div><div id="panel"><p>Saved PDF quote</p></div>'
  const rect = { x: 10, y: 20, width: 200, height: 40, left: 10, top: 20, right: 210, bottom: 60, toJSON: () => ({}) }
  const element = document.querySelector('p')!, panel = document.querySelector('#panel')!
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect); vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect)
  fixture.target = { element, panel, rect, sourceRect: rect, regionRequired: false, reference: { kind: 'pdf', courseId: 'source-owner', sourcePanelId: 'source', title: 'PDF source', page: 1, quote: 'Saved PDF quote', documentEpoch: 'epoch', rect: { x: 0, y: 0, width: 1, height: 1 } } }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { fixture.frames.push(callback); return fixture.frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  root = createRoot(document.querySelector('#root')!)
  await act(async () => { root.render(<AnnotationOverlay />); useAnnotationStore.getState().begin('conversation-a', 'workspace-owner') })
})
afterEach(async () => { await act(async () => { root.unmount(); useAnnotationStore.getState().stop() }); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test.each(['finish', 'escape', 'mode'] as const)('retains a clicked PDF and its late image after immediate %s before paint', async action => {
  let resolveImage!: (image: { imageDataUrl: string }) => void
  fixture.invoke.mockImplementation(() => new Promise(resolve => { resolveImage = resolve }))
  const original = useAnnotationStore.getState().session!
  await act(async () => {
    document.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 30, clientY: 30, bubbles: true }))
    if (action === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else if (action === 'mode') useAnnotationStore.getState().mode('region')
    else useAnnotationStore.getState().stop()
  })
  expect(references()).toEqual([expect.objectContaining({ quote: 'Saved PDF quote', courseId: 'source-owner', workspaceKey: 'workspace-a' })])
  expect(beginAnnotationCapture(original)).toBeNull()
  updateComposerDraft('conversation-a', draft => ({ references: draft.references!.map(reference => ({ ...reference, comment: 'Keep this request' })) }))
  const sending = finishAnnotationSelection('conversation-a'); let ready = false; void sending.then(() => { ready = true })
  await flushFrames(); expect(fixture.invoke).toHaveBeenCalledWith('annotation:captureHost', { rect: expect.any(Object) }); expect(ready).toBe(false)
  await act(async () => { resolveImage({ imageDataUrl: image }); await sending })
  expect(ready).toBe(true); expect(useAnnotationStore.getState().pending['conversation-a']).toBe(0)
  expect(references()).toEqual([expect.objectContaining({ imageDataUrl: image, comment: 'Keep this request' })])
})

test('workspace switching preserves the accepted snapshot only in its original draft without capturing the new screen', async () => {
  await act(async () => {
    document.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 30, clientY: 30, bubbles: true }))
    fixture.workspace.activeWorkspaceKey = 'workspace-b'; fixture.current = false
    for (const listener of fixture.subscribers) listener(fixture.workspace)
    useAnnotationStore.getState().begin('conversation-b', 'other-owner')
  })
  await flushFrames()
  expect(fixture.invoke).not.toHaveBeenCalled()
  expect(references()).toEqual([expect.objectContaining({ quote: 'Saved PDF quote', workspaceKey: 'workspace-a' })])
  expect(useComposerDraftStore.getState().drafts['conversation-b']).toBeUndefined()
  expect(useAnnotationStore.getState().session?.conversationId).toBe('conversation-b')
  expect(useAnnotationStore.getState().captureErrors['conversation-a']).toContain('원본은 보관')
})

test('late completion cannot re-add a removed reference or use an already finished token', async () => {
  const session = useAnnotationStore.getState().session!, capture = beginAnnotationCapture(session)!
  const reference = { ...fixture.target.reference, id: 'removed', capturedAt: new Date().toISOString() }
  capture.append(reference); updateComposerDraft('conversation-a', { references: [] })
  capture.image(reference.id, image); capture.append(reference) // A native final drain repeats an already removed reference.
  expect(references()).toEqual([])
  capture.finish(); capture.append({ ...reference, id: 'late' })
  expect(references()).toEqual([]); expect(useAnnotationStore.getState().pending['conversation-a']).toBe(0)
})
