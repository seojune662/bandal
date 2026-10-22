// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import type { IDockviewPanelProps } from 'dockview'
import { useWorkspaceStore, resetWorkspaceStoreForTests } from '../../../src/renderer/src/stores/workspaceStore'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { openActiveAssistant, openChosenAssistant, openWorkspaceAssistant, useActiveAssistantOpen } from '../../../src/renderer/src/features/assistantPanel/assistantController'
import { withAssistantPanel } from '../../../src/renderer/src/features/assistantPanel/TabAssistantPanel'
import { usePanelAssistant } from '../../../src/renderer/src/features/assistantPanel/panelContext'
import { WorkspacePlacementContext } from '../../../src/renderer/src/features/workspace/placementContext'
import { readDocumentContexts } from '../../../src/renderer/src/features/agent/documentContext'
import { updateComposerDraft, useComposerDraftStore } from '../../../src/renderer/src/features/chat/composerDraftStore'
import { useWorkspaceAssistantStore } from '../../../src/renderer/src/features/assistantPanel/workspaceAssistantStore'
import { workspaceKey, type WorkspaceRef } from '../../../src/shared/types/workspace'
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({ ok: true })), onPush: vi.fn(() => () => {}) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const course: WorkspaceRef = { kind: 'course', courseId: 'c1' }
const project: WorkspaceRef = { kind: 'project', courseId: 'c1', rootRelPath: 'Reading' }
let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.restoreAllMocks(); resetWorkspaceStoreForTests()
  localStorage.clear()
  useWorkspaceAssistantStore.setState({ spaces: {} }); useComposerDraftStore.setState({ drafts: {} })
  useWorkspaceStore.setState({ activeWorkspace: course, activeWorkspaceKey: 'c1', activeCourseId: 'c1', hydration: 'ready' })
  useCoursesStore.setState({ selectedCourseId: 'c1', courses: [{ id: 'c1' } as never] })
  useUiStore.setState({ rightRailOpen: false, rightRailTab: 'materials' })
  vi.spyOn(useWorkspaceStore.getState(), 'openTab').mockImplementation(() => {})
  vi.spyOn(useWorkspaceStore.getState(), 'showWorkspace').mockImplementation(workspace => { useWorkspaceStore.setState({ activeWorkspace: workspace, activeWorkspaceKey: workspace ? workspaceKey(workspace) : null, activeCourseId: workspace?.courseId ?? null }) })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

test('independent windows cannot overwrite another workspace conversation mapping', () => {
  const assistant = useWorkspaceAssistantStore.getState()
  assistant.select(course, 'course-draft')
  // Simulate a second renderer whose in-memory map predates the first write.
  useWorkspaceAssistantStore.setState({ spaces: {} })
  assistant.select(project, 'project-draft')
  useWorkspaceAssistantStore.setState({ spaces: {} })
  expect(assistant.select(course)).toBe('course-draft')
  expect(assistant.select(project)).toBe('project-draft')
  const key = 'bandal:workspace-assistant:v2:' + encodeURIComponent(workspaceKey(course))
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ conversationId: 'other-window', mode: 'quiz' }) }))
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(course)]).toEqual({ conversationId: 'other-window', mode: 'quiz' })
})

