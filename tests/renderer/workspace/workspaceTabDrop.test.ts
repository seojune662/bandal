import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { installWorkspaceCourseMoveNavigation, workspaceCourseMoveRetention } from '../../../src/renderer/src/features/workspace/courseTabMoveNavigation'
import { dropWorkspaceTabOnCourse } from '../../../src/renderer/src/features/workspace/workspaceTabDrop'

const fixture = vi.hoisted(() => {
  const courseListeners = new Set<(state: any, previous: any) => void>()
  const workspaceListeners = new Set<() => void>()
  const state = { selectedCourseId: 'source', courses: [{ id: 'source' }, { id: 'target' }, { id: 'other' }], selectCourse: (_id: string | null) => {} }
  const workspace = { activeCourseId: 'source', hydration: 'ready', surface: 'course' }
  return { state, workspace, courseListeners, workspaceListeners, move: vi.fn(), toast: vi.fn(), api: { activeGroup: { id: 'target-group', panels: [{ id: 'one' }, { id: 'two' }] } } }
})
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: {
  getState: () => fixture.state,
  subscribe: (listener: (state: any, previous: any) => void) => { fixture.courseListeners.add(listener); return () => fixture.courseListeners.delete(listener) }
} }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => fixture.workspace, subscribe: (listener: () => void) => { fixture.workspaceListeners.add(listener); return () => fixture.workspaceListeners.delete(listener) } },
  workspaceApiForCourse: () => fixture.api,
  moveWorkspacePanel: fixture.move
}))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: fixture.toast }))

const source = { courseId: 'source', panelId: 'held-tab', nonce: 'gesture' }
let dispose: () => void
function select(courseId: string | null) {
  const previous = { ...fixture.state }
  fixture.state.selectedCourseId = courseId as string
  for (const listener of fixture.courseListeners) listener(fixture.state, previous)
}
function hydrate(hydration: string) {
  Object.assign(fixture.workspace, { activeCourseId: 'target', hydration })
  for (const listener of fixture.workspaceListeners) listener()
}
beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(fixture.state, { selectedCourseId: 'source', courses: [{ id: 'source' }, { id: 'target' }, { id: 'other' }], selectCourse: select })
  Object.assign(fixture.workspace, { activeCourseId: 'source', hydration: 'ready', surface: 'course' })
  fixture.move.mockReset().mockResolvedValue(true); fixture.toast.mockClear()
  dispose = installWorkspaceCourseMoveNavigation()
  tabDragSession.beginTab(source)
})
afterEach(() => { dispose(); tabDragSession.end(); vi.useRealTimers() })

test('direct drop waits for a cold course and keeps its source mounted after native dragend', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  expect(fixture.state.selectedCourseId).toBe('target')
  expect(fixture.move).not.toHaveBeenCalled()
  tabDragSession.end()
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([source])
  hydrate('loading'); expect(fixture.move).not.toHaveBeenCalled()
  hydrate('ready')
  expect(await operation).toBe(true)
  expect(fixture.move).toHaveBeenCalledExactlyOnceWith({ sourceCourseId: 'source', panelId: 'held-tab', targetCourseId: 'target', position: { groupId: 'target-group', direction: 'within', index: 2 } })
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([])
  expect(fixture.state.selectedCourseId).toBe('target')
})

test('one native gesture cannot start a second pending course transfer', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  expect(await dropWorkspaceTabOnCourse(source, 'target')).toBe(false)
  hydrate('ready'); await operation
  expect(fixture.move).toHaveBeenCalledTimes(1)
})

test('a rejected collision preserves the source and restores its course after dragend', async () => {
  fixture.move.mockResolvedValue(false)
  const position = { groupId: 'right-pane', direction: 'within' as const, index: 1 }
  const operation = dropWorkspaceTabOnCourse(source, 'target', position)
  tabDragSession.end(); hydrate('ready')
  expect(await operation).toBe(false)
  expect(fixture.move.mock.calls[0]![0].position).toBe(position)
  expect(fixture.state.selectedCourseId).toBe('source')
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([])
})

test('hydration failure cancels before moving and restores the source course', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end(); hydrate('error')
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('source')
  expect(fixture.toast).toHaveBeenCalledTimes(1)
})

test('external navigation while hydration is pending wins over cancellation rollback', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end(); select('other')
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('other')
  expect(fixture.toast).not.toHaveBeenCalled()
})

test('navigation in the hydration notification turn cancels before committing the move', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end(); hydrate('ready'); select('other')
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('other')
})

test('returning to the destination after external navigation does not revive the pending drop', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end(); hydrate('ready'); select('other'); select('target')
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('target')
})

test('a deleted target cannot receive a pending move', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end()
  fixture.state.courses = [{ id: 'source' }]
  for (const listener of fixture.courseListeners) listener(fixture.state, fixture.state)
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('source')
})

test('an unresponsive hydration releases the retained source without moving it', async () => {
  const operation = dropWorkspaceTabOnCourse(source, 'target')
  tabDragSession.end()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(await operation).toBe(false)
  expect(fixture.move).not.toHaveBeenCalled()
  expect(fixture.state.selectedCourseId).toBe('source')
  expect(workspaceCourseMoveRetention.getSnapshot()).toEqual([])
})
