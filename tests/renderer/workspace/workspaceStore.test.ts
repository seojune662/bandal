import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DockviewApi } from 'dockview'
import type { TabDescriptor } from '../../../src/shared/tabs'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

import { registerResourceCloseGuard, registerTabCloseGuard } from '../../../src/renderer/src/features/workspace/tabCloseGuard'
import { registerOpenNoteSession } from '../../../src/renderer/src/features/notes/noteSessionRegistry'
import { registerDocumentSave } from '../../../src/renderer/src/features/documents/saveRegistry'
import { showToast } from '../../../src/renderer/src/app/toast'
import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  browserTabCourseId,
  closeBrowserTab,
  closeLearningSpace,
  prepareCloseLearningSpace,
  openBrowserTabInCourse,
  retainedTabDescriptors,
  resetWorkspaceStoreForTests,
  useWorkspaceStore,
  reconcileWorkspaceMaterialRename,
  flushLearningResourcesForPath,
  moveWorkspacePanel
} from '../../../src/renderer/src/stores/workspaceStore'
import { registerBeforeWorkspaceWindowLeave, workspaceApiForWindow, workspaceApiForCourse } from '../../../src/renderer/src/stores/workspaceStore'
import { workspaceWindowKey, type WorkspaceWindows } from '../../../src/shared/workspaceWindows'
import { workspaceKey } from '../../../src/shared/types/workspace'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { useWorkspaceAssistantStore } from '../../../src/renderer/src/features/assistantPanel/workspaceAssistantStore'
import {
  resetBrowserGuestsForTests,
  useBrowserGuests
} from '../../../src/renderer/src/features/browser/browserGuestsStore'
import {
  descriptorFor,
  tabPanelId
} from '../../../src/renderer/src/features/workspace/tabIdentity'

const invokeMock = vi.mocked(invoke)
const showToastMock = vi.mocked(showToast)

// -- fake dockview api --------------------------------------------------------

interface FakePanel {
  id: string
  params?: { descriptor: TabDescriptor; [key: string]: unknown }
  api: {
    setActive: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    // Real dockview panels always expose this; openTab refreshes params on an
    // already-open panel so a re-open with a different payload (e.g. another
    // group in the same 함께하기 tab) is not silently dropped.
    updateParameters: ReturnType<typeof vi.fn>
  }
}

function emptyLayout(): Record<string, unknown> {
  return {
    grid: {
      root: { type: 'branch', data: [] },
      width: 0,
      height: 0,
      orientation: 'HORIZONTAL'
    },
    panels: {}
  }
}

class FakeDockview {
  panels: FakePanel[] = []
  activePanel: FakePanel | undefined
  activeListeners = new Set<() => void>()
  json: unknown = emptyLayout()
  fromJSONCalls: unknown[] = []
  addPanelCalls: Record<string, unknown>[] = []
  clearCount = 0

  onDidActivePanelChange(listener: () => void): { dispose(): void } {
    this.activeListeners.add(listener)
    return { dispose: () => { this.activeListeners.delete(listener) } }
  }

  activate(panelId?: string): void {
    this.activePanel = panelId ? this.getPanel(panelId) : undefined
    for (const listener of this.activeListeners) listener()
  }

  getPanel(id: string): FakePanel | undefined {
    return this.panels.find((panel) => panel.id === id)
  }

  addPanel(options: { id: string }): FakePanel {
    const panel: FakePanel = {
      id: options.id,
      api: { setActive: vi.fn(), close: vi.fn(), updateParameters: vi.fn() }
    }
    this.panels.push(panel)
    this.addPanelCalls.push(options as unknown as Record<string, unknown>)
    return panel
  }

  removePanel(panel: FakePanel): void {
    this.panels = this.panels.filter((entry) => entry.id !== panel.id)
  }

  clear(): void {
    this.clearCount += 1
    this.panels = []
    this.activate()
    this.json = emptyLayout()
  }

  fromJSON(data: unknown): void {
    this.fromJSONCalls.push(data)
    this.json = data
    const panels = (data as { panels: Record<string, unknown> }).panels
    this.panels = Object.keys(panels).map((id) => ({
      id,
      params: (panels[id] as { params: { descriptor: TabDescriptor } }).params,
      api: { setActive: vi.fn(), close: vi.fn(), updateParameters: vi.fn() }
    }))
  }

  toJSON(): unknown {
    return this.json
  }

  asApi(): DockviewApi {
    return this as unknown as DockviewApi
  }
}

// -- layout fixtures ----------------------------------------------------------

function panelState(descriptor: TabDescriptor): Record<string, unknown> {
  return {
    id: tabPanelId(descriptor),
    contentComponent: descriptor.kind,
    params: { descriptor }
  }
}

function singleLeafLayout(
  descriptors: TabDescriptor[],
  activeGroup = 'g1'
): Record<string, unknown> {
  const ids = descriptors.map(tabPanelId)
  return {
    grid: {
      root: {
        type: 'leaf',
        data: { id: 'g1', views: ids, activeView: ids[0] },
        size: 100
      },
      width: 800,
      height: 600,
      orientation: 'HORIZONTAL'
    },
    panels: Object.fromEntries(
      descriptors.map((descriptor) => [tabPanelId(descriptor), panelState(descriptor)])
    ),
    activeGroup
  }
}

function liveDock(): FakeDockview {
  const dock = new FakeDockview()
  const add = dock.addPanel.bind(dock)
  dock.addPanel = (options: { id: string }) => {
    const panel = add(options)
    Object.assign(panel, { params: (options as { params?: unknown }).params, title: (options as { title?: string }).title })
    dock.activate(panel.id)
    return panel
  }
  dock.toJSON = () => {
    const ids = dock.panels.map(panel => panel.id)
    return { grid: { root: ids.length ? { type: 'leaf', data: { id: 'live', views: ids, activeView: dock.activePanel?.id } } : { type: 'branch', data: [] }, width: 800, height: 600, orientation: 'HORIZONTAL' },
      panels: Object.fromEntries(dock.panels.map(panel => [panel.id, { id: panel.id, contentComponent: panel.params?.descriptor.kind, params: panel.params }])), activeGroup: 'live' }
  }
  return dock
}

const pdfA = descriptorFor('pdf', { courseId: 'c1', relPath: 'a.pdf' })
const pdfB = descriptorFor('pdf', { courseId: 'c1', relPath: 'b.pdf' })

