// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const actions = vi.hoisted(() => ({ find: vi.fn(), stopFind: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/guestActions', () => ({ guestActions: actions }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: () => () => {} }))
import { BrowserFindBar } from '../../../src/renderer/src/features/browser/BrowserFindBar'
import { useBrowserGuests, resetBrowserGuestsForTests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
function View() {
  const state = useBrowserGuests(store => store.find.tab)
  return state ? <BrowserFindBar tabId="tab" state={state} /> : null
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); resetBrowserGuestsForTests()
  useBrowserGuests.getState().openFind('tab')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<View />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
function input() { return host.querySelector('input')! }
function type(text: string) { act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
  input().dispatchEvent(new Event('input', { bubbles: true }))
}) }
function key(value: string, props = {}) { act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...props })) }) }
test('Enter starts the pending search once and the debounce cannot reset it later', () => {
  type('자료')
  key('Enter')
  expect(actions.find).toHaveBeenCalledExactlyOnceWith('tab', '자료')
  act(() => vi.advanceTimersByTime(120))
  expect(actions.find).toHaveBeenCalledTimes(1)
  key('Enter', { shiftKey: true })
  expect(actions.find).toHaveBeenLastCalledWith('tab', '자료', { findNext: true, forward: false })
})
test('IME confirmation Enter and Escape do not advance or close the find bar', () => {
  type('한글')
  key('Enter', { isComposing: true })
  expect(actions.find).not.toHaveBeenCalled()
  key('Escape', { isComposing: true })
  expect(host.querySelector('input')).not.toBeNull()
})
