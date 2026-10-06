// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../src/shared/tabs'
import { useWorkspaceStore, resetWorkspaceStoreForTests } from '../../../src/renderer/src/stores/workspaceStore'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { showToast } from '../../../src/renderer/src/app/toast'
import { openActiveAssistant, openChosenAssistant, registerAssistantController, resetAssistantControllersForTests, useActiveAssistantOpen } from '../../../src/renderer/src/features/assistantPanel/assistantController'
import { withAssistantPanel } from '../../../src/renderer/src/features/assistantPanel/TabAssistantPanel'
import { WorkspacePlacementContext } from '../../../src/renderer/src/features/workspace/placementContext'
import { CourseActivity } from '../../../src/renderer/src/features/workspace/courseActivity'
import { updateComposerDraft, useComposerDraft, useComposerDraftStore } from '../../../src/renderer/src/features/chat/composerDraftStore'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({ ok: true })), onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/features/chat/ChatSurface', () => ({
  ChatSurface: ({ conversationId, courseId }: { conversationId: string; courseId: string }) => {
    const draft = useComposerDraft(conversationId)
    return <textarea className="chat-composer__input" data-conversation={conversationId} data-course={courseId} value={draft.text} readOnly />
  }
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note: TabDescriptor = { kind: 'note', payload: { courseId: 'c1', relPath: 'note.md' } }
const chat: TabDescriptor = { kind: 'chat', payload: { courseId: 'c1', conversationId: 'existing-conversation' } }
let source: { panelId: string; descriptor: TabDescriptor } | null
let container: HTMLDivElement, root: Root

