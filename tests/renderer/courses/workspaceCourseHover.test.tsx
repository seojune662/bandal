// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceCourseHover } from '../../../src/renderer/src/features/courses/useWorkspaceCourseHover'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'
import { dropWorkspaceTabOnCourse } from '../../../src/renderer/src/features/workspace/workspaceTabDrop'

vi.mock('../../../src/renderer/src/features/workspace/workspaceTabDrop', () => ({ dropWorkspaceTabOnCourse: vi.fn(async () => true) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const originalSelectCourse = useCoursesStore.getState().selectCourse
let select: ReturnType<typeof vi.spyOn>
function drag(element: HTMLElement, type: string, extra: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], dropEffect: 'none', getData: () => JSON.stringify({ source: tabDragSession.getSource() }) }, ...extra })
  act(() => { element.dispatchEvent(event) })
  return event
}
function Row({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const hover = useWorkspaceCourseHover()
  return <div {...hover.rowProps(id, enabled)}><span>Folder</span><button>Menu</button></div>
}
function mount(id = 'destination') {
  const container = document.createElement('section'), root = createRoot(container)
  document.body.append(container); roots.push(root)
  act(() => root.render(<Row id={id} />))
  return { root, row: container.firstElementChild as HTMLElement }
}
function begin(nonce = 'trusted', courseId: string | null = 'source') {
  act(() => tabDragSession.beginTab({ courseId, panelId: 'panel', nonce }))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(dropWorkspaceTabOnCourse).mockClear()
  useCoursesStore.setState({ selectCourse: originalSelectCourse, selectedCourseId: 'source', courses: ['source', 'destination', 'other'].map(id => ({ id } as never)) })
  select = vi.spyOn(useCoursesStore.getState(), 'selectCourse').mockImplementation(id => useCoursesStore.setState({ selectedCourseId: id }))
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  tabDragSession.end(); useCoursesStore.setState({ selectCourse: originalSelectCourse }); vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren()
})

test('entering a folder switches immediately without waiting for a dragover or dwell timer', () => {
  const { row } = mount()
  expect(drag(row, 'dragenter').defaultPrevented).toBe(false)
  begin()
  expect(drag(row.firstElementChild as HTMLElement, 'dragenter').defaultPrevented).toBe(true)
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
  expect(tabDragSession.getSource()?.courseId).toBe('source')
  expect(dropWorkspaceTabOnCourse).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

test('rapid folder crossings follow every entry and a late dragleave cannot switch back', () => {
  const first = mount(), second = mount('other'), origin = mount('source')
  begin(); drag(first.row, 'dragenter'); drag(second.row, 'dragenter')
  drag(first.row, 'dragleave')
  expect(useCoursesStore.getState().selectedCourseId).toBe('other')
  drag(origin.row, 'dragenter'); drag(first.row, 'dragenter')
  expect(select.mock.calls.map(([id]) => id)).toEqual(['destination', 'other', 'source', 'destination'])
  act(() => vi.runAllTimers())
  expect(useCoursesStore.getState().selectedCourseId).toBe('destination')
})

test('moving across nested folder children and repeated dragover does not repeat selection', () => {
  const { row } = mount()
  begin(); drag(row, 'dragenter')
  drag(row.firstElementChild as HTMLElement, 'dragenter')
  drag(row.lastElementChild as HTMLElement, 'dragenter')
  drag(row, 'dragover')
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
})

test('dragover also selects when Chromium omits the entry event after a render', () => {
  const { row } = mount()
  begin(); expect(drag(row, 'dragover').defaultPrevented).toBe(true)
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
})

test('same selected course accepts the held tab without scheduling another selection', () => {
  const { row } = mount('source')
  begin(); expect(drag(row, 'dragenter').defaultPrevented).toBe(true)
  expect(select).not.toHaveBeenCalled()
})

test('ending a gesture leaves no pending selection for a later gesture', () => {
  const { row } = mount()
  begin(); drag(row, 'dragenter')
  act(() => tabDragSession.end())
  useCoursesStore.setState({ selectedCourseId: 'source' })
  begin('replacement')
  act(() => vi.runAllTimers())
  expect(useCoursesStore.getState().selectedCourseId).toBe('source')
  drag(row, 'dragenter')
  expect(select).toHaveBeenCalledTimes(2)
})

test('a direct folder drop moves once without requiring an earlier entry', () => {
  const { row } = mount()
  begin()
  expect(drag(row, 'drop').defaultPrevented).toBe(true)
  expect(dropWorkspaceTabOnCourse).toHaveBeenCalledExactlyOnceWith({ courseId: 'source', panelId: 'panel', nonce: 'trusted' }, 'destination')
})

test('a forged drop payload and a disabled row cannot move the held tab', () => {
  const { root, row } = mount()
  begin()
  expect(drag(row, 'drop', { dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], getData: () => JSON.stringify({ source: { nonce: 'forged' } }) } }).defaultPrevented).toBe(false)
  act(() => root.render(<Row id="destination" enabled={false} />))
  expect(drag(row, 'dragenter').defaultPrevented).toBe(false)
  expect(drag(row, 'drop').defaultPrevented).toBe(false)
  expect(select).not.toHaveBeenCalled()
  expect(dropWorkspaceTabOnCourse).not.toHaveBeenCalled()
})

test('deleted destinations and unrelated payloads cannot select a course', () => {
  const { row } = mount()
  begin()
  expect(drag(row, 'dragenter', { dataTransfer: { types: ['Files'] } }).defaultPrevented).toBe(false)
  useCoursesStore.setState({ courses: [{ id: 'source' } as never] })
  expect(drag(row, 'dragenter').defaultPrevented).toBe(false)
  expect(select).not.toHaveBeenCalled()
})

test('temporary no-course tabs can enter their first real course immediately', () => {
  const { row } = mount()
  begin('temporary', null); drag(row, 'dragenter')
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
})
