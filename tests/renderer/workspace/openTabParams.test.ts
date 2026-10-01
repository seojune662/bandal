import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  resetWorkspaceStoreForTests,
  useWorkspaceStore
} from '../../../src/renderer/src/stores/workspaceStore'
import { tabPanelId } from '../../../src/renderer/src/features/workspace/tabIdentity'
import type { TabDescriptor } from '../../../src/shared/tabs'

interface FakePanel {
  id: string
  params: { descriptor: TabDescriptor }
  api: { setActive: () => void; updateParameters: (params: unknown) => void }
}

function fakeApi(): {
  api: Record<string, unknown>
  panels: Map<string, FakePanel>
} {
  const panels = new Map<string, FakePanel>()
  const api = {
    getPanel: (id: string) => panels.get(id),
    addPanel: (options: {
      id: string
      params: { descriptor: TabDescriptor }
    }) => {
      const panel: FakePanel = {
        id: options.id,
        params: options.params,
        api: {
          setActive: vi.fn(),
          updateParameters: vi.fn((next: unknown) => {
            panel.params = next as { descriptor: TabDescriptor }
          })
        }
      }
      panels.set(options.id, panel)
      return panel
    },
    onDidLayoutChange: () => ({ dispose: () => {} }),
    toJSON: () => ({}),
    clear: () => panels.clear(),
    panels: [] as unknown[]
  }
  return { api, panels }
}

const GROUP_A: TabDescriptor = {
  kind: 'chat',
  payload: { courseId: 'c1', conversationId: 'chat-1', sourcePanelId: 'note-a' }
}
const GROUP_B: TabDescriptor = {
  kind: 'chat',
  payload: { courseId: 'c1', conversationId: 'chat-1', sourcePanelId: 'note-b' }
}
describe('openTab on an existing panel', () => {
  beforeEach(() => {
    resetWorkspaceStoreForTests()
  })

  test('same conversation shares one expanded panel', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab(GROUP_B)

    expect(panels.size).toBe(1)
    expect(tabPanelId(GROUP_A)).toBe(tabPanelId(GROUP_B))
  })

  test('reopening with a different sourcePanelId updates the panel params', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab(GROUP_B)

    const panel = panels.get(tabPanelId(GROUP_A))
    expect(panel?.api.updateParameters).toHaveBeenCalledWith({
      descriptor: GROUP_B
    })
    // And the panel really carries B now, not A.
    expect(panel?.params.descriptor).toEqual(GROUP_B)
  })

  test('the panel is still focused after the params refresh', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab(GROUP_B)

    expect(panels.get(tabPanelId(GROUP_A))?.api.setActive).toHaveBeenCalled()
  })

  test('different courses still get their own panel', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab({
      kind: 'chat',
      payload: { courseId: 'c2', conversationId: 'chat-2', sourcePanelId: 'note-c' }
    })

    expect(panels.size).toBe(2)
  })
})
