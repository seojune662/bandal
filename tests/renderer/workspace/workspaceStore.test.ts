import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DockviewApi } from 'dockview'
import type { TabDescriptor } from '../../../src/shared/tabs'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  resetWorkspaceStoreForTests,
  useWorkspaceStore
} from '../../../src/renderer/src/stores/workspaceStore'
import {
  descriptorFor,
  tabPanelId
} from '../../../src/renderer/src/features/workspace/tabIdentity'

const invokeMock = vi.mocked(invoke)

// -- fake dockview api --------------------------------------------------------

interface FakePanel {
  id: string
  api: { setActive: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
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
  json: unknown = emptyLayout()
  fromJSONCalls: unknown[] = []
  addPanelCalls: Record<string, unknown>[] = []
  clearCount = 0

  getPanel(id: string): FakePanel | undefined {
    return this.panels.find((panel) => panel.id === id)
  }

  addPanel(options: { id: string }): FakePanel {
    const panel: FakePanel = {
      id: options.id,
      api: { setActive: vi.fn(), close: vi.fn() }
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
    this.json = emptyLayout()
  }

  fromJSON(data: unknown): void {
    this.fromJSONCalls.push(data)
    this.json = data
    const panels = (data as { panels: Record<string, unknown> }).panels
    this.panels = Object.keys(panels).map((id) => ({
      id,
      api: { setActive: vi.fn(), close: vi.fn() }
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
  invokeMock.mockImplementation((channel: string) => {
    if (channel === 'layout:get') return Promise.resolve({ layout: null })
    return Promise.resolve({ ok: true })
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
