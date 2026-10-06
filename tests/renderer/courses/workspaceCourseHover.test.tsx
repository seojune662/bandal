// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { useWorkspaceCourseHover } from '../../../src/renderer/src/features/courses/useWorkspaceCourseHover'
import { tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { BANDAL_TAB_DRAG_MIME } from '../../../src/renderer/src/features/workspace/tabDrag'

function drag(element: HTMLElement, type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { dataTransfer: { types: [BANDAL_TAB_DRAG_MIME], dropEffect: 'none' } })
  act(() => { element.dispatchEvent(event) })
  return event
}
afterEach(() => { tabDragSession.end(); vi.useRealTimers(); document.body.replaceChildren() })

test('a held trusted tab switches only after 450 ms and leaving cancels the hover', async () => {
  vi.useFakeTimers()
  const select = vi.spyOn(useCoursesStore.getState(), 'selectCourse').mockImplementation(() => {})
  function Row() { const hover = useWorkspaceCourseHover(); return <div {...hover.rowProps('destination', true)} /> }
  const container = document.createElement('section'), root = createRoot(container); document.body.append(container)
  act(() => { root.render(<Row />) })
  const row = container.firstElementChild as HTMLElement
  expect(drag(row, 'dragover').defaultPrevented).toBe(false)
  tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'trusted' })
  expect(drag(row, 'dragover').defaultPrevented).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(449) })
  expect(select).not.toHaveBeenCalled()
  drag(row, 'dragleave')
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(select).not.toHaveBeenCalled()
  drag(row, 'dragover')
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(select).toHaveBeenCalledOnce(); expect(select).toHaveBeenCalledWith('destination')
  act(() => { root.unmount() }); select.mockRestore()
})