describe('independent internal windows', () => {
  test('a legacy layout becomes the first window and saves distinct views and chrome in one envelope', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const note = descriptorFor('note', { courseId: 'c1', relPath: 'shared.md' })
    state.openTab(note); state.notifyLayoutChanged()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(note); state.notifyLayoutChanged()
    state.openTab(note)
    expect(second.panels).toHaveLength(1)
    expect(second.panels[0]!.id).not.toBe(first.panels[0]!.id)
    expect(useWorkspaceStore.getState().activeWorkspaceKey).toBe('c1')
    expect(useWorkspaceStore.getState().activeWindowKey).toBe(workspaceWindowKey('c1', id))
    state.renameWindow(id, '시험 준비'); state.setWorkspaceChromeMode('all-hidden')
    state.reorderWindows([id, 'main'])
    expect(workspaceApiForCourse('c1')).toBe(second.asApi())
    expect(workspaceApiForWindow('c1')).toBe(first.asApi())
    state.selectWindow('main')
    expect(useWorkspaceStore.getState().workspaceChromeMode).toBe('all')
    expect(first.panels).toHaveLength(1)
    await state.flushPendingSave()
    const saved = savesFor('c1').at(-1) as WorkspaceWindows
    expect(saved).toMatchObject({ kind: 'workspace-windows', version: 1, activeWindowId: 'main' })
    expect(saved.windows.map(window => [window.id, window.name, window.chromeMode])).toEqual([[id, '시험 준비', 'all-hidden'], ['main', '윈도우 1', 'all']])
    expect(saved.windows.map(window => Object.keys((window.layout as { panels: object }).panels).length)).toEqual([1, 1])
  })

  test('restoring an envelope selects the saved window and retains unvisited windows without another read', async () => {
    const browser = descriptorFor('browser', { tabId: 'parked', initialUrl: 'https://example.test' })
    invokeMock.mockImplementation(channel => Promise.resolve(channel === 'layout:get' ? { layout: {
      kind: 'workspace-windows', version: 1, activeWindowId: 'second', windows: [
        { id: 'main', name: '자료', chromeMode: 'all', layout: singleLeafLayout([browser]) },
        { id: 'second', name: '연습', chromeMode: 'tabs-hidden', layout: singleLeafLayout([pdfB]) }
      ]
    } } : { ok: true }) as never)
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle(); await settle()
    expect(useWorkspaceStore.getState().activeWindowId).toBe('second')
    state.attachWindowApi(workspaceWindowKey('c1', 'second'), second.asApi()); await settle()
    expect(useWorkspaceStore.getState().workspaceChromeMode).toBe('tabs-hidden')
    expect(second.panels.map(panel => panel.id)).toEqual([tabPanelId(pdfB)])
    expect(retainedTabDescriptors()).toEqual(expect.arrayContaining([browser, pdfB]))
    state.selectWindow('main'); await settle()
    expect(first.panels.map(panel => panel.id)).toEqual([tabPanelId(browser)])
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'layout:get')).toHaveLength(1)
  })

  test('same-course popup and delayed new-tab target retain the exact source window', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    const group = { id: 'same-group', panels: first.panels }
    Object.assign(first, { getGroup: () => group })
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'opener', initialUrl: 'https://example.test' })); state.notifyLayoutChanged()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    const popup = descriptorFor('browser', { tabId: 'child', initialUrl: 'https://example.test/child' })
    expect(openBrowserTabInCourse(popup, 'c1', true, 'opener')).toBe(true)
    state.openTab(pdfA, { target: { courseId: 'c1', workspace: { kind: 'course', courseId: 'c1' }, windowId: 'main', groupId: group.id } })
    expect(first.panels.map(panel => panel.params?.descriptor)).toEqual(expect.arrayContaining([popup, pdfA]))
    expect(second.panels).toHaveLength(0)
  })

  test('delayed opens persist to an evicted original window without mounting it or following current focus', async () => {
    const first = liveDock(), original = liveDock(), current = liveDock(), restored = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!, key = workspaceWindowKey('c1', id)
    state.attachWindowApi(key, original.asApi()); await settle()
    const note = descriptorFor('note', { courseId: 'c1', relPath: 'draft.md' })
    state.openTab(note); state.notifyLayoutChanged()
    const target = { workspace: { kind: 'course' as const, courseId: 'c1' }, courseId: 'c1', windowId: id, groupId: 'live' }
    state.setActiveCourse('c2'); state.attachWindowApi('c2', current.asApi()); await settle()
    state.detachWindowApi(key); state.detachWindowApi('c1')
    expect(workspaceApiForWindow(key)).toBeNull()
    state.openTab(pdfA, { target }); state.openTab(pdfA, { target })
    state.openTab(pdfB, { target: { ...target, groupId: 'removed-group' } })
    expect(useWorkspaceStore.getState().activeWorkspaceKey).toBe('c2')
    expect(current.panels).toHaveLength(0)
    expect(original.addPanelCalls).toHaveLength(1)
    expect(retainedTabDescriptors(key)).toEqual([note, pdfA])
    await state.flushPendingSave()
    const saved = savesFor('c1').at(-1) as WorkspaceWindows
    expect(Object.values((saved.windows.find(window => window.id === id)!.layout as { panels: object }).panels)).toHaveLength(2)
    state.showWorkspaceWindow({ kind: 'course', courseId: 'c1' }, id); state.attachWindowApi(key, restored.asApi()); await settle()
    expect(restored.panels.map(panel => panel.params?.descriptor)).toEqual([note, pdfA])
  })

  test('closing a window respects vetoes, keeps one window and durably removes only the selected window', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    state.openTab(pdfA); state.notifyLayoutChanged()
    expect(await state.closeWindow('main')).toBe(false)
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'form', initialUrl: 'https://example.test/form' })); state.notifyLayoutChanged()
    const stop = registerTabCloseGuard(() => false)
    expect(await state.closeWindow(id)).toBe(false)
    expect(useWorkspaceStore.getState().windows).toHaveLength(2)
    stop()
    state.setWindowsOverviewOpen(true)
    expect(await state.closeWindow(id)).toBe(true)
    expect(useWorkspaceStore.getState().windowsOverviewOpen).toBe(true)
    expect(useWorkspaceStore.getState().activeWindowId).toBe('main')
    expect(first.panels.map(panel => panel.params?.descriptor)).toEqual([pdfA])
    expect(retainedTabDescriptors()).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'browser' })]))
    expect((savesFor('c1').at(-1) as WorkspaceWindows).windows.map(window => window.id)).toEqual(['main'])
  })

  test.each(['note', 'pdf'] as const)('a %s save failure preserves the window before any browser close can destroy native pages', async kind => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'form', initialUrl: 'https://example.test/form' }))
    const ref = { courseId: 'c1', relPath: `draft.${kind === 'note' ? 'md' : 'pdf'}` }
    second.activate()
    state.openTab(kind === 'note' ? descriptorFor('note', ref) : descriptorFor('pdf', ref)); state.notifyLayoutChanged()
    const stopSave = kind === 'note' ? registerOpenNoteSession({ panelId: 'save-failure-note', ref: () => ref, retarget: () => {}, flush: async () => ({ status: 'error', detail: 'disk full' }) })
      : registerDocumentSave(async () => { throw new Error('disk full') }, ref)
    const close = vi.fn(() => true), stopGuard = registerTabCloseGuard(close)
    try {
      expect(await state.closeWindow(id)).toBe(false)
      expect(close).not.toHaveBeenCalled()
      expect(useWorkspaceStore.getState().windows).toHaveLength(2)
      expect(second.panels).toHaveLength(2)
    } finally { stopSave(); stopGuard() }
  })

  test('closing a source window after navigating does not publish its collection over the destination', async () => {
    const first = liveDock(), second = liveDock(), destination = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'wait', initialUrl: 'https://example.test' })); state.notifyLayoutChanged()
    let release!: (allow: boolean) => void, started!: () => void
    const guardStarted = new Promise<void>(resolve => { started = resolve })
    const stop = registerTabCloseGuard(() => { started(); return new Promise<boolean>(resolve => { release = resolve }) })
    const closing = state.closeWindow(id)
    await guardStarted
    state.setActiveCourse('c2'); state.attachWindowApi('c2', destination.asApi()); await settle()
    state.renameWindow('main', 'Destination')
    release(true); expect(await closing).toBe(true); stop()
    expect(useWorkspaceStore.getState().activeWorkspaceKey).toBe('c2')
    expect(useWorkspaceStore.getState().windows).toMatchObject([{ id: 'main', name: 'Destination' }])
  })

  test('a later browser veto removes only already-accepted native closes and keeps them reopenable', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    const accepted = descriptorFor('browser', { tabId: 'accepted', initialUrl: 'https://example.test/one' })
    const vetoed = descriptorFor('browser', { tabId: 'vetoed', initialUrl: 'https://example.test/two' })
    state.openTab(accepted); second.activate(); state.openTab(vetoed); second.activate(); state.openTab(pdfA); state.notifyLayoutChanged()
    for (const panel of second.panels) panel.api.close.mockImplementation(() => second.removePanel(panel))
    const stop = registerTabCloseGuard(descriptor => descriptor.kind !== 'browser' || descriptor.payload.tabId !== 'vetoed')
    try {
      expect(await state.closeWindow(id)).toBe(false)
      expect(useWorkspaceStore.getState().windows).toHaveLength(2)
      expect(second.panels.map(panel => panel.params?.descriptor)).toEqual([vetoed, pdfA])
      expect(retainedTabDescriptors()).not.toContainEqual(accepted)
      expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('이미 닫기'))
      state.reopenClosedTab()
      expect(second.panels.map(panel => panel.params?.descriptor)).toContainEqual(accepted)
    } finally { stop() }
  })

  test('hydrating another workspace remaps colliding document view IDs and keeps grid references valid', async () => {
    invokeMock.mockImplementation(channel => Promise.resolve(channel === 'layout:get' ? { layout: singleLeafLayout([pdfA]) } : { ok: true }) as never)
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    state.showWorkspace({ kind: 'project', courseId: 'c1', rootRelPath: 'Project' })
    const base = workspaceKey({ kind: 'project', courseId: 'c1', rootRelPath: 'Project' })
    state.attachWindowApi(base, second.asApi()); await settle()
    expect(second.panels).toHaveLength(1)
    expect(second.panels[0]!.id).not.toBe(first.panels[0]!.id)
    expect(second.panels[0]!.params?.descriptor).toEqual(pdfA)
    const restored = second.fromJSONCalls.at(-1) as { grid: { root: { data: { views: string[] } } } }
    expect(restored.grid.root.data.views).toEqual([second.panels[0]!.id])
  })

  test('a failed collection save restores the window without keeping an already-closed browser panel', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'accepted', initialUrl: 'https://example.test' })); second.activate(); state.openTab(pdfA); state.notifyLayoutChanged()
    for (const panel of second.panels) panel.api.close.mockImplementation(() => second.removePanel(panel))
    invokeMock.mockImplementation((channel, input) => {
      const layout = (input as { layout?: WorkspaceWindows } | undefined)?.layout
      if (channel === 'layout:save' && layout?.kind === 'workspace-windows' && layout.windows.length === 1) return Promise.reject(new Error('disk full')) as never
      return Promise.resolve({ ok: true }) as never
    })
    const stop = registerTabCloseGuard(() => true)
    try {
      const closing = state.closeWindow(id)
      await vi.runAllTimersAsync()
      expect(await closing).toBe(false)
      expect(useWorkspaceStore.getState().windows).toHaveLength(2)
      expect(useWorkspaceStore.getState().activeWindowId).toBe(id)
      expect(second.panels.map(panel => panel.params?.descriptor)).toEqual([pdfA])
      const saved = savesFor('c1').at(-1) as WorkspaceWindows
      expect(saved.windows).toHaveLength(2)
      expect(JSON.stringify(saved)).not.toContain('browser:accepted')
    } finally { stop() }
  })

  test('a failed close keeps a newer selected window instead of restoring the stale starting selection', async () => {
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey('c1', id), second.asApi()); await settle()
    state.openTab(pdfA); state.notifyLayoutChanged()
    let rejectSave!: (error: Error) => void, started!: () => void, hold = true
    const saveStarted = new Promise<void>(resolve => { started = resolve })
    invokeMock.mockImplementation((channel, input) => {
      const layout = (input as { layout?: WorkspaceWindows } | undefined)?.layout
      if (channel === 'layout:save' && layout?.kind === 'workspace-windows' && layout.windows.length === 1) {
        if (!hold) return Promise.reject(new Error('disk full')) as never
        started(); return new Promise((_, reject) => { rejectSave = reject }) as never
      }
      return Promise.resolve({ ok: true }) as never
    })
    const closing = state.closeWindow(id)
    await saveStarted
    hold = false
    state.selectWindow('main')
    // The selected-window save supersedes the rejected removal snapshot.
    rejectSave(new Error('disk full'))
    await settle()
    await vi.runAllTimersAsync()
    expect(await closing).toBe(false)
    expect(useWorkspaceStore.getState().windows).toHaveLength(2)
    expect(useWorkspaceStore.getState().activeWindowId).toBe('main')
    expect((savesFor('c1').at(-1) as WorkspaceWindows).activeWindowId).toBe('main')
  })

  test('only the latest deferred navigation runs and immediate document opens wait for its window', async () => {
    const first = liveDock(), third = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachWindowApi('c1', first.asApi()); await settle()
    const releases: Array<() => void> = []
    const stop = registerBeforeWorkspaceWindowLeave(() => new Promise<void>(resolve => releases.push(resolve)))
    state.setActiveCourse('c2'); state.setActiveCourse('c3'); state.openTab(pdfA)
    expect(useWorkspaceStore.getState().activeCourseId).toBe('c1')
    releases[0]!(); await settle()
    expect(useWorkspaceStore.getState().activeCourseId).toBe('c1')
    releases[1]!(); await settle()
    state.attachWindowApi('c3', third.asApi()); await settle()
    expect(useWorkspaceStore.getState().activeCourseId).toBe('c3')
    expect(first.panels).toHaveLength(0)
    expect(third.panels.map(panel => panel.params?.descriptor)).toEqual([pdfA])
    stop()
  })

  test('renaming and removing a project traverse every window including ownerless browser tabs', async () => {
    const workspace = { kind: 'project' as const, courseId: 'c1', rootRelPath: 'old' }
    const first = liveDock(), second = liveDock(), state = useWorkspaceStore.getState(), base = workspaceKey(workspace)
    state.showWorkspace(workspace); state.attachWindowApi(base, first.asApi()); await settle()
    state.openTab(descriptorFor('note', { courseId: 'c1', relPath: 'old/a.md' })); state.notifyLayoutChanged()
    const id = state.createWindow()!
    state.attachWindowApi(workspaceWindowKey(base, id), second.asApi()); await settle()
    state.openTab(descriptorFor('browser', { tabId: 'project-browser', initialUrl: 'https://example.test' })); state.notifyLayoutChanged()
    // Eviction is required here: the fixture does not implement real group reattachment.
    state.detachWindowApi(base)
    reconcileWorkspaceMaterialRename('c1', 'old', 'new')
    const next = { ...workspace, rootRelPath: 'new' }, nextBase = workspaceKey(next)
    expect(useWorkspaceStore.getState().activeWorkspace).toEqual(next)
    expect(useWorkspaceStore.getState().windows.map(window => window.id)).toEqual(['main', id])
    expect(retainedTabDescriptors(nextBase)).toEqual([descriptorFor('note', { courseId: 'c1', relPath: 'new/a.md' })])
    const stop = registerTabCloseGuard(descriptor => descriptor.kind !== 'browser')
    expect(await prepareCloseLearningSpace(next, false)).toBe(false); stop()
    await closeLearningSpace(next, false)
    expect(retainedTabDescriptors()).toEqual([])
  })
})

