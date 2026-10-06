// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
import { CalendarView } from '../../../src/renderer/src/features/calendar/CalendarView'
import type { Course } from '../../../src/shared/types/course'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const courses = [{ id: 'c1', name: 'One', color: 'blue' }, { id: 'c2', name: 'Two', color: 'green' }] as Course[]
let finishSave: (value: unknown) => void
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  invokeMock.mockReset().mockImplementation(async channel => {
    if (channel === 'appleCalendar:state') return { supported: false, connected: false, calendars: [] }
    if (channel === 'board:createTask') return new Promise(resolve => { finishSave = resolve })
    return []
  })
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(courseId = 'c1') { await act(async () => root.render(<CalendarView courses={courses} courseId={courseId} />)) }
async function beginSave() {
  const day = host.querySelector<HTMLElement>('.calendar-day:not([data-outside])')!
  await act(async () => day.querySelector<HTMLButtonElement>('.calendar-day__number')!.click())
  const title = host.querySelector<HTMLInputElement>('input[placeholder="과제나 시험 이름"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Saved title'); title.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  return { id: 'saved', title: 'Saved title', courseId: 'c1', dueAt: day.dataset.dateKey!, startAt: null, allDay: true, status: 'todo', kind: 'task', color: 'none', sortOrder: 0 }
}
test('save completion preserves a date the user selected while waiting', async () => {
  await render(); const saved = await beginSave()
  const next = host.querySelectorAll<HTMLElement>('.calendar-day:not([data-outside])')[2]!
  await act(async () => next.querySelector<HTMLButtonElement>('.calendar-day__number')!.click())
  await act(async () => finishSave(saved))
  expect(host.querySelector('[data-selected]')?.getAttribute('data-date-key')).toBe(next.dataset.dateKey)
  expect(host.querySelector<HTMLInputElement>('input[placeholder="과제나 시험 이름"]')?.value).toBe('')
})
test('save completion cannot navigate back after moving to another month', async () => {
  await render(); const saved = await beginSave()
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="다음 달"]')!.click())
  const month = host.querySelector('.calendar-month__nav h3')!.textContent
  await act(async () => finishSave(saved))
  expect(host.querySelector('.calendar-month__nav h3')!.textContent).toBe(month)
  expect(host.querySelector('[data-task-id="saved"]')).toBeNull()
})
test('save completion cannot insert the prior course task into a new course view', async () => {
  await render(); const saved = await beginSave()
  await render('c2')
  await act(async () => finishSave(saved))
  expect(host.querySelector('[data-task-id="saved"]')).toBeNull()
  expect(host.querySelector('.calendar-form')).toBeNull()
})

test('an older range load cannot erase a task whose save has completed', async () => {
  await render()
  let finishLoad!: (value: unknown) => void
  const current = invokeMock.getMockImplementation()!
  invokeMock.mockImplementation((channel, ...args) => channel === 'calendar:range' ? new Promise(resolve => { finishLoad = resolve }) : current(channel, ...args))
  const refresh = Array.from(host.querySelectorAll('button')).find(node => node.textContent?.includes('일정 새로고침'))!
  await act(async () => refresh.click())
  const saved = await beginSave()
  await act(async () => finishSave(saved))
  await act(async () => finishLoad([]))
  expect(host.querySelector('[data-task-id="saved"]')).not.toBeNull()
})