test('opens one global AI without creating a document tab and retains its conversation', () => {
  openActiveAssistant()
  const id = useWorkspaceAssistantStore.getState().spaces.c1!.conversationId
  updateComposerDraft(id, { text: '첫 공간의 초안' })
  openActiveAssistant()
  expect(useUiStore.getState()).toMatchObject({ rightRailOpen: true, rightRailTab: 'ai' })
  expect(useWorkspaceAssistantStore.getState().spaces.c1!.conversationId).toBe(id)
  expect(useComposerDraftStore.getState().drafts[id]?.text).toBe('첫 공간의 초안')
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})
test('project roots sharing a physical course keep conversations, modes and drafts separate', async () => {
  const first = openWorkspaceAssistant(course)
  updateComposerDraft(first, { text: '과목 초안' })
  await openChosenAssistant({ courseId: 'c1', binding: { courseId: 'c1', rootRelPath: 'Reading' } })
  const second = useWorkspaceAssistantStore.getState().spaces[workspaceKey(project)]!.conversationId
  expect(second).not.toBe(first)
  useWorkspaceAssistantStore.getState().setMode(project, 'quiz')
  updateComposerDraft(second, { text: '프로젝트 초안' })
  openWorkspaceAssistant(course)
  expect(useComposerDraftStore.getState().drafts[first]?.text).toBe('과목 초안')
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(project)]).toEqual({ conversationId: second, mode: 'quiz' })
})
test('restored conversation entry points preserve the exact conversation and append prompts', () => {
  openWorkspaceAssistant(project, { conversationId: 'existing', text: '첫 요청' })
  openWorkspaceAssistant(project, { text: '추가 요청' })
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(project)]?.conversationId).toBe('existing')
  expect(useComposerDraftStore.getState().drafts.existing?.text).toBe('첫 요청\n\n추가 요청')
})
test('project relocation preserves the selected conversation and its composer', () => {
  const id = openWorkspaceAssistant(project, { text: '이동해도 보존' })
  const moved: WorkspaceRef = { kind: 'project', courseId: 'c1', rootRelPath: 'Other/Reading' }
  useWorkspaceAssistantStore.getState().moveWorkspace(project, moved)
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(project)]).toBeUndefined()
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(moved)]?.conversationId).toBe(id)
  expect(useComposerDraftStore.getState().drafts[id]?.text).toBe('이동해도 보존')
})
test('document wrapper removes mini AI but retains document context, highlights and ask action', () => {
  const Document = withAssistantPanel(() => { const assistant = usePanelAssistant()!; return <div>Document<button onClick={() => assistant.setHighlightsOpen(!assistant.highlightsOpen)}>highlights {String(assistant.highlightsOpen)}</button><button onClick={() => assistant.ask('선택한 문장을 설명해줘')}>ask</button></div> })
  const updateParameters = vi.fn()
  const props = { params: { descriptor: { kind: 'note', payload: { courseId: 'c1', relPath: 'first.md' } }, assistant: { conversationId: 'legacy', highlightsOpen: true } }, api: { id: 'exact-note', title: 'first.md', updateParameters } } as unknown as IDockviewPanelProps
  act(() => root.render(<WorkspacePlacementContext.Provider value={{ workspace: course, courseId: 'c1', panelId: 'exact-note', instanceId: 'one' }}><Document {...props} /></WorkspacePlacementContext.Provider>))
  expect(container.querySelector('.tab-assistant')).toBeNull()
  expect(readDocumentContexts()).toContainEqual(expect.objectContaining({ documentId: 'exact-note', courseId: 'c1', relPath: 'first.md' }))
  expect(container.textContent).toContain('highlights true')
  act(() => container.querySelectorAll('button')[0]!.click())
  expect(updateParameters).toHaveBeenCalledWith({ assistant: expect.objectContaining({ highlightsOpen: false, open: false, conversationId: 'legacy' }) })
  act(() => container.querySelectorAll('button')[1]!.click())
  const id = useWorkspaceAssistantStore.getState().spaces.c1!.conversationId
  expect(useComposerDraftStore.getState().drafts[id]?.text).toBe('선택한 문장을 설명해줘')
})
test('AI open indicator follows the global right tab', () => {
  function Indicator() { return <span>{String(useActiveAssistantOpen())}</span> }
  act(() => root.render(<Indicator />)); expect(container.textContent).toBe('false')
  act(openActiveAssistant); expect(container.textContent).toBe('true')
  act(() => useUiStore.getState().setRightRailTab('materials')); expect(container.textContent).toBe('false')
})
test('a source-course document asks the AI of its project placement without changing its source owner', () => {
  const destination: WorkspaceRef = { kind: 'project', courseId: 'project-owner', rootRelPath: '' }
  const Document = withAssistantPanel(() => { const assistant = usePanelAssistant()!; return <button onClick={() => assistant.ask('이 자료 설명')}>ask</button> })
  const props = { params: { descriptor: { kind: 'pdf', payload: { courseId: 'c1', relPath: 'source.pdf' } } }, api: { id: 'source-pdf', title: 'Source', updateParameters: vi.fn() } } as unknown as IDockviewPanelProps
  act(() => root.render(<WorkspacePlacementContext.Provider value={{ workspace: destination, courseId: 'project-owner', panelId: 'source-pdf', instanceId: 'one' }}><Document {...props} /></WorkspacePlacementContext.Provider>))
  act(() => container.querySelector('button')!.click())
  const id = useWorkspaceAssistantStore.getState().spaces[workspaceKey(destination)]!.conversationId
  expect(useComposerDraftStore.getState().drafts[id]?.text).toBe('이 자료 설명')
  expect(useWorkspaceStore.getState().activeWorkspace).toEqual(destination)
  expect(readDocumentContexts()).toContainEqual(expect.objectContaining({ documentId: 'source-pdf', courseId: 'c1', relPath: 'source.pdf' }))
})