test('projects sharing an owner hydrate, retain and save independent tab layouts', async () => {
  const first = { kind: 'project' as const, courseId: 'c1', rootRelPath: 'English' }
  const second = { kind: 'project' as const, courseId: 'c1', rootRelPath: 'Review' }
  const firstDock = liveDock(), secondDock = liveDock()
  const state = useWorkspaceStore.getState()
  state.showWorkspace(first)
  state.attachCourseApi(workspaceKey(first), firstDock.asApi())
  await settle()
  state.openTab(pdfA)
  state.notifyLayoutChanged()
  state.showWorkspace(second)
  state.attachCourseApi(workspaceKey(second), secondDock.asApi())
  await settle()
  state.openTab(pdfB)
  state.notifyLayoutChanged()
  expect(useWorkspaceStore.getState().activeCourseId).toBe('c1')
  expect(useWorkspaceStore.getState().activeWorkspace).toEqual(second)
  expect(retainedTabDescriptors(workspaceKey(first))).toEqual([pdfA])
  expect(retainedTabDescriptors(workspaceKey(second))).toEqual([pdfB])
  state.showWorkspace(first)
  expect(useWorkspaceStore.getState().openTabs).toEqual({ [tabPanelId(pdfA)]: pdfA })
  await state.flushPendingSave()
  const reads = invokeMock.mock.calls.filter(([channel]) => channel === 'layout:get').map(([, input]) => input)
  expect(reads).toEqual([{ courseId: 'c1', projectRootRelPath: 'English' }, { courseId: 'c1', projectRootRelPath: 'Review' }])
  const written = invokeMock.mock.calls.flatMap(([channel, input]) => channel === 'layout:save' ? [input] : channel === 'layout:saveMany' ? (input as { layouts: unknown[] }).layouts : [])
  expect(written).toEqual(expect.arrayContaining([expect.objectContaining({ courseId: 'c1', projectRootRelPath: 'English' }), expect.objectContaining({ courseId: 'c1', projectRootRelPath: 'Review' })]))
})

test('a project removal checks browser close guards even without resource binding', async () => {
  const workspace = { kind: 'project' as const, courseId: 'c1', rootRelPath: 'Review' }
  const dock = liveDock(), state = useWorkspaceStore.getState()
  state.showWorkspace(workspace); state.attachCourseApi(workspaceKey(workspace), dock.asApi()); await settle()
  state.openTab(descriptorFor('browser', { tabId: 'pending-form', initialUrl: 'https://example.test' }))
  const stop = registerTabCloseGuard(descriptor => descriptor.kind !== 'browser')
  try { expect(await prepareCloseLearningSpace(workspace, false)).toBe(false) } finally { stop() }
})

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function savesFor(courseId: string): unknown[] {
  return invokeMock.mock.calls
    .filter(
      ([channel, req]) =>
        channel === 'layout:save' &&
        (req as { courseId: string }).courseId === courseId
    )
    .map(([, req]) => (req as { layout: unknown }).layout)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetWorkspaceStoreForTests()
  invokeMock.mockReset()
  showToastMock.mockReset()
  invokeMock.mockImplementation((channel: string) => {
    if (channel === 'layout:get') return Promise.resolve({ layout: null })
    return Promise.resolve({ ok: true })
  })
})

