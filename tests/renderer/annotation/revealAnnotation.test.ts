// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
import type { AnnotationReference } from '../../../src/shared/types/chatAnnotation'
const fixture = vi.hoisted(() => ({ state: {} as any, toast: vi.fn(), stop: vi.fn(), invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => fixture.state, subscribe: () => () => {} } }))
vi.mock('../../../src/renderer/src/features/annotation/annotationStore', () => ({ useAnnotationStore: { getState: () => ({ stop: fixture.stop }) } }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: fixture.invoke }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: fixture.toast }))
vi.mock('../../../src/renderer/src/features/workspace/tabIdentity', () => ({ descriptorFor: (kind: string, payload: unknown) => ({ kind, payload }), tabPanelId: () => 'reopened' }))
import { revealAnnotation } from '../../../src/renderer/src/features/annotation/revealAnnotation'
import { takePdfPageNavigation } from '../../../src/renderer/src/features/pdf/pdfPageNavigation'
const reference: AnnotationReference = { id: 'reference', kind: 'markdown', courseId: 'course', sourcePanelId: 'second', title: 'Second document', relPath: 'second.md', quote: 'Identical paragraph', rect: { x: 0, y: 0, width: 1, height: 1 }, capturedAt: '2026-10-23T00:00:00.000Z', documentEpoch: 'epoch' }
beforeEach(() => {
  vi.clearAllMocks(); document.body.innerHTML = ''
  fixture.state = { activeWorkspaceKey: 'course', hydration: 'ready', openTabs: { first: {}, second: {} }, activatePanel: vi.fn(), openTab: vi.fn() }
})
function panel(id: string): HTMLElement {
  const element = document.createElement('div'); element.className = 'workspace-panel-content'; element.dataset.contentPanel = id
  element.innerHTML = '<div class="ProseMirror"><p>Identical paragraph</p></div>'; document.body.append(element)
  const paragraph = element.querySelector<HTMLElement>('p')!; paragraph.scrollIntoView = vi.fn(); return paragraph
}

test('reveals the exact Markdown source pane even when another pane has identical text', async () => {
  const first = panel('first'), second = panel('second')
  await revealAnnotation(reference)
  expect(fixture.state.activatePanel).toHaveBeenCalledWith('second')
  expect(second.scrollIntoView).toHaveBeenCalledOnce()
  expect(first.scrollIntoView).not.toHaveBeenCalled()
  expect(fixture.toast).not.toHaveBeenCalled()
})

test('waits for a reopened document before looking for its immutable quote', async () => {
  fixture.state.openTabs = {}
  let reopened: HTMLElement | undefined
  const original = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = callback => { reopened = panel('reopened'); callback(performance.now()); return 1 }
  try {
    await revealAnnotation(reference)
    expect(fixture.state.openTab).toHaveBeenCalledWith({ kind: 'note', payload: { courseId: 'course', relPath: 'second.md' } })
    expect(reopened!.scrollIntoView).toHaveBeenCalledOnce()
    expect(fixture.toast).not.toHaveBeenCalled()
  } finally { globalThis.requestAnimationFrame = original }
})

test('queues PDF reveal only for its original pane, leaving duplicate file panes alone', async () => {
  await revealAnnotation({ ...reference, kind: 'pdf', relPath: 'slides.pdf', page: 7 })
  expect(takePdfPageNavigation('course', 'slides.pdf', 'first')).toBeNull()
  expect(takePdfPageNavigation('course', 'slides.pdf')).toBeNull()
  expect(takePdfPageNavigation('course', 'slides.pdf', 'second')).toBe(7)
})
