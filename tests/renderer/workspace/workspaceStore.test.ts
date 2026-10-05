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

import { registerTabCloseGuard } from '../../../src/renderer/src/features/workspace/tabCloseGuard'
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
  useWorkspaceStore
} from '../../../src/renderer/src/stores/workspaceStore'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
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
  params?: { descriptor: TabDescriptor }
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

const pdfA = descriptorFor('pdf', { courseId: 'c1', relPath: 'a.pdf' })
const pdfB = descriptorFor('pdf', { courseId: 'c1', relPath: 'b.pdf' })

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
