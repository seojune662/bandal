import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { beginWorkspaceCourseMoveDrop, finishWorkspaceCourseMoveDrop, installWorkspaceCourseMoveNavigation, navigateWorkspaceCourseHover, workspaceCourseMoveRetention } from '../../../src/renderer/src/features/workspace/courseTabMoveNavigation'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(async () => ({})), onPush: vi.fn(() => () => {}) }))
let dispose: () => void
const originalSelectCourse = useCoursesStore.getState().selectCourse
beforeEach(() => {
  useCoursesStore.setState({ selectCourse: originalSelectCourse, selectedCourseId: 'source', courses: ['source', 'target', 'third'].map(id => ({ id } as never)) })
  vi.spyOn(useCoursesStore.getState(), 'selectCourse').mockImplementation(id => { useCoursesStore.setState({ selectedCourseId: id }) })
  dispose = installWorkspaceCourseMoveNavigation()
  tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'drag' })
})
afterEach(() => { dispose(); tabDragSession.end(); useCoursesStore.setState({ selectCourse: originalSelectCourse }); vi.restoreAllMocks() })

test('a canceled hover visit returns to the initial course after several folder hops', () => {
  navigateWorkspaceCourseHover('drag', 'target'); navigateWorkspaceCourseHover('drag', 'third')
  tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBe('source')
})

test('a successful move keeps the destination even when dragend arrives before its result', () => {
  navigateWorkspaceCourseHover('drag', 'target')
  expect(beginWorkspaceCourseMoveDrop('drag')).toBe(true)
  tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBe('target')
  finishWorkspaceCourseMoveDrop('drag', true)
  expect(useCoursesStore.getState().selectedCourseId).toBe('target')
})

test('a refused collision returns to the source after its pending move resolves', () => {
  navigateWorkspaceCourseHover('drag', 'target'); beginWorkspaceCourseMoveDrop('drag')
  tabDragSession.end(); finishWorkspaceCourseMoveDrop('drag', false)
  expect(useCoursesStore.getState().selectedCourseId).toBe('source')
})

test('only one drop can consume the same drag gesture', () => {
  expect(beginWorkspaceCourseMoveDrop('drag')).toBe(true)
  expect(beginWorkspaceCourseMoveDrop('drag')).toBe(false)
  finishWorkspaceCourseMoveDrop('drag', true)
  expect(beginWorkspaceCourseMoveDrop('drag')).toBe(false)
})

test('a pending destination retains its source beyond native dragend and releases after completion', () => {
  const listener = vi.fn(), unsubscribe = workspaceCourseMoveRetention.subscribe(listener)
  navigateWorkspaceCourseHover('drag', 'target')
  beginWorkspaceCourseMoveDrop('drag')
  const pending = workspaceCourseMoveRetention.getSnapshot()
  expect(pending).toEqual([{ courseId: 'source', panelId: 'panel', nonce: 'drag' }])
  tabDragSession.end()
  expect(workspaceCourseMoveRetention.getSnapshot()).toBe(pending)
  finishWorkspaceCourseMoveDrop('drag', true)
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([])
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
})

test('stale source nonces cannot start a pending transfer', () => {
  expect(beginWorkspaceCourseMoveDrop('stale')).toBe(false)
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([])
})

test('external course selection wins over a canceled hover visit and further hover timers', () => {
  navigateWorkspaceCourseHover('drag', 'target')
  useCoursesStore.setState({ selectedCourseId: 'third' })
  expect(navigateWorkspaceCourseHover('drag', 'target')).toBe(false)
  tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBe('third')
})

test('external selection after dragend remains authoritative even if the user returns to the pending destination', () => {
  navigateWorkspaceCourseHover('drag', 'target'); beginWorkspaceCourseMoveDrop('drag'); tabDragSession.end()
  useCoursesStore.setState({ selectedCourseId: 'third' })
  useCoursesStore.setState({ selectedCourseId: 'target' })
  finishWorkspaceCourseMoveDrop('drag', false)
  expect(useCoursesStore.getState().selectedCourseId).toBe('target')
})

test('a deleted origin is not restored by cancel', () => {
  navigateWorkspaceCourseHover('drag', 'target')
  useCoursesStore.setState({ courses: [{ id: 'target' } as never] })
  tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBe('target')
})

test('a canceled temporary workspace visit restores the null origin', () => {
  tabDragSession.end(); useCoursesStore.setState({ selectedCourseId: null })
  tabDragSession.beginTab({ courseId: null, panelId: 'scratch', nonce: 'temporary' })
  navigateWorkspaceCourseHover('temporary', 'target'); tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBeNull()
})

test('an old refused move cannot undo a newer gesture or an external choice made after dragend', () => {
  navigateWorkspaceCourseHover('drag', 'target'); beginWorkspaceCourseMoveDrop('drag'); tabDragSession.end()
  tabDragSession.beginTab({ courseId: 'target', panelId: 'other', nonce: 'new-drag' })
  navigateWorkspaceCourseHover('new-drag', 'third'); finishWorkspaceCourseMoveDrop('drag', false)
  expect(useCoursesStore.getState().selectedCourseId).toBe('third')
  tabDragSession.end()
  expect(useCoursesStore.getState().selectedCourseId).toBe('target')
})