describe('captured new-tab destination', () => {
  for (const retained of [false, true]) test(`reopening ${retained ? 'retained' : 'active'} PDF preserves its page-note pairing`, async () => {
    const dock = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    state.openTab(pdfA)
    const panel = dock.getPanel(tabPanelId(pdfA))!
    const pageNotePair = { id: 'pair', role: 'source', otherPanelId: 'notes' }
    panel.params = { descriptor: pdfA, pageNotePair, scrollLinked: true }
    Object.assign(dock, { getGroup: () => ({ id: 'original', panels: [panel], activePanel: panel }) })
    if (retained) { state.setActiveCourse('c2'); state.attachCourseApi('c2', liveDock().asApi()); await settle() }
    state.openTab(pdfA, { target: { courseId: 'c1', groupId: 'original' } })
    expect(panel.api.updateParameters).toHaveBeenCalledWith({ descriptor: pdfA, pageNotePair, scrollLinked: true })
    expect(panel.api.setActive).toHaveBeenCalledOnce()
    expect(useWorkspaceStore.getState().activeCourseId).toBe(retained ? 'c2' : 'c1')
  })

  test('background creation in another pane preserves the focused pane', async () => {
    const dock = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    const focused = dock.addPanel({ id: 'focused' }), destination = dock.addPanel({ id: 'destination' })
    const group = { id: 'other-pane', panels: [destination], activePanel: destination }
    Object.assign(destination, { group }); dock.activate(focused.id)
    Object.assign(dock, { getGroup: () => group })
    state.openTab(pdfA, { background: true, target: { courseId: 'c1', groupId: group.id } })
    expect(dock.addPanelCalls.at(-1)).toMatchObject({ inactive: true })
    expect(focused.api.setActive).toHaveBeenCalledOnce()
    expect(destination.api.setActive).not.toHaveBeenCalled()
  })

  test('a delayed captured creation does not leave learning home', async () => {
    const dock = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    Object.assign(dock, { getGroup: () => ({ id: 'original', panels: [], activePanel: undefined }) })
    state.showLearningHome()
    state.openTab(pdfA, { target: { courseId: 'c1', groupId: 'original' } })
    expect(useWorkspaceStore.getState()).toMatchObject({ surface: 'learning-home', activePanelId: null })
    expect(dock.addPanelCalls.at(-1)).toMatchObject({ id: tabPanelId(pdfA) })
  })

  test('an empty unfocused pane receives its own new tab', async () => {
    const dock = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    const other = dock.addPanel({ id: 'other' })
    dock.activate(other.id)
    Object.assign(dock, { getGroup: (id: string) => id === 'empty-pane' ? { id, panels: [], activePanel: undefined } : undefined })
    state.openTab(pdfA, { target: { courseId: 'c1', groupId: 'empty-pane' } })
    expect(dock.addPanelCalls.at(-1)).toMatchObject({ id: tabPanelId(pdfA), position: { referenceGroup: 'empty-pane', index: 0 } })
  })

  test('a removed target pane never silently redirects to the focused pane', async () => {
    const dock = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    Object.assign(dock, { getGroup: () => undefined })
    state.openTab(pdfA, { target: { courseId: 'c1', groupId: 'removed' } })
    expect(dock.panels).toHaveLength(0)
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('영역이 닫혔어요'))
  })
})

test('renaming a dormant project preserves its selected draft conversation and remembered sidebar', () => {
  const before = { kind: 'project' as const, courseId: 'c1', rootRelPath: 'Old/Review' }
  const after = { ...before, rootRelPath: 'Archive/Review' }
  useWorkspaceAssistantStore.setState({ spaces: { [workspaceKey(before)]: { conversationId: 'unsent-draft', mode: 'quiz' } } })
  const ui = useUiStore.getState()
  ui.setRightRailScope(workspaceKey(before)); ui.setRightRailTab('ai'); ui.toggleRightRail()
  ui.setRightRailScope('c1')
  expect(retainedTabDescriptors(workspaceKey(before))).toEqual([])
  reconcileWorkspaceMaterialRename('c1', 'Old', 'Archive')
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(before)]).toBeUndefined()
  expect(useWorkspaceAssistantStore.getState().spaces[workspaceKey(after)]).toEqual({ conversationId: 'unsent-draft', mode: 'quiz' })
  ui.setRightRailScope(workspaceKey(after))
  expect(useUiStore.getState()).toMatchObject({ rightRailOpen: false, rightRailTab: 'ai' })
})

test('project path changes wait for relevant learning writes without closing any pane', async () => {
  const dock = liveDock(), state = useWorkspaceStore.getState()
  state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
  const resource: TabDescriptor = { kind: 'learning-resource', payload: { courseId: 'c1', rootRelPath: 'Reading/Project', resource: { kind: 'article', id: 'article' } } }
  state.openTab(resource)
  let finish!: (allowed: boolean) => void
  const check = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const unregister = registerResourceCloseGuard(resource, check)
  try {
    const waiting = flushLearningResourcesForPath('c1', 'Reading')
    await Promise.resolve()
    expect(check).toHaveBeenCalledOnce()
    expect(dock.getPanel(tabPanelId(resource))?.api.close).not.toHaveBeenCalled()
    finish(true)
    expect(await waiting).toBe(true)
    expect(dock.getPanel(tabPanelId(resource))).toBeDefined()
  } finally { unregister() }
})

test('failed learning drafts veto a path change while unrelated folders are unaffected', async () => {
  const dock = liveDock(), state = useWorkspaceStore.getState()
  state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
  const resource: TabDescriptor = { kind: 'learning-resource', payload: { courseId: 'c1', rootRelPath: 'Review', resource: { kind: 'artifact', id: 'quiz' } } }
  state.openTab(resource)
  const unregister = registerResourceCloseGuard(resource, async () => false)
  try {
    expect(await flushLearningResourcesForPath('c1', 'Review')).toBe(false)
    expect(await flushLearningResourcesForPath('c1', 'Unrelated')).toBe(true)
    expect(dock.getPanel(tabPanelId(resource))).toBeDefined()
  } finally { unregister() }
})

describe('cross-course placement transfer', () => {
  async function ready(sourceCourse: string | null = 'c1') {
    const source = liveDock(), target = liveDock(), state = useWorkspaceStore.getState()
    state.setActiveCourse(sourceCourse); state.attachCourseApi(sourceCourse, source.asApi()); await settle()
    const descriptor = descriptorFor('browser', { tabId: 'moving-page', initialUrl: 'https://example.test/current', profileId: 'school', isPrivate: true })
    const panel = source.addPanel({ id: tabPanelId(descriptor), params: { descriptor, assistant: { courseId: 'original', conversationId: 'conversation' } }, title: 'Current page' } as { id: string })
    state.notifyLayoutChanged()
    state.attachCourseApi('c2', target.asApi()); state.setActiveCourse('c2'); await settle()
    return { source, target, panel, descriptor, state }
  }

  test('moves exact identity and parameters, preserves browser session and persists both layouts atomically', async () => {
    const { source, target, panel, descriptor } = await ready()
    const unregister = registerTabCloseGuard(vi.fn(() => false))
    useBrowserGuests.getState().ensureGuest('moving-page', descriptor.payload.initialUrl, true, 'school', 'c1')
    expect(await moveWorkspacePanel({ sourceCourseId: 'c1', targetCourseId: 'c2', panelId: panel.id })).toBe(true)
    expect(source.getPanel(panel.id)).toBeUndefined()
    expect(target.getPanel(panel.id)?.params).toEqual(panel.params)
    expect(panel.api.close).not.toHaveBeenCalled()
    expect(browserTabCourseId('moving-page')).toBe('c2')
    expect(useBrowserGuests.getState().liveGuests[0]).toMatchObject({ tabId: 'moving-page', profileId: 'school', isPrivate: true, courseId: 'c2' })
    // Private pages stay live, but never enter saved layouts.
    const batch = invokeMock.mock.calls.find(([channel]) => channel === 'layout:saveMany')
    expect((batch?.[1] as { layouts: { courseId: string }[] }).layouts.map(layout => layout.courseId).sort()).toEqual(['c1', 'c2'])
    unregister()
  })

  test('temporary no-course browser can move into a course without closing or persisting a nonexistent source', async () => {
    const { source, target, panel } = await ready(null)
    expect(retainedTabDescriptors().some(tab => tab.kind === 'browser' && tab.payload.tabId === 'moving-page')).toBe(true)
    expect(await moveWorkspacePanel({ sourceCourseId: null, targetCourseId: 'c2', panelId: panel.id })).toBe(true)
    expect(source.getPanel(panel.id)).toBeUndefined(); expect(target.getPanel(panel.id)).toBeDefined()
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'layout:saveMany')).toHaveLength(0)
    expect(savesFor('c2').length).toBeGreaterThan(0)
  })

  test('the temporary workspace reflects and retains its tabs without writing a layout row', async () => {
    const source = liveDock(), state = useWorkspaceStore.getState()
    state.attachCourseApi(null, source.asApi())
    const descriptor = descriptorFor('browser', { tabId: 'temporary', initialUrl: 'https://example.test' })
    source.addPanel({ id: tabPanelId(descriptor), params: { descriptor } } as { id: string })
    state.notifyLayoutChanged()
    expect(useWorkspaceStore.getState().openTabs[tabPanelId(descriptor)]).toEqual(descriptor)
    const target = liveDock(); state.attachCourseApi('c2', target.asApi()); state.setActiveCourse('c2'); await settle()
    state.setActiveCourse(null)
    expect(useWorkspaceStore.getState().openTabs[tabPanelId(descriptor)]).toEqual(descriptor)
    expect(source.panels).toHaveLength(1)
    expect(invokeMock.mock.calls.filter(([channel, request]) => channel === 'layout:save' && (request as { courseId: string | null }).courseId === null)).toHaveLength(0)
  })

  test('identity collision leaves both panels and original content untouched', async () => {
    const { source, target, panel, descriptor } = await ready()
    target.addPanel({ id: panel.id, params: { descriptor } } as { id: string })
    expect(await moveWorkspacePanel({ sourceCourseId: 'c1', targetCourseId: 'c2', panelId: panel.id })).toBe(false)
    expect(source.getPanel(panel.id)).toBe(panel)
    expect(target.panels).toHaveLength(1)
  })

  test('a source-only edit after exhausted atomic persistence wakes the entire unacknowledged pair', async () => {
    const { source, panel, target } = await ready()
    // Use a persistent note for the restart ownership assertion.
    source.removePanel(panel)
    const material = source.addPanel({ id: tabPanelId(pdfA), params: { descriptor: pdfA } } as { id: string })
    let failing = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    invokeMock.mockImplementation(channel => channel === 'layout:saveMany' && failing ? Promise.reject(new Error('disk full')) : Promise.resolve({ ok: true }))
    expect(await moveWorkspacePanel({ sourceCourseId: 'c1', targetCourseId: 'c2', panelId: material.id })).toBe(true)
    await vi.advanceTimersByTimeAsync(1750)
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'layout:saveMany')).toHaveLength(4)
    failing = false
    useWorkspaceStore.getState().saveRetainedLayout('c1', singleLeafLayout([pdfB]) as ReturnType<DockviewApi['toJSON']>)
    await vi.advanceTimersByTimeAsync(1000)
    const batch = invokeMock.mock.calls.filter(([channel]) => channel === 'layout:saveMany').at(-1)![1] as { layouts: { courseId: string; layout: { panels: Record<string, unknown> } }[] }
    expect(batch.layouts.map(entry => entry.courseId).sort()).toEqual(['c1', 'c2'])
    expect(Object.keys(batch.layouts.find(entry => entry.courseId === 'c2')!.layout.panels)).toContain(target.panels[0]!.id)
    consoleError.mockRestore()
  })
})

