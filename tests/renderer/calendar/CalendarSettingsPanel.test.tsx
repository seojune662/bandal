// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useLocale: () => 'ko-KR' }))
import { CalendarSettingsPanel } from '../../../src/renderer/src/features/calendar/CalendarSettingsPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const connected = { supported: true, connected: true, authorization: 'authorized', selectedCalendarIds: ['one'], destinationCalendarId: 'one', calendars: [{ id: 'one', title: 'Calendar', source: 'Local', color: '#000', writable: true }] }
let root: Root, host: HTMLDivElement
beforeEach(() => { invokeMock.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
test('an older focus refresh cannot restore a selection after configure completes', async () => {
  let resolveOld!: (state: unknown) => void
  invokeMock.mockResolvedValue(connected)
  await act(async () => root.render(<CalendarSettingsPanel />))
  invokeMock.mockImplementation(channel => channel === 'appleCalendar:state'
    ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ ...connected, selectedCalendarIds: [] }))
  await act(async () => window.dispatchEvent(new Event('focus')))
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await act(async () => resolveOld(connected))
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
})
test('focus during a pending mutation cannot race its response', async () => {
  let complete!: (state: unknown) => void
  invokeMock.mockResolvedValue(connected)
  await act(async () => root.render(<CalendarSettingsPanel />))
  invokeMock.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  const calls = invokeMock.mock.calls.length
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(invokeMock.mock.calls).toHaveLength(calls)
  await act(async () => complete({ ...connected, selectedCalendarIds: [] }))
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(false)
})
