// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DockviewReact, type DockviewApi } from 'dockview'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Watermark } from '../../../src/renderer/src/features/workspace/WorkspaceHost'
import { WorkspaceCourseContext } from '../../../src/renderer/src/features/workspace/placementContext'
import { applyWorkspaceLayout, closeWorkspacePanel, removeEmptyWorkspaceGroup } from '../../../src/renderer/src/features/workspace/workspaceLayout'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { resetWorkspaceStoreForTests, useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { createBrowserTab, createMarkdownTab } from '../../../src/renderer/src/app/tabCommands'
import { useNewTabMenu } from '../../../src/renderer/src/features/workspace/newTabMenuController'
import { useFileDropTarget } from '../../../src/renderer/src/features/materials/useFileDropTarget'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import type { Course } from '../../../src/shared/types/course'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(async () => DEFAULT_SETTINGS), onPush: vi.fn(() => () => {}), openSettingsWindow: vi.fn()
}))
vi.mock('../../../src/renderer/src/app/tabCommands', () => ({ createBrowserTab: vi.fn(), createMarkdownTab: vi.fn() }))
vi.mock('../../../src/renderer/src/features/materials/useFileDropTarget', () => ({
  useFileDropTarget: vi.fn(() => ({ isDropActive: false, dropProps: {} }))
}))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
vi.stubGlobal('cancelAnimationFrame', clearTimeout)

const roots: Root[] = []
const course = (id: string, name: string): Course => ({
  id, name, slug: id, color: 'blue', folderPath: `/courses/${id}`, source: 'managed', missing: false,
  archived: false, groupId: null, sortOrder: 0, createdAt: '', updatedAt: ''
})
beforeEach(() => {
  resetWorkspaceStoreForTests()
  useCoursesStore.setState({ courses: [course('placed', '선형대수'), course('selected', '다른 과목')], selectedCourseId: 'selected' })
})
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount() })
  resetWorkspaceStoreForTests()
  useNewTabMenu.getState().close()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function workspace() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  let api!: DockviewApi
  await act(async () => root.render(<WorkspaceCourseContext.Provider value="placed">
    <DockviewReact disableAutoResizing components={{ note: () => <div>note</div> }} watermarkComponent={Watermark}
      onReady={event => { api = event.api; api.layout(900, 650) }} />
  </WorkspaceCourseContext.Provider>))
  return { api, host }
}

test('the course welcome survives repeated last-tab closure and restoration of a saved empty pane', async () => {
  const { api, host } = await workspace()
  expect(host.querySelector('h1')?.textContent).toBe('선형대수')
  for (let index = 0; index < 3; index++) {
    await act(async () => { api.addPanel({ id: `note-${index}`, component: 'note' }) })
    expect(host.querySelector('.workspace-welcome')).toBeNull()
    await act(async () => { closeWorkspacePanel(api, `note-${index}`) })
    expect(api.groups).toHaveLength(1)
    expect(host.querySelector('h1')?.textContent).toBe('선형대수')
    expect(host.querySelector('.workspace-watermark__moon')).not.toBeNull()
    expect(host.querySelector('.workspace-empty-pane')).toBeNull()
  }
  const saved = api.toJSON()
  await act(async () => api.fromJSON(saved))
  expect(host.querySelector('h1')?.textContent).toBe('선형대수')
  expect(vi.mocked(useFileDropTarget)).toHaveBeenLastCalledWith('placed', '')
})

test('split placeholders become the course welcome when the other empty pane is removed', async () => {
  const { api, host } = await workspace()
  await act(async () => applyWorkspaceLayout(api, 'columns'))
  expect(host.querySelectorAll('.workspace-empty-pane')).toHaveLength(2)
  expect(host.querySelector('.workspace-welcome')).toBeNull()
  await act(async () => { removeEmptyWorkspaceGroup(api, api.groups[0]!.id) })
  // Dockview delivers its layout notification through a buffered emitter.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(api.groups).toHaveLength(1)
  expect(host.querySelectorAll('.workspace-empty-pane')).toHaveLength(0)
  expect(host.querySelector('h1')?.textContent).toBe('선형대수')
})

test('welcome actions use the retained pane placement even when a different course is selected', async () => {
  const { api, host } = await workspace()
  await act(async () => applyWorkspaceLayout(api, 'single'))
  const target = { courseId: 'placed', workspace: null, windowId: 'main', groupId: api.groups[0]!.id }
  const assistant = vi.spyOn(useUiStore.getState(), 'showAssistant').mockImplementation(() => {})
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.workspace-start-actions button')]
  expect(buttons).toHaveLength(3)
  await act(async () => { buttons.forEach(button => button.click()) })
  expect(createMarkdownTab).toHaveBeenCalledWith(undefined, target)
  expect(createBrowserTab).toHaveBeenCalledWith(undefined, target)
  expect(assistant).toHaveBeenCalledOnce()
  await act(async () => host.querySelector<HTMLButtonElement>('.workspace-watermark__cta')!.click())
  expect(useNewTabMenu.getState().anchor?.target).toEqual(target)
})