describe('active panel source identity', () => {
  test('global home retains exact duplicate and live browser ownership while blocking hidden tab actions', async () => {
    const dock = new FakeDockview(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachApi(dock.asApi()); await settle()
    const browser = descriptorFor('browser', { tabId: 'live-page', initialUrl: 'https://example.com/' })
    const duplicateId = `${tabPanelId(browser)}::duplicate::view`
    const panel = Object.assign(dock.addPanel({ id: duplicateId }), { params: { descriptor: browser } })
    dock.json = singleLeafLayout([browser]); state.notifyLayoutChanged(); dock.activate(duplicateId)
    const clearCount = dock.clearCount
    state.showLearningHome()
    expect(useWorkspaceStore.getState()).toMatchObject({ surface: 'learning-home', activeCourseId: 'c1', activePanelId: null })
    expect(dock.clearCount).toBe(clearCount)
    expect(dock.activePanel).toBe(panel)
    expect(state.activePanelSource()).toBeNull(); expect(state.activeTabDescriptor()).toBeNull(); expect(state.activeBrowserTabId()).toBeNull()
    expect(browserTabCourseId('live-page')).toBe('c1')
    await state.closeActiveTab(); state.activateTabAt(0); state.activateLastTab(); state.activateRelativeTab(1)
    expect(panel.api.close).not.toHaveBeenCalled(); expect(panel.api.setActive).not.toHaveBeenCalled()
    state.showCourseWorkspace('c1')
    expect(state.activePanelSource()).toEqual({ panelId: duplicateId, descriptor: browser })
    expect(dock.clearCount).toBe(clearCount)
  })

  test('late hydration and queued opens cannot pull the student away from global home', async () => {
    let resolve!: (value: { layout: unknown }) => void
    invokeMock.mockImplementation(channel => channel === 'layout:get' ? new Promise(r => { resolve = r }) : Promise.resolve({ ok: true }))
    const dock = new FakeDockview(), state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachApi(dock.asApi())
    state.openTab(pdfB); state.showLearningHome()
    resolve({ layout: singleLeafLayout([pdfA]) }); await settle()
    expect(useWorkspaceStore.getState()).toMatchObject({ surface: 'learning-home', hydration: 'ready', activePanelId: null })
    expect(dock.addPanelCalls).toHaveLength(1)
    expect(state.activePanelSource()).toBeNull()
  })
  test('focus events publish the exact duplicate without starting a layout save', async () => {
    const dock = new FakeDockview()
    const state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachApi(dock.asApi()); await settle()
    const original = Object.assign(dock.addPanel({ id: tabPanelId(pdfA) }), { params: { descriptor: pdfA } })
    const duplicate = Object.assign(dock.addPanel({ id: `${tabPanelId(pdfA)}:duplicate:one` }), { params: { descriptor: pdfA } })
    dock.activate(original.id)
    expect(useWorkspaceStore.getState().activePanelSource()).toEqual({ panelId: original.id, descriptor: pdfA })
    dock.activate(duplicate.id)
    expect(useWorkspaceStore.getState().activePanelId).toBe(duplicate.id)
    expect(useWorkspaceStore.getState().activePanelSource()).toEqual({ panelId: duplicate.id, descriptor: pdfA })
    await vi.advanceTimersByTimeAsync(1500)
    expect(savesFor('c1')).toHaveLength(0)
    dock.activate()
    expect(useWorkspaceStore.getState().activePanelId).toBeNull()
    expect(useWorkspaceStore.getState().activePanelSource()).toBeNull()
  })

  test('retained inactive courses cannot change the current source and listeners are disposed', async () => {
    const first = new FakeDockview(), second = new FakeDockview()
    const state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', first.asApi()); await settle()
    Object.assign(first.addPanel({ id: 'first' }), { params: { descriptor: pdfA } }); first.activate('first')
    state.attachCourseApi('c2', second.asApi()); state.setActiveCourse('c2'); await settle()
    const other = descriptorFor('note', { courseId: 'c2', relPath: 'note.md' })
    Object.assign(second.addPanel({ id: 'second' }), { params: { descriptor: other } }); second.activate('second')
    expect(first.activeListeners.size).toBe(0)
    first.activate()
    expect(useWorkspaceStore.getState().activePanelSource()).toEqual({ panelId: 'second', descriptor: other })
    state.detachCourseApi('c2')
    expect(second.activeListeners.size).toBe(0)
    expect(useWorkspaceStore.getState().activePanelSource()).toBeNull()
  })

  test('hydration hides stale sources then publishes the restored active panel', async () => {
    let resolve!: (value: { layout: unknown }) => void
    invokeMock.mockImplementation((channel: string) => channel === 'layout:get'
      ? new Promise(r => { resolve = r }) : Promise.resolve({ ok: true }))
    const dock = new FakeDockview(), state = useWorkspaceStore.getState()
    const restore = dock.fromJSON.bind(dock)
    dock.fromJSON = layout => { restore(layout); dock.activate(tabPanelId(pdfA)) }
    state.setActiveCourse('c1'); state.attachApi(dock.asApi())
    Object.assign(dock.addPanel({ id: 'stale' }), { params: { descriptor: pdfB } }); dock.activate('stale')
    expect(useWorkspaceStore.getState().activePanelId).toBeNull()
    expect(useWorkspaceStore.getState().activePanelSource()).toBeNull()
    resolve({ layout: singleLeafLayout([pdfA]) }); await settle()
    expect(useWorkspaceStore.getState().activePanelSource()).toEqual({ panelId: tabPanelId(pdfA), descriptor: pdfA })
    state.detachApi()
    expect(dock.activeListeners.size).toBe(0)
    expect(useWorkspaceStore.getState().activePanelId).toBeNull()
  })
})

describe('deleted learning space tabs', () => {
  test('root project deletion closes its own learning tab while preserving ordinary course materials', async () => {
    const binding = { courseId: 'c1', rootRelPath: '' }
    const learning = descriptorFor('learning', { ...binding, view: 'home' })
    const dock = new FakeDockview()
    const state = useWorkspaceStore.getState()
    state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi()); await settle()
    for (const descriptor of [learning, pdfA]) {
      const panel = Object.assign(dock.addPanel({ id: tabPanelId(descriptor) }), { params: { descriptor } })
      panel.api.close.mockImplementation(() => dock.removePanel(panel))
    }
    dock.toJSON = () => singleLeafLayout(dock.panels.map(panel => panel.params!.descriptor))
    await closeLearningSpace(binding, false)
    expect(dock.panels.map(panel => panel.params!.descriptor)).toEqual([pdfA])
  })

  test('nested cleanup reaches an evicted layout and leaves sibling folders intact', async () => {
    const binding = { courseId: 'c1', rootRelPath: 'Reading' }
    const learning = descriptorFor('learning', { ...binding })
    const owned = descriptorFor('note', { courseId: 'c1', relPath: 'Reading/단어장.md' })
    const sibling = descriptorFor('note', { courseId: 'c1', relPath: 'Reading Other/note.md' })
    useWorkspaceStore.getState().saveRetainedLayout('c1', singleLeafLayout([learning, owned, sibling]) as never)
    await closeLearningSpace(binding, false)
    expect(retainedTabDescriptors('c1')).toEqual([sibling])
  })

  test('close preflight respects native veto and standalone cleanup never saves its deleted course', async () => {
    const binding = { courseId: 'c1', rootRelPath: '' }
    const browser = descriptorFor('browser', { tabId: 'unsaved', initialUrl: 'https://example.com/' })
    useWorkspaceStore.getState().saveRetainedLayout('c1', singleLeafLayout([browser]) as never)
    const stop = registerTabCloseGuard(() => false)
    expect(await prepareCloseLearningSpace(binding, true)).toBe(false)
    expect(retainedTabDescriptors('c1')).toEqual([browser]); stop()
    expect(await prepareCloseLearningSpace(binding, true)).toBe(true)
    await closeLearningSpace(binding, true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(retainedTabDescriptors('c1')).toEqual([])
    expect(savesFor('c1')).toEqual([])
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hydration and course switching', () => {
  test('a failed layout read cannot overwrite saved tabs and can be retried', async () => {
    const dock = new FakeDockview()
    let unavailable = true
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:get') return unavailable
        ? Promise.reject(new Error('database is temporarily unavailable'))
        : Promise.resolve({ layout: singleLeafLayout([pdfA]) })
      return Promise.resolve({ ok: true })
    })
    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse('c1')
    await settle()
    expect(useWorkspaceStore.getState().hydration).toBe('error')
    useWorkspaceStore.getState().notifyLayoutChanged()
    useWorkspaceStore.getState().flushPendingSave()
    await vi.advanceTimersByTimeAsync(2000)
    expect(savesFor('c1')).toEqual([])
    unavailable = false
    useWorkspaceStore.getState().retryHydration()
    await settle()
    expect(useWorkspaceStore.getState().hydration).toBe('ready')
    expect(useWorkspaceStore.getState().openTabs[tabPanelId(pdfA)]).toEqual(pdfA)
  })

  test('attachApi hydrates the already-selected course', async () => {
    // Arrange
    const dock = new FakeDockview()
    useWorkspaceStore.getState().setActiveCourse('c1')
    expect(useWorkspaceStore.getState().hydration).toBe('loading')

    // Act
    useWorkspaceStore.getState().attachApi(dock.asApi())
    await settle()

    // Assert
    expect(invokeMock).toHaveBeenCalledWith('layout:get', { courseId: 'c1' })
    expect(useWorkspaceStore.getState().hydration).toBe('ready')
    expect(useWorkspaceStore.getState().openTabs).toEqual({})
  })

  test('a valid persisted layout is restored into dockview', async () => {
    // Arrange
    const dock = new FakeDockview()
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:get')
        return Promise.resolve({ layout: singleLeafLayout([pdfA, pdfB]) })
      return Promise.resolve({ ok: true })
    })

    // Act
    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse('c1')
    await settle()

    // Assert
    expect(dock.fromJSONCalls).toHaveLength(1)
    expect(Object.keys(useWorkspaceStore.getState().openTabs).sort()).toEqual(
      [tabPanelId(pdfA), tabPanelId(pdfB)].sort()
    )
    // Healthy document → no cleanup re-save scheduled.
    await vi.advanceTimersByTimeAsync(2000)
    expect(savesFor('c1')).toHaveLength(0)
  })

  test('a layout with an unknown tab kind is cleaned and re-saved', async () => {
    // Arrange
    const doc = singleLeafLayout([pdfA]) as {
      grid: { root: { data: { views: string[] } } }
      panels: Record<string, unknown>
    }
    doc.grid.root.data.views.push('terminal:x')
    doc.panels['terminal:x'] = {
      id: 'terminal:x',
      contentComponent: 'terminal',
      params: { descriptor: { kind: 'terminal', payload: {} } }
    }
    const dock = new FakeDockview()
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:get') return Promise.resolve({ layout: doc })
      return Promise.resolve({ ok: true })
    })

    // Act
    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse('c1')
    await settle()

    // Assert: dockview only ever saw the cleaned document.
    const restored = dock.fromJSONCalls[0] as { panels: Record<string, unknown> }
    expect(Object.keys(restored.panels)).toEqual([tabPanelId(pdfA)])
    expect(useWorkspaceStore.getState().openTabs).toEqual({
      [tabPanelId(pdfA)]: pdfA
    })
    // The cleaned layout is persisted so the next boot starts healthy.
    await vi.advanceTimersByTimeAsync(1000)
    expect(savesFor('c1')).toHaveLength(1)
  })

  test('a malformed document falls back to an empty layout without crashing', async () => {
    const dock = new FakeDockview()
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:get')
        return Promise.resolve({ layout: { totally: 'broken' } })
      return Promise.resolve({ ok: true })
    })

    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse('c1')
    await settle()

    expect(dock.fromJSONCalls).toHaveLength(0)
    expect(useWorkspaceStore.getState().hydration).toBe('ready')
    expect(useWorkspaceStore.getState().openTabs).toEqual({})
  })

  test('rapid course switching: a stale layout:get result is discarded', async () => {
    // Arrange: c1 resolves slowly, c2 resolves fast.
    const dock = new FakeDockview()
    let resolveC1: (value: { layout: unknown }) => void = () => {}
    invokeMock.mockImplementation((channel: string, req: unknown) => {
      if (channel === 'layout:get') {
        const courseId = (req as { courseId: string }).courseId
        if (courseId === 'c1') {
          return new Promise((resolve) => {
            resolveC1 = resolve
          })
        }
        return Promise.resolve({ layout: singleLeafLayout([pdfB]) })
      }
      return Promise.resolve({ ok: true })
    })
    useWorkspaceStore.getState().attachApi(dock.asApi())
    await settle()

    // Act: switch to c1, then immediately to c2; c1's slow load lands last.
    useWorkspaceStore.getState().setActiveCourse('c1')
    useWorkspaceStore.getState().setActiveCourse('c2')
    await settle()
    resolveC1({ layout: singleLeafLayout([pdfA]) })
    await settle()

    // Assert: only c2's layout was mounted; c1's response was dropped.
    expect(dock.fromJSONCalls).toHaveLength(1)
    expect(useWorkspaceStore.getState().activeCourseId).toBe('c2')
    expect(useWorkspaceStore.getState().openTabs).toEqual({
      [tabPanelId(pdfB)]: pdfB
    })
  })
})

