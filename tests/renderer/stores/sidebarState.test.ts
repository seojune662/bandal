// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn() }))
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
beforeEach(() => useUiStore.setState({ leftRailOpen: true, courseRailOpen: true, isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false }))
test('course-only collapse leaves the menu available and whole-left reopening expands both', () => {
  useUiStore.getState().toggleCourseRail()
  expect(useUiStore.getState()).toMatchObject({ leftRailOpen: true, courseRailOpen: false })
  useUiStore.getState().toggleLeftRail()
  expect(useUiStore.getState().leftRailOpen).toBe(false)
  useUiStore.getState().toggleLeftRail()
  expect(useUiStore.getState()).toMatchObject({ leftRailOpen: true, courseRailOpen: true })
})
test('whole-left toggle preserves settings while course navigation returns to the list', () => {
  useUiStore.getState().openSettings('account')
  useUiStore.getState().toggleLeftRail()
  expect(useUiStore.getState()).toMatchObject({ isSettingsOpen: true, leftRailOpen: false })
  useUiStore.getState().showCourses()
  expect(useUiStore.getState()).toMatchObject({ leftRailOpen: true, courseRailOpen: true, isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false })
})
