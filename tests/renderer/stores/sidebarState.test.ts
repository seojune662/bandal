// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn() }))
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
beforeEach(() => useUiStore.setState({ leftRailOpen: true, courseRailOpen: true, leftRailPanel: 'courses', isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false }))
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

test('learning and plugin navigation switch the shared panel and reopen above overlays', () => {
  useUiStore.getState().toggleLearningPanel()
  expect(useUiStore.getState()).toMatchObject({ leftRailPanel: 'learning', courseRailOpen: true })
  useUiStore.getState().toggleLearningPanel()
  expect(useUiStore.getState()).toMatchObject({ leftRailPanel: 'learning', courseRailOpen: false })
  useUiStore.getState().togglePluginsPanel()
  expect(useUiStore.getState()).toMatchObject({ leftRailPanel: 'plugins', courseRailOpen: true })
  useUiStore.getState().openSettings('ai')
  useUiStore.getState().toggleLearningPanel()
  expect(useUiStore.getState()).toMatchObject({ leftRailPanel: 'learning', courseRailOpen: true, isSettingsOpen: false })
  useUiStore.getState().showCourses()
  expect(useUiStore.getState()).toMatchObject({ leftRailPanel: 'courses', courseRailOpen: true })
})

test.each(['ai', 'hide', 'settings', 'board', 'graph', 'scope'] as const)('materials expansion closes on %s while the remembered rail preference remains separate', transition => {
  const ui = useUiStore.getState()
  ui.setRightRailScope(`expansion-${transition}`)
  ui.showMaterials()
  ui.setMaterialsExpanded(true)
  expect(useUiStore.getState()).toMatchObject({ materialsExpanded: true, rightRailOpen: true })
  if (transition === 'ai') ui.toggleAiRail()
  else if (transition === 'hide') ui.toggleRightRail()
  else if (transition === 'settings') ui.openSettings('account')
  else if (transition === 'board') ui.toggleBoardOverlay()
  else if (transition === 'graph') ui.toggleLinkGraph()
  else ui.setRightRailScope('another-scope')
  expect(useUiStore.getState().materialsExpanded).toBe(false)
  const persisted = JSON.parse(localStorage.getItem('bandal:right-panels:v1')!)
  expect(persisted[`expansion-${transition}`]).not.toHaveProperty('materialsExpanded')
})

test.each([[1024, false], [1440, true]])('opening AI in a %ipx window leaves the course sidebar open: %s', (width, courseOpen) => {
  const original = window.innerWidth
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  try {
    useUiStore.setState({ aiRailOpen: false, courseRailOpen: true })
    useUiStore.getState().showAssistant()
    expect(useUiStore.getState()).toMatchObject({ aiRailOpen: true, courseRailOpen: courseOpen })
    useUiStore.getState().toggleAiRail()
    expect(useUiStore.getState().aiRailOpen).toBe(false)
  } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: original }) }
})