function controller(courseId: string | null = 'c1', open = false) {
  return { courseId, open, show: vi.fn(), focus: vi.fn() }
}
function activate(panelId: string, descriptor = note, courseId: string | null = 'c1') {
  source = { panelId, descriptor }
  useWorkspaceStore.setState({ activeCourseId: courseId, activePanelId: panelId, hydration: 'ready' })
}
function panelProps(descriptor: TabDescriptor, id = 'exact-panel'): IDockviewPanelProps {
  return { params: { descriptor, assistant: { courseId: 'c1', conversationId: 'retained-conversation', open: false, width: 320 } },
    api: { id, isActive: true, isVisible: true, updateParameters: vi.fn(), onDidActiveChange: () => ({ dispose() {} }), onDidVisibilityChange: () => ({ dispose() {} }) }
  } as unknown as IDockviewPanelProps
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks()
  resetWorkspaceStoreForTests(); resetAssistantControllersForTests()
  useCoursesStore.setState({ selectedCourseId: 'c1', courses: [{ id: 'c1' } as never] })
  useComposerDraftStore.setState({ drafts: {} })
  source = null
  vi.spyOn(useWorkspaceStore.getState(), 'activePanelSource').mockImplementation(() => source)
  vi.spyOn(useWorkspaceStore.getState(), 'openTab').mockImplementation(() => {})
  vi.spyOn(useWorkspaceStore.getState(), 'activatePanel').mockImplementation(() => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount()); container.remove()
  resetAssistantControllersForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

test('opens the exact duplicate controller without replacing its conversation', () => {
  const original = controller(), duplicate = controller()
  registerAssistantController('original', original); registerAssistantController('duplicate', duplicate)
  activate('duplicate'); openActiveAssistant()
  expect(duplicate.show).toHaveBeenCalledOnce(); expect(duplicate.focus).toHaveBeenCalledOnce()
  expect(original.show).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('home AI requests an explicit context picker and cannot reuse a hidden document controller or course chat', () => {
  const hidden = controller('c1', true)
  registerAssistantController('hidden-note', hidden); activate('hidden-note')
  useWorkspaceStore.setState({ surface: 'learning-home', activePanelId: null })
  const picker = vi.fn(); window.addEventListener('bandal:choose-ai-context', picker)
  openActiveAssistant()
  expect(picker).toHaveBeenCalledOnce()
  expect(hidden.show).not.toHaveBeenCalled(); expect(hidden.focus).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
  window.removeEventListener('bandal:choose-ai-context', picker)
})

test('choosing a learning space waits for that space controller instead of opening its course chat', async () => {
  const binding = { courseId: 'c1', rootRelPath: 'Reading' }
  vi.mocked(useWorkspaceStore.getState().openTab).mockImplementation(descriptor => { activate('learning:c1:project:Reading', descriptor) })
  await openChosenAssistant({ courseId: 'c1', binding })
  expect(useWorkspaceStore.getState().openTab).toHaveBeenCalledTimes(1)
  expect(useWorkspaceStore.getState().openTab).toHaveBeenCalledWith({ kind: 'learning', payload: { ...binding, view: 'home' } })
  const chosen = controller()
  registerAssistantController('learning:c1:project:Reading', chosen)
  expect(chosen.show).toHaveBeenCalledOnce(); expect(chosen.focus).toHaveBeenCalledOnce()
})

test('retained courses with the same singleton panel ID keep independent controllers', () => {
  const first = controller('c1'), second = controller('c2')
  registerAssistantController('board', first); registerAssistantController('board', second)
  activate('board'); openActiveAssistant()
  expect(first.show).toHaveBeenCalledOnce(); expect(second.show).not.toHaveBeenCalled()
})

test('an old registration cleanup cannot remove its replacement', () => {
  const old = controller(), current = controller()
  const cleanup = registerAssistantController('source', old)
  registerAssistantController('source', current); cleanup()
  activate('source'); openActiveAssistant()
  expect(current.show).toHaveBeenCalledOnce()
})

test('fallback focuses a normalized legacy chat by its actual ID instead of reopening it', () => {
  const currentChat = controller('c1', true)
  registerAssistantController('chat:c1', currentChat)
  activate('unsupported')
  useWorkspaceStore.setState({ openTabs: { 'chat:c1': chat } })
  openActiveAssistant()
  expect(useWorkspaceStore.getState().activatePanel).toHaveBeenCalledWith('chat:c1')
  expect(currentChat.focus).toHaveBeenCalledOnce()
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('new course chat uses the existing legacy resolver and focuses when it mounts', () => {
  activate('unsupported')
  vi.mocked(useWorkspaceStore.getState().openTab).mockImplementation(descriptor => { activate('chat:c1', descriptor) })
  openActiveAssistant()
  expect(useWorkspaceStore.getState().openTab).toHaveBeenCalledWith({ kind: 'chat', payload: { courseId: 'c1' } })
  const mounted = controller('c1', true)
  registerAssistantController('chat:c1', mounted)
  expect(mounted.focus).toHaveBeenCalledOnce()
})

test('unowned tabs do not acquire a different course and use course chat fallback', () => {
  const unowned = controller(null)
  registerAssistantController('unowned', unowned, 'c1'); activate('unowned')
  openActiveAssistant()
  expect(unowned.show).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().openTab).toHaveBeenCalledWith({ kind: 'chat', payload: { courseId: 'c1' } })
})

test('missing or deleted course shows selection guidance without opening a chat', () => {
  const showCourses = vi.spyOn(useUiStore.getState(), 'showCourses')
  useCoursesStore.setState({ selectedCourseId: 'deleted', courses: [] })
  openActiveAssistant()
  expect(showCourses).toHaveBeenCalledOnce()
  expect(showToast).toHaveBeenCalledWith('과목을 선택하면 AI와 대화할 수 있어요.')
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('the global open indicator follows controller updates and actual active panel changes', () => {
  function Indicator() { return <span>{String(useActiveAssistantOpen())}</span> }
  act(() => { activate('first'); root.render(<Indicator />) })
  expect(container.textContent).toBe('false')
  act(() => { registerAssistantController('first', controller('c1', true)) })
  expect(container.textContent).toBe('true')
  act(() => { activate('second') })
  expect(container.textContent).toBe('false')
  act(() => { registerAssistantController('second', controller('c1', true)) })
  expect(container.textContent).toBe('true')
  act(() => { registerAssistantController('second', controller('c1', false)) })
  expect(container.textContent).toBe('false')
})

test('the document shortcut keeps its real conversation and draft and waits for ancestor inert removal', async () => {
  const props = panelProps(note), Wrapped = withAssistantPanel(() => <p>자료</p>)
  activate(props.api.id); updateComposerDraft('retained-conversation', { text: '보존된 초안' })
  container.setAttribute('inert', '')
  await act(async () => { root.render(<Wrapped {...props} />) })
  await act(async () => { openActiveAssistant() })
  const input = container.querySelector<HTMLTextAreaElement>('.chat-composer__input')!
  expect(input.value).toBe('보존된 초안')
  expect(input.dataset.conversation).toBe('retained-conversation')
  expect(document.activeElement).not.toBe(input)
  await act(async () => { container.removeAttribute('inert') })
  expect(document.activeElement).toBe(input)
  expect(props.api.updateParameters).toHaveBeenCalledWith({ assistant: expect.objectContaining({ conversationId: 'retained-conversation', open: true }) })
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('pending focus is cancelled when the exact source changes', async () => {
  const props = panelProps(note), Wrapped = withAssistantPanel(() => <p>자료</p>)
  activate(props.api.id); container.setAttribute('inert', '')
  await act(async () => { root.render(<Wrapped {...props} />); })
  await act(async () => { openActiveAssistant() })
  const input = container.querySelector<HTMLTextAreaElement>('.chat-composer__input')!
  await act(async () => { activate('another'); container.removeAttribute('inert') })
  expect(document.activeElement).not.toBe(input)
})

test('a chat shortcut focuses its current composer without adding a second assistant surface', async () => {
  const props = panelProps(chat), Wrapped = withAssistantPanel(() => <textarea className="chat-composer__input" />)
  activate(props.api.id, chat)
  await act(async () => { root.render(<Wrapped {...props} />) })
  await act(async () => { openActiveAssistant() })
  expect(document.activeElement).toBe(container.querySelector('textarea'))
  expect(container.querySelector('.tab-assistant')).toBeNull()
  expect(props.api.updateParameters).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('an unopened temporary browser follows placement until AI opens, then retains its conversation owner across later moves', async () => {
  const browser: TabDescriptor = { kind: 'browser', payload: { tabId: 'scratch', initialUrl: 'https://gemini.google.com/app' } }
  const props = panelProps(browser)
  props.params.assistant = { conversationId: 'scratch-conversation', open: false, width: 320 }
  const Wrapped = withAssistantPanel(() => <p>브라우저</p>)
  const render = async (courseId: string | null) => act(async () => {
    activate(props.api.id, browser, courseId)
    root.render(<WorkspacePlacementContext.Provider value={{ courseId, panelId: props.api.id, instanceId: 'scratch-instance' }}><Wrapped {...props} /></WorkspacePlacementContext.Provider>)
  })
  await render(null); await render('c1'); await render('c2')
  expect(props.api.updateParameters).not.toHaveBeenCalled()
  await act(async () => openActiveAssistant())
  const composer = container.querySelector<HTMLTextAreaElement>('.chat-composer__input')!
  expect(composer.dataset.course).toBe('c2')
  expect(composer.dataset.conversation).toBe('scratch-conversation')
  expect(props.api.updateParameters).toHaveBeenCalledWith({ assistant: expect.objectContaining({ courseId: 'c2', conversationId: 'scratch-conversation', open: true }) })
  await render('c1')
  expect(container.querySelector('.chat-composer__input')).toBe(composer)
  expect(composer.dataset.course).toBe('c2')
  expect(useWorkspaceStore.getState().openTab).not.toHaveBeenCalled()
})

test('a hidden temporary browser cannot inherit a selected course, and an assistant opened at null pins its first valid destination', async () => {
  const browser: TabDescriptor = { kind: 'browser', payload: { tabId: 'scratch-open', initialUrl: 'https://gemini.google.com/app' } }
  const props = panelProps(browser)
  props.params.assistant = { conversationId: 'scratch-open-conversation', open: true, width: 320 }
  const Wrapped = withAssistantPanel(() => <p>브라우저</p>)
  const render = async (courseId: string | null, active = true) => act(async () => {
    if (active) activate(props.api.id, browser, courseId)
    root.render(<WorkspacePlacementContext.Provider value={{ courseId, panelId: props.api.id, instanceId: 'scratch-open-instance' }}><CourseActivity.Provider value={active}><Wrapped {...props} /></CourseActivity.Provider></WorkspacePlacementContext.Provider>)
  })
  activate('another-course-panel', note, 'c1')
  await render(null, false)
  expect(container.querySelector('.chat-composer__input')).toBeNull()
  expect(container.textContent).toContain('과목을 선택하면 AI와 대화할 수 있어요.')
  expect(props.api.updateParameters).not.toHaveBeenCalled()
  await render('c1')
  const composer = container.querySelector<HTMLTextAreaElement>('.chat-composer__input')!
  expect(composer.dataset.course).toBe('c1')
  expect(props.api.updateParameters).toHaveBeenCalledWith({ assistant: expect.objectContaining({ courseId: 'c1', conversationId: 'scratch-open-conversation' }) })
  await render('c2')
  expect(container.querySelector('.chat-composer__input')).toBe(composer)
  expect(composer.dataset.course).toBe('c1')
})

test('a moved resource assistant uses its original course ahead of persisted assistant or placement owners', async () => {
  const props = panelProps(note), Wrapped = withAssistantPanel(() => <p>자료</p>)
  props.params.assistant = { courseId: 'c2', conversationId: 'resource-conversation', open: true, width: 320 }
  activate(props.api.id, note, 'c3')
  await act(async () => root.render(<WorkspacePlacementContext.Provider value={{ courseId: 'c3', panelId: props.api.id, instanceId: 'resource-instance' }}><Wrapped {...props} /></WorkspacePlacementContext.Provider>))
  expect(container.querySelector<HTMLTextAreaElement>('.chat-composer__input')!.dataset.course).toBe('c1')
})
