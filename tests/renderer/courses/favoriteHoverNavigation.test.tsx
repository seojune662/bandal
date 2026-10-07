// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { FavoritesSection } from '../../../src/renderer/src/features/courses/FavoritesSection'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useFavoritesStore } from '../../../src/renderer/src/stores/favoritesStore'
import { resetWorkspaceStoreForTests, useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'
import { installWorkspaceCourseMoveNavigation, navigateWorkspaceCourseHover } from '../../../src/renderer/src/features/workspace/courseTabMoveNavigation'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({})), onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useT: () => (key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a trusted tab copied to favorites after folder hover keeps the destination before async save completes and preserves the original tab', async () => {
  const selectCourse = useCoursesStore.getState().selectCourse, favoriteAdd = useFavoritesStore.getState().add
  const workspaceActions = { closeTab: useWorkspaceStore.getState().closeTab, openTab: useWorkspaceStore.getState().openTab }
  const descriptor = { kind: 'note' as const, payload: { courseId: 'source', relPath: 'moving.md' } }
  const source = { courseId: 'source', panelId: 'original-panel', nonce: 'favorite-copy' }
  let resolve!: (value: never) => void
  const add = vi.fn(() => new Promise<never>(done => { resolve = done }))
  resetWorkspaceStoreForTests()
  useWorkspaceStore.setState({ activeCourseId: 'source', openTabs: { [source.panelId]: descriptor } })
  useCoursesStore.setState({ selectedCourseId: 'source', courses: ['source', 'target'].map(id => ({ id } as never)),
    selectCourse: id => { useCoursesStore.setState({ selectedCourseId: id }) } })
  useFavoritesStore.setState({ byCourse: { target: [] }, loadingByCourse: {}, add })
  const close = vi.spyOn(useWorkspaceStore.getState(), 'closeTab'), open = vi.spyOn(useWorkspaceStore.getState(), 'openTab')
  const stopNavigation = installWorkspaceCourseMoveNavigation()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FavoritesSection courseId="target" />))
    tabDragSession.beginTab(source); navigateWorkspaceCourseHover(source.nonce, 'target')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.assign(event, { dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], getData: (type: string) =>
      type === BANDAL_TAB_DRAG_MIME ? JSON.stringify({ descriptor, label: 'moving', source }) : '' } })
    act(() => {
      container.querySelector('.favorites-section')!.dispatchEvent(event)
      tabDragSession.end()
    })
    expect(event.defaultPrevented).toBe(true)
    expect(add).toHaveBeenCalledExactlyOnceWith({ courseId: 'target', label: 'moving', descriptor })
    expect(useCoursesStore.getState().selectedCourseId).toBe('target')
    expect(useWorkspaceStore.getState().openTabs).toEqual({ [source.panelId]: descriptor })
    expect(close).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
    await act(async () => resolve({} as never))
    expect(useCoursesStore.getState().selectedCourseId).toBe('target')
  } finally {
    act(() => root.unmount()); container.remove(); stopNavigation(); tabDragSession.end()
    vi.restoreAllMocks(); useCoursesStore.setState({ selectCourse }); useFavoritesStore.setState({ add: favoriteAdd })
    useWorkspaceStore.setState(workspaceActions); resetWorkspaceStoreForTests()
  }
})