describe('openTab / closeTab / closeOthers', () => {
  async function readyOn(courseId: string): Promise<FakeDockview> {
    const dock = new FakeDockview()
    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse(courseId)
    await settle()
    return dock
  }

  test('openTab dedupes by identity: second open focuses the existing panel', async () => {
    // Arrange
    const dock = await readyOn('c1')

    // Act
    useWorkspaceStore.getState().openTab(pdfA)
    useWorkspaceStore
      .getState()
      .openTab(descriptorFor('pdf', { courseId: 'c1', relPath: 'a.pdf' }))

    // Assert
    expect(dock.addPanelCalls).toHaveLength(1)
    expect(dock.panels[0]!.api.setActive).toHaveBeenCalledTimes(1)
  })

  test('openTab passes kind as component and descriptor as params', async () => {
    const dock = await readyOn('c1')

    useWorkspaceStore.getState().openTab(pdfA)

    expect(dock.addPanelCalls[0]).toMatchObject({
      id: tabPanelId(pdfA),
      component: 'pdf',
      title: 'a.pdf',
      params: { descriptor: pdfA }
    })
  })

  test('closeTab closes the matching panel; closeOthers spares the target', async () => {
    const dock = await readyOn('c1')
    useWorkspaceStore.getState().openTab(pdfA)
    useWorkspaceStore.getState().openTab(pdfB)
    const [panelA, panelB] = dock.panels as [FakePanel, FakePanel]

    useWorkspaceStore.getState().closeTab(panelA.id)
    expect(panelA.api.close).toHaveBeenCalledTimes(1)

    useWorkspaceStore.getState().closeOthers(panelB.id)
    expect(panelB.api.close).not.toHaveBeenCalled()
    expect(panelA.api.close).toHaveBeenCalledTimes(2)
  })
})

