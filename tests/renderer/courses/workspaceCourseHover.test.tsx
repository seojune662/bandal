// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useWorkspaceCourseHover, WORKSPACE_COURSE_HOVER_MS } from '../../../src/renderer/src/features/courses/useWorkspaceCourseHover'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const originalSelectCourse = useCoursesStore.getState().selectCourse
let select: ReturnType<typeof vi.spyOn>
function drag(element: HTMLElement, type: string, extra: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], dropEffect: 'none' }, ...extra })
  act(() => { element.dispatchEvent(event) })
  return event
}
function Row({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const hover = useWorkspaceCourseHover()
  return <div {...hover.rowProps(id, enabled)}><span>Folder</span></div>
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
async function advance(milliseconds: number) { await act(async () => vi.advanceTimersByTimeAsync(milliseconds)) }
beforeEach(() => {
  vi.useFakeTimers()
  useCoursesStore.setState({ selectCourse: originalSelectCourse, selectedCourseId: 'source', courses: ['source', 'destination', 'other'].map(id => ({ id } as never)) })
  select = vi.spyOn(useCoursesStore.getState(), 'selectCourse').mockImplementation(() => {})
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  tabDragSession.end(); useCoursesStore.setState({ selectCourse: originalSelectCourse }); vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren()
})

test('a held trusted tab switches after 300 ms and leaving cancels the hover', async () => {
  expect(WORKSPACE_COURSE_HOVER_MS).toBe(300)
  const { row } = mount()
  expect(drag(row, 'dragover').defaultPrevented).toBe(false)
  begin()
  expect(drag(row, 'dragover').defaultPrevented).toBe(true)
  expect(row.getAttribute('data-tab-hover')).toBe('true')
  await advance(299); expect(select).not.toHaveBeenCalled()
  drag(row, 'dragleave'); await advance(1)
  expect(select).not.toHaveBeenCalled()
  drag(row, 'dragover'); await advance(300)
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
  expect(row.hasAttribute('data-tab-hover')).toBe(false)
})

test('rapid folder crossings cancel the previous timer even when its dragleave is missing', async () => {
  const first = mount(), second = mount('other')
  begin(); drag(first.row, 'dragover'); await advance(200)
  drag(second.row, 'dragover')
  expect(first.row.hasAttribute('data-tab-hover')).toBe(false)
  await advance(100); expect(select).not.toHaveBeenCalled()
  await advance(200); expect(select).toHaveBeenCalledExactlyOnceWith('other')
})

test('leaving a folder for the canvas cancels a stale timer without dragleave', async () => {
  const { row } = mount(), canvas = document.createElement('div'); document.body.append(canvas)
  begin(); drag(row, 'dragover'); await advance(200)
  drag(canvas, 'dragover'); await advance(300)
  expect(select).not.toHaveBeenCalled()
  expect(row.hasAttribute('data-tab-hover')).toBe(false)
})

test('same selected course never shows a transfer highlight or schedules selection', async () => {
  const { row } = mount('source')
  begin(); expect(drag(row, 'dragover').defaultPrevented).toBe(true)
  await advance(300)
  expect(select).not.toHaveBeenCalled()
  expect(row.hasAttribute('data-tab-hover')).toBe(false)
})

test('a held tab can return to its source course after visiting another destination', async () => {
  const { row } = mount('source')
  useCoursesStore.setState({ selectedCourseId: 'other' })
  begin(); drag(row, 'dragover'); await advance(300)
  expect(select).toHaveBeenCalledExactlyOnceWith('source')
})

test('a new drag nonce cancels the old hover instead of switching during the next gesture', async () => {
  const { row } = mount()
  begin(); drag(row, 'dragover'); await advance(200)
  begin('replacement'); await advance(100)
  expect(select).not.toHaveBeenCalled()
  drag(row, 'dragover'); await advance(300)
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
})

test('cancel and a folder drop clear the highlight without moving or selecting', async () => {
  const { row } = mount()
  begin(); drag(row, 'dragover')
  act(() => tabDragSession.end()); await advance(300)
  expect(select).not.toHaveBeenCalled()
  begin('next'); drag(row, 'dragover')
  expect(drag(row, 'drop').defaultPrevented).toBe(true)
  await advance(300)
  expect(select).not.toHaveBeenCalled()
  expect(row.hasAttribute('data-tab-hover')).toBe(false)
})

test('a pending or deleted destination cannot switch when its old timer expires', async () => {
  const { root, row } = mount()
  begin(); drag(row, 'dragover')
  act(() => root.render(<Row id="destination" enabled={false} />)); await advance(300)
  expect(select).not.toHaveBeenCalled()
  act(() => root.render(<Row id="destination" />)); drag(row, 'dragover')
  useCoursesStore.setState({ courses: [{ id: 'source' } as never] }); await advance(300)
  expect(select).not.toHaveBeenCalled()
})

test('temporary no-course tabs can hover into their first real course', async () => {
  const { row } = mount()
  begin('temporary', null); drag(row, 'dragover'); await advance(300)
  expect(select).toHaveBeenCalledExactlyOnceWith('destination')
})
