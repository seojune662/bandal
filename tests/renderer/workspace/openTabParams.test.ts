/**
 * `openTab` on an ALREADY-OPEN panel must refresh its params.
 *
 * The panel id does not always capture the whole payload. A 함께하기 tab is
 * keyed by course (`group-chat:${courseId}`) but also carries the selected
 * `groupId`, so the original `setActive()`-only path meant clicking a
 * different group in the rail just focused the tab and kept showing the old
 * conversation — a silent no-op with no error anywhere.
 *
 * Every other tab kind derives its whole payload from the id, so this is
 * about group-chat specifically; the assertions below cover both cases.
 */

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
  kind: 'group-chat',
  payload: { courseId: 'c1', groupId: 'group-a' }
}
const GROUP_B: TabDescriptor = {
  kind: 'group-chat',
  payload: { courseId: 'c1', groupId: 'group-b' }
}
const GROUP_A_WHITEBOARD: TabDescriptor = {
  kind: 'group-chat',
  payload: { courseId: 'c1', groupId: 'group-a', view: 'whiteboard' }
}

describe('openTab on an existing panel', () => {
  beforeEach(() => {
    resetWorkspaceStoreForTests()
  })

  test('two groups in the same course share ONE panel', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab(GROUP_B)

    expect(panels.size).toBe(1)
    expect(tabPanelId(GROUP_A)).toBe(tabPanelId(GROUP_B))
  })

  test('reopening with a different groupId updates the panel params', () => {
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

  test('reopening with a different view updates the same panel params', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab(GROUP_A_WHITEBOARD)

    const panel = panels.get(tabPanelId(GROUP_A))
    expect(panels.size).toBe(1)
    expect(panel?.api.updateParameters).toHaveBeenCalledWith({
      descriptor: GROUP_A_WHITEBOARD
    })
    expect(panel?.params.descriptor).toEqual(GROUP_A_WHITEBOARD)
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
      kind: 'group-chat',
      payload: { courseId: 'c2', groupId: 'group-c' }
    })

    expect(panels.size).toBe(2)
  })

  test('the 과목 미지정 bucket is its own panel', () => {
    const { api, panels } = fakeApi()
    useWorkspaceStore.getState().attachApi(api as never)

    useWorkspaceStore.getState().openTab(GROUP_A)
    useWorkspaceStore.getState().openTab({
      kind: 'group-chat',
      payload: { courseId: null, groupId: 'group-x' }
    })

    expect(panels.size).toBe(2)
    expect(panels.has('group-chat:unassigned')).toBe(true)
  })
})