describe('debounced structural saves', () => {
  async function readyWithLayout(): Promise<FakeDockview> {
    const dock = new FakeDockview()
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:get')
        return Promise.resolve({ layout: singleLeafLayout([pdfA]) })
      return Promise.resolve({ ok: true })
    })
    useWorkspaceStore.getState().attachApi(dock.asApi())
    useWorkspaceStore.getState().setActiveCourse('c1')
    await settle()
    return dock
  }

  test('structural change saves once after the 1s debounce', async () => {
    // Arrange
    const dock = await readyWithLayout()

    // Act: two structural changes in quick succession.
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()
    await vi.advanceTimersByTimeAsync(300)
    dock.json = singleLeafLayout([pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    // Assert: nothing yet, then exactly one save with the latest layout.
    expect(savesFor('c1')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    const saves = savesFor('c1')
    expect(saves).toHaveLength(1)
    expect(saves[0]).toEqual(singleLeafLayout([pdfB]))
  })

  test('keeps a save pending until its IPC ACK resolves', async () => {
    const dock = await readyWithLayout()
    let resolveSave: (() => void) | undefined
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:save') {
        return new Promise((resolve) => {
          resolveSave = () => resolve({ ok: true })
        })
      }
      return Promise.resolve({ layout: null })
    })
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    await vi.advanceTimersByTimeAsync(1000)
    expect(savesFor('c1')).toHaveLength(1)
    useWorkspaceStore.getState().flushPendingSave()
    expect(savesFor('c1')).toHaveLength(1)

    resolveSave?.()
    await settle()
    useWorkspaceStore.getState().flushPendingSave()
    expect(savesFor('c1')).toHaveLength(1)
  })

  test('retries a failed save three times with exponential backoff then toasts once', async () => {
    const dock = await readyWithLayout()
    const saveError = new Error('disk full')
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'layout:save') return Promise.reject(saveError)
      return Promise.resolve({ layout: null })
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    await vi.advanceTimersByTimeAsync(1000)
    expect(savesFor('c1')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(savesFor('c1')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(savesFor('c1')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(savesFor('c1')).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1000)
    expect(savesFor('c1')).toHaveLength(4)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(showToastMock).toHaveBeenCalledOnce()
    expect(showToastMock).toHaveBeenCalledWith(
      '작업 공간을 저장하지 못했어요',
      'danger'
    )

    useWorkspaceStore.getState().flushPendingSave()
    await vi.runOnlyPendingTimersAsync()
    expect(savesFor('c1')).toHaveLength(4)
    consoleError.mockRestore()
  })

  test('awaitable flush drains an in-flight layout and the newer snapshot before a transition', async () => {
    const dock = await readyWithLayout()
    const acknowledgements: Array<() => void> = []
    invokeMock.mockImplementation((channel: string) => channel === 'layout:save'
      ? new Promise(resolve => { acknowledgements.push(() => resolve({ ok: true })) })
      : Promise.resolve({ layout: null }))
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()
    const finished = vi.fn()
    const pending = useWorkspaceStore.getState().flushPendingSave().then(finished)
    expect(acknowledgements).toHaveLength(1)
    dock.json = singleLeafLayout([pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()
    acknowledgements.shift()!(); await settle()
    expect(finished).not.toHaveBeenCalled()
    expect(acknowledgements).toHaveLength(1)
    acknowledgements.shift()!(); await pending
    expect(finished).toHaveBeenCalledOnce()
  })

  test('awaitable flush rejects exhausted retries while preserving the unsaved layout', async () => {
    const dock = await readyWithLayout()
    invokeMock.mockImplementation((channel: string) => channel === 'layout:save'
      ? Promise.reject(new Error('disk full')) : Promise.resolve({ layout: null }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()
    const rejected = expect(useWorkspaceStore.getState().flushPendingSave()).rejects.toThrow('작업 공간을 저장하지 못해 전환하지 않았어요')
    await vi.runAllTimersAsync(); await rejected
    expect(savesFor('c1')).toHaveLength(4)
    expect(dock.json).toEqual(singleLeafLayout([pdfA, pdfB]))
    await expect(useWorkspaceStore.getState().flushPendingSave()).rejects.toThrow('작업 공간을 저장하지 못해 전환하지 않았어요')
    consoleError.mockRestore()
  })

  test('an empty pre-login workspace has no layout writes to await', async () => {
    await expect(useWorkspaceStore.getState().flushPendingSave()).resolves.toBeUndefined()
    expect(savesFor('c1')).toHaveLength(0)
  })

  test('pure focus changes (decorative churn) never trigger a save', async () => {
    // Arrange
    const dock = await readyWithLayout()

    // Act: same structure, different activeGroup/activeView.
    dock.json = singleLeafLayout([pdfA], 'g-other')
    useWorkspaceStore.getState().notifyLayoutChanged()
    await vi.advanceTimersByTimeAsync(3000)

    // Assert
    expect(savesFor('c1')).toHaveLength(0)
  })

  test('switching course flushes the pending save immediately', async () => {
    // Arrange
    const dock = await readyWithLayout()
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()
    expect(savesFor('c1')).toHaveLength(0)

    // Act: switch before the debounce elapses.
    useWorkspaceStore.getState().setActiveCourse('c2')

    // Assert: the outgoing course's layout was saved synchronously.
    expect(savesFor('c1')).toHaveLength(1)
    expect(savesFor('c1')[0]).toEqual(singleLeafLayout([pdfA, pdfB]))
    // And no duplicate save later.
    await vi.advanceTimersByTimeAsync(3000)
    expect(savesFor('c1')).toHaveLength(1)
  })

  test('flushPendingSave sends a scheduled save early (beforeunload path)', async () => {
    const dock = await readyWithLayout()
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    useWorkspaceStore.getState().flushPendingSave()

    expect(savesFor('c1')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(savesFor('c1')).toHaveLength(1)
  })

  test('discardPendingSave drops a queued save for a deleted course', async () => {
    // Arrange
    const dock = await readyWithLayout()
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    // Act: the course was deleted before the debounce elapsed.
    useWorkspaceStore.getState().discardPendingSave('c1')
    await vi.advanceTimersByTimeAsync(3000)

    // Assert: no save was sent for the dead course.
    expect(savesFor('c1')).toHaveLength(0)
  })

  test('discardPendingSave for another course leaves the save alone', async () => {
    // Arrange
    const dock = await readyWithLayout()
    dock.json = singleLeafLayout([pdfA, pdfB])
    useWorkspaceStore.getState().notifyLayoutChanged()

    // Act
    useWorkspaceStore.getState().discardPendingSave('c-other')
    await vi.advanceTimersByTimeAsync(3000)

    // Assert
    expect(savesFor('c1')).toHaveLength(1)
  })
})

test('retained courses reuse their own Dockview without clearing or hydrating again', async () => {
  const first = new FakeDockview(), second = new FakeDockview()
  const state = useWorkspaceStore.getState()
  state.setActiveCourse('c1')
  state.attachCourseApi('c1', first.asApi())
  await settle()
  first.json = singleLeafLayout([pdfA])
  state.notifyLayoutChanged()
  state.attachCourseApi('c2', second.asApi())
  state.setActiveCourse('c2')
  await settle()
  const clears = first.clearCount
  state.setActiveCourse('c1')
  expect(useWorkspaceStore.getState().hydration).toBe('ready')
  expect(first.clearCount).toBe(clears)
  expect(useWorkspaceStore.getState().openTabs[tabPanelId(pdfA)]).toEqual(pdfA)
  expect(invokeMock.mock.calls.filter(([channel]) => channel === 'layout:get')).toHaveLength(2)
})

test('a delayed browser profile switch and hidden popup keep their original course', async () => {
  resetBrowserGuestsForTests()
  const first = new FakeDockview(), second = new FakeDockview()
  const state = useWorkspaceStore.getState()
  const initialUrl = 'https://example.com'
  const browser = descriptorFor('browser', { tabId: 'owner-tab', initialUrl })
  state.setActiveCourse('c1')
  state.attachCourseApi('c1', first.asApi())
  await settle()
  first.json = singleLeafLayout([browser])
  state.notifyLayoutChanged()
  const owner = browserTabCourseId('owner-tab')
  expect(owner).toBe('c1')
  useBrowserGuests.getState().ensureGuest('owner-tab', initialUrl, false, 'default', owner)

  // Native beforeunload/profile confirmation finishes after the user changes course.
  state.attachCourseApi('c2', second.asApi())
  state.setActiveCourse('c2')
  useCoursesStore.setState({ selectedCourseId: 'c2' })
  await settle()
  expect(browserTabCourseId('owner-tab')).toBe('c1')
  useBrowserGuests.getState().ensureGuest('owner-tab', initialUrl, false, 'school', owner)
  useBrowserGuests.getState().updateNav('owner-tab', { url: 'https://example.com/late', title: 'Late navigation' })
  expect(invokeMock).toHaveBeenCalledWith('browser:recordVisit', {
    profileId: 'school', url: 'https://example.com/late', title: 'Late navigation', courseId: 'c1'
  })

  // Adopted popups can be present in a hidden Dockview before its snapshot refreshes.
  const popup = descriptorFor('browser', { tabId: 'hidden-popup', initialUrl: 'https://example.com/popup' })
  Object.assign(first.addPanel({ id: tabPanelId(popup) }), { params: { descriptor: popup } })
  expect(browserTabCourseId('hidden-popup')).toBe('c1')
  expect(browserTabCourseId('unknown-tab')).toBeNull()
  resetBrowserGuestsForTests()
  useCoursesStore.setState({ selectedCourseId: null })
})

test('browser ownership and navigation survive eviction of the course Dockview', async () => {
  const first = new FakeDockview(), second = new FakeDockview()
  const state = useWorkspaceStore.getState()
  const browser = descriptorFor('browser', { tabId: 'retained-page', initialUrl: 'https://example.com/start' })
  const privatePage = descriptorFor('browser', { tabId: 'private-page', initialUrl: 'https://example.com/private', isPrivate: true })
  state.setActiveCourse('c1')
  state.attachCourseApi('c1', first.asApi())
  await settle()
  first.json = singleLeafLayout([browser, privatePage])
  state.notifyLayoutChanged()
  state.attachCourseApi('c2', second.asApi())
  state.setActiveCourse('c2')
  await settle()
  state.detachCourseApi('c1')
  expect(retainedTabDescriptors('c1')).toEqual([browser, privatePage])
  expect(browserTabCourseId('retained-page')).toBe('c1')
  state.rememberDetachedBrowserPage('retained-page', 'https://example.com/next', 'Next page')
  const updated = retainedTabDescriptors('c1')[0]!
  expect(updated).toMatchObject({ payload: { initialUrl: 'https://example.com/next' } })
  state.setActiveCourse('c1')
  const restored = new FakeDockview()
  state.attachCourseApi('c1', restored.asApi())
  await settle()
  expect(useWorkspaceStore.getState().openTabs[tabPanelId(browser)]).toEqual(updated)
  expect(useWorkspaceStore.getState().openTabs[tabPanelId(privatePage)]).toEqual(privatePage)
  expect(invokeMock.mock.calls.filter(([channel]) => channel === 'layout:get')).toHaveLength(2)
})

test('popups and site close requests update their evicted course without touching the current course', async () => {
  const first = new FakeDockview(), second = new FakeDockview()
  const state = useWorkspaceStore.getState()
  const browser = descriptorFor('browser', { tabId: 'opener', initialUrl: 'https://example.com' })
  const popup = descriptorFor('browser', { tabId: 'late-popup', initialUrl: 'https://example.com/popup' })
  state.setActiveCourse('c1')
  state.attachCourseApi('c1', first.asApi())
  await settle()
  first.json = singleLeafLayout([browser])
  state.notifyLayoutChanged()
  state.attachCourseApi('c2', second.asApi())
  state.setActiveCourse('c2')
  await settle()
  state.detachCourseApi('c1')
  expect(openBrowserTabInCourse(popup, 'c1', false)).toBe(true)
  expect(retainedTabDescriptors('c1')).toEqual([browser, popup])
  expect(browserTabCourseId('late-popup')).toBe('c1')
  expect(second.addPanelCalls).toHaveLength(0)
  expect(useWorkspaceStore.getState().activeCourseId).toBe('c2')
  closeBrowserTab('late-popup')
  expect(retainedTabDescriptors('c1')).toEqual([browser])
  closeBrowserTab('opener')
  expect(retainedTabDescriptors('c1')).toEqual([])
  expect(openBrowserTabInCourse(popup, 'c1', true)).toBe(true)
  expect(retainedTabDescriptors('c1')).toEqual([popup])
  state.discardPendingSave('c1')
  expect(retainedTabDescriptors('c1')).toEqual([])
  expect(openBrowserTabInCourse(browser, 'c1', false)).toBe(false)
  expect(openBrowserTabInCourse(browser, 'unknown-course', false)).toBe(false)
  expect(second.addPanelCalls).toHaveLength(0)
})

test('a managed browser open revoked during hydration never appears after restore', async () => {
  let resolve!: (value: { layout: unknown }) => void
  invokeMock.mockImplementation((channel: string) => channel === 'layout:get'
    ? new Promise(r => { resolve = r }) : Promise.resolve({ ok: true }))
  const dock = new FakeDockview(), state = useWorkspaceStore.getState()
  state.setActiveCourse('c1'); state.attachCourseApi('c1', dock.asApi())
  let activeAttempt = true
  const login = descriptorFor('browser', { tabId: 'login', initialUrl: 'https://auth.openai.com/login', isPrivate: true })
  expect(openBrowserTabInCourse(login, 'c1', false, undefined, () => activeAttempt)).toBe(true)
  state.openTab(pdfB)
  expect(dock.addPanelCalls).toHaveLength(0)
  activeAttempt = false; resolve({ layout: singleLeafLayout([pdfA]) }); await settle()
  expect(dock.addPanelCalls.map(panel => panel.id)).toEqual([tabPanelId(pdfB)])
})

test('a file selected during hydration opens after restore instead of being discarded', async () => {
  let resolve!: (value: { layout: unknown }) => void
  invokeMock.mockImplementation((channel: string) => channel === 'layout:get'
    ? new Promise(r => { resolve = r }) : Promise.resolve({ ok: true }))
  const dock = new FakeDockview(), state = useWorkspaceStore.getState()
  state.setActiveCourse('c1')
  state.attachCourseApi('c1', dock.asApi())
  state.openTab(pdfB)
  expect(dock.addPanelCalls).toHaveLength(0)
  resolve({ layout: singleLeafLayout([pdfA]) })
  await settle()
  expect(dock.addPanelCalls).toHaveLength(1)
  expect(dock.addPanelCalls[0]?.id).toBe(tabPanelId(pdfB))
})


describe('consistent user tab closure and restoration', () => {
  async function ready() {
    const dock = new FakeDockview()
    const state = useWorkspaceStore.getState()
    state.attachApi(dock.asApi())
    state.setActiveCourse('c1')
    await settle()
    state.openTab(pdfA)
    state.openTab(pdfB)
    for (const [index, panel] of dock.panels.entries()) {
      Object.assign(panel, { params: { descriptor: index === 0 ? pdfA : pdfB }, title: index === 0 ? 'A document' : 'B document' })
    }
    return { dock, state }
  }

  test('a close veto preserves the tab and does not create a restore entry', async () => {
    const { dock, state } = await ready()
    const unregister = registerTabCloseGuard(async () => false)
    try {
      await state.closeTab(dock.panels[0]!.id)
      expect(dock.panels[0]!.api.close).not.toHaveBeenCalled()
      state.reopenClosedTab()
      expect(dock.addPanelCalls).toHaveLength(2)
    } finally { unregister() }
  })

  test('repeated closes share the pending native decision and restore the same panel and location', async () => {
    const { dock, state } = await ready()
    const panel = dock.panels[0]!
    const group = { id: 'original-group', panels: dock.panels }
    Object.assign(panel, { group })
    Object.assign(dock, { groups: [group] })
    panel.api.close.mockImplementation(() => dock.removePanel(panel))
    let resolve!: (allowed: boolean) => void
    const guard = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    const unregister = registerTabCloseGuard(guard)
    try {
      const first = state.closeTab(panel.id)
      const second = state.closeTab(panel.id)
      expect(guard).toHaveBeenCalledOnce()
      resolve(true)
      await Promise.all([first, second])
      expect(panel.api.close).toHaveBeenCalledOnce()
      state.reopenClosedTab()
      expect(dock.addPanelCalls.at(-1)).toMatchObject({ id: panel.id, title: 'A document', params: { descriptor: pdfA }, position: { referenceGroup: group, index: 0 } })
    } finally { unregister() }
  })

  test('group closure leaves other split groups open; workspace closure reaches them', async () => {
    const { dock, state } = await ready()
    const [first, second] = dock.panels
    Object.assign(first!, { group: { panels: [first] } })
    await state.closeOthers(first!.id)
    expect(second!.api.close).not.toHaveBeenCalled()
    await state.closeOthers(first!.id, 'workspace')
    expect(second!.api.close).toHaveBeenCalledOnce()
  })

  test('batch closures wait for each decision and retain only vetoed tabs', async () => {
    const { dock, state } = await ready()
    const [first, second] = dock.panels
    const guard = vi.fn(async (descriptor: TabDescriptor) => descriptor !== pdfA)
    const unregister = registerTabCloseGuard(guard)
    try {
      await state.closeTabs([first!.id, second!.id])
      expect(guard.mock.calls.map(([descriptor]) => descriptor)).toEqual([pdfA, pdfB])
      expect(first!.api.close).not.toHaveBeenCalled()
      expect(second!.api.close).toHaveBeenCalledOnce()
    } finally { unregister() }
  })

  test('closed tabs remain scoped to their course after switching away and back', async () => {
    const { dock, state } = await ready()
    const first = dock.panels[0]!
    await state.closeTab(first.id)
    state.setActiveCourse('c2')
    await settle()
    state.reopenClosedTab()
    expect(dock.addPanelCalls).toHaveLength(2)
    state.setActiveCourse('c1')
    await settle()
    state.reopenClosedTab()
    expect(dock.addPanelCalls).toHaveLength(3)
    expect(dock.addPanelCalls.at(-1)).toMatchObject({ id: first.id, params: { descriptor: pdfA } })
  })

  test('private pages do not enter closed history', async () => {
    const { dock, state } = await ready()
    const panel = dock.panels[0]!
    Object.assign(panel, { params: { descriptor: descriptorFor('browser', { tabId: 'secret', initialUrl: 'https://example.test', isPrivate: true }) } })
    await state.closeTab(panel.id)
    state.reopenClosedTab()
    expect(dock.addPanelCalls).toHaveLength(2)
  })

  test('the modifier new-instance path allocates a distinct browser page', async () => {
    const { dock, state } = await ready()
    const descriptor = descriptorFor('browser', { tabId: 'source', initialUrl: 'https://example.test/current', profileId: 'school' })
    state.openTab(descriptor, { newInstance: true })
    const params = dock.addPanelCalls.at(-1)!.params as { descriptor: typeof descriptor }
    expect(params.descriptor.payload.tabId).not.toBe('source')
    expect(params.descriptor.payload.profileId).toBe('school')
  })
})
