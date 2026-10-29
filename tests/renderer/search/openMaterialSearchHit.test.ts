// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SearchHit } from '../../../src/shared/types/search'

const mocks = vi.hoisted(() => ({
  state: { activeWindowKey: 'window-a' as string | null, activePanelId: 'old-panel' as string | null },
  target: { courseId: 'course', workspace: { kind: 'course', courseId: 'course' }, windowId: 'window-a', groupId: 'split-right' },
  open: vi.fn(), jump: vi.fn(), toast: vi.fn()
}))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => mocks.state } }))
vi.mock('../../../src/renderer/src/features/workspace/captureWorkspaceTarget', () => ({ captureActiveWorkspaceTarget: () => mocks.target }))
vi.mock('../../../src/renderer/src/features/workspace/openMaterial', () => ({ openMaterialInCourse: mocks.open }))
vi.mock('../../../src/renderer/src/features/pdf/pdfPageNavigation', () => ({ requestPdfPageNavigation: mocks.jump }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
import { openMaterialSearchHit } from '../../../src/renderer/src/features/search/openMaterialSearchHit'

const pdfHit: SearchHit = { kind: 'pdf', relPath: 'lecture.pdf', page: 17, snippet: 'matched PDF', score: 1 }
const noteHit: SearchHit = { kind: 'note', relPath: 'notes.md', page: null, snippet: 'matched note', score: 1 }
function paragraph(panelId: string, text: string) {
  const panel = document.createElement('div'); panel.className = 'workspace-panel-content'; panel.dataset.contentPanel = panelId
  const editor = document.createElement('div'); editor.className = 'ProseMirror'
  const p = document.createElement('p'); p.textContent = text; p.scrollIntoView = vi.fn()
  editor.append(p); panel.append(editor); document.body.append(panel)
  return p
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  mocks.state = { activeWindowKey: 'window-a', activePanelId: 'old-panel' }
  document.body.replaceChildren()
})
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

test('waits for the exact newly opened duplicate PDF panel instead of using the old active PDF', async () => {
  let opened!: (id: string) => void
  mocks.open.mockImplementation((_course, _kind, _path, options) => { opened = options.onOpened })
  const pending = openMaterialSearchHit('course', pdfHit, 'matched', true)
  await vi.advanceTimersByTimeAsync(200)
  expect(mocks.jump).not.toHaveBeenCalled()
  expect(mocks.open).toHaveBeenCalledWith('course', 'pdf', 'lecture.pdf', expect.objectContaining({ target: mocks.target, newInstance: true }))
  mocks.state.activePanelId = 'new-duplicate-panel'
  opened('new-duplicate-panel')
  await pending
  expect(mocks.jump).toHaveBeenCalledExactlyOnceWith({ courseId: 'course', relPath: 'lecture.pdf', page: 17, panelId: 'new-duplicate-panel' })
})

test('a delayed open after the user changes windows never navigates the new window', async () => {
  let opened!: (id: string) => void
  mocks.open.mockImplementation((_course, _kind, _path, options) => { opened = options.onOpened })
  const pending = openMaterialSearchHit('course', pdfHit, 'matched')
  mocks.state.activeWindowKey = 'window-b'
  opened('source-window-panel')
  await pending
  expect(mocks.jump).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled()
})

test('Markdown navigation normalizes Korean and case and scrolls only its exact panel', async () => {
  const other = paragraph('other-panel', '중력 law 설명')
  const matching = paragraph('note-panel', '중력 law 설명'.normalize('NFD'))
  mocks.open.mockImplementation((_course, _kind, _path, options) => { mocks.state.activePanelId = 'note-panel'; options.onOpened('note-panel') })
  await openMaterialSearchHit('course', noteHit, '  중력 LAW  ')
  expect(matching.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'smooth' })
  expect(other.scrollIntoView).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled()
})

test('changed Markdown remains open and explains a missing match without scrolling another pane', async () => {
  const other = paragraph('other-panel', 'original phrase')
  const changed = paragraph('note-panel', 'replacement content')
  mocks.open.mockImplementation((_course, _kind, _path, options) => { mocks.state.activePanelId = 'note-panel'; options.onOpened('note-panel') })
  await openMaterialSearchHit('course', noteHit, 'original phrase')
  expect(other.scrollIntoView).not.toHaveBeenCalled(); expect(changed.scrollIntoView).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('내용이 바뀌어 일치 위치를 찾지 못했어요.')
  expect(mocks.state.activePanelId).toBe('note-panel')
})

test('does not show a missing-match warning after the user selects another tab while Markdown mounts', async () => {
  mocks.open.mockImplementation((_course, _kind, _path, options) => { mocks.state.activePanelId = 'note-panel'; options.onOpened('note-panel') })
  const pending = openMaterialSearchHit('course', noteHit, 'original phrase')
  await Promise.resolve()
  mocks.state.activePanelId = 'different-panel'
  await vi.advanceTimersByTimeAsync(50); await pending
  expect(mocks.toast).not.toHaveBeenCalled()
})

test('a failed open never leaves a page jump waiting for an unrelated PDF', async () => {
  mocks.open.mockImplementation(() => { throw new Error('대상 작업창을 찾지 못했어요.') })
  await openMaterialSearchHit('course', pdfHit, 'matched')
  expect(mocks.jump).not.toHaveBeenCalled()
  expect(mocks.toast).toHaveBeenCalledWith('대상 작업창을 찾지 못했어요.', 'danger')
  expect(vi.getTimerCount()).toBe(0)
})
