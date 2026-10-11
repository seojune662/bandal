// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), visible: false, focus: vi.fn(), nativeFocus: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({
  settingsSnapshot: () => ({ locale: 'ko-KR', browser: { defaultZoomLevel: 0, homePage: '' } }),
  ensureSettingsLoaded: async () => ({ locale: 'ko-KR' })
}))
vi.mock('../../../src/renderer/src/features/workspace/usePanelVisible', () => ({ usePanelVisible: () => mocks.visible }))
vi.mock('../../../src/renderer/src/features/workspace/panels/browserAnchor', () => ({ useBrowserAnchorRect: () => {} }))
vi.mock('../../../src/renderer/src/features/browser/BrowserProfilePicker', () => ({ BrowserProfilePicker: () => null }))
vi.mock('../../../src/renderer/src/features/browser/BrowserAddressInput', () => ({ BrowserAddressInput: () => null }))
vi.mock('../../../src/renderer/src/features/browser/videoBridge', () => ({ useWebVideoReport: () => null, openWebVideoInPip: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/guestActions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/renderer/src/features/browser/guestActions')>()
  return { ...actual, guestActions: { ...actual.guestActions, focus: mocks.focus } }
})

import { BrowserPanel } from '../../../src/renderer/src/features/browser/BrowserPanel'
import { installWorkspaceDragSession, tabDragSession } from '../../../src/renderer/src/features/workspace/tabDragSession'
import { installWorkspaceNativePassthrough } from '../../../src/renderer/src/features/browser/workspaceNativePassthrough'
import { isPointerPassthroughActive } from '../../../src/renderer/src/features/browser/webviewPassthrough'
import { setNativeHostBlocked } from '../../../src/renderer/src/features/browser/nativeHostVisibility'
import { resetBrowserGuestsForTests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { resetFavoritesStoreForTests, useFavoritesStore, favoriteScopeKey } from '../../../src/renderer/src/stores/favoritesStore'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement, root: Root, props: IDockviewPanelProps, disposeSession: () => void, disposePassthrough: () => void
const render = () => act(() => root.render(<BrowserPanel {...props} />))
const frame = () => act(() => vi.advanceTimersByTime(20))
function pointer(type: string): void {
  act(() => host.querySelector('.dv-tab')!.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  mocks.invoke.mockReset().mockResolvedValue({ allowed: true, favorites: [] })
  mocks.nativeFocus.mockReset()
  mocks.focus.mockReset().mockImplementation((tabId: string, shouldFocus?: () => boolean) => {
    if (!shouldFocus || shouldFocus()) mocks.nativeFocus(tabId)
  })
  mocks.visible = false
  resetBrowserGuestsForTests(); resetFavoritesStoreForTests()
  useFavoritesStore.setState({ byCourse: { [favoriteScopeKey(null)]: [] } })
  props = {
    params: { descriptor: { kind: 'browser', payload: { tabId: 'tab', initialUrl: 'https://example.test', profileId: 'default' } } },
    api: { title: '', setTitle: vi.fn(), updateParameters: vi.fn(), isActive: true, isVisible: true }
  } as unknown as IDockviewPanelProps
  host = document.createElement('div')
  host.innerHTML = '<div class="dv-tabs-and-actions-container"><div class="dv-tab">Browser</div></div><main></main>'
  document.body.append(host)
  root = createRoot(host.querySelector('main')!)
  disposeSession = installWorkspaceDragSession(host)
  disposePassthrough = installWorkspaceNativePassthrough()
  render()
})
afterEach(() => {
  act(() => root.unmount()); disposeSession(); disposePassthrough(); tabDragSession.end()
  setNativeHostBlocked('test-modal', false)
  host.remove(); vi.useRealTimers(); vi.restoreAllMocks()
})

test('activating a browser while its tab is held does not take native focus before dragstart', () => {
  pointer('pointerdown')
  mocks.visible = true; render(); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
  expect(tabDragSession.getSnapshot()).toBeNull()
  expect(isPointerPassthroughActive()).toBe(false)
  expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'browser:setHostOccluded')).toBe(false)
  pointer('pointerup'); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledExactlyOnceWith('tab')
  window.dispatchEvent(new MouseEvent('mouseup')); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(1)
})

test('native drag pointer cancellation keeps focus blocked while a hovered browser course becomes visible', () => {
  pointer('pointerdown')
  act(() => tabDragSession.beginTab({ courseId: 'source', panelId: 'panel', nonce: 'drag' }))
  pointer('pointercancel')
  mocks.visible = true; render(); frame()
  expect(tabDragSession.getSnapshot()).toBe('tab')
  expect(isPointerPassthroughActive()).toBe(true)
  expect(mocks.focus).not.toHaveBeenCalled()
  act(() => tabDragSession.end()); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledExactlyOnceWith('tab')
  expect(isPointerPassthroughActive()).toBe(false)
})

test.each(['group', 'resize'] as const)('%s gestures defer automatic focus until the gesture ends', kind => {
  act(() => tabDragSession.begin(kind))
  mocks.visible = true; render(); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
  act(() => tabDragSession.end()); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledExactlyOnceWith('tab')
})

test('a host overlay delays focus until every blocker is released', () => {
  setNativeHostBlocked('test-modal', true)
  mocks.visible = true; render(); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
  pointer('pointerdown')
  setNativeHostBlocked('test-modal', false); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
  pointer('pointerup'); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledExactlyOnceWith('tab')
})

test.each(['hide', 'unmount'] as const)('a deferred request cannot focus a panel after %s', change => {
  pointer('pointerdown')
  mocks.visible = true; render(); frame()
  if (change === 'hide') { mocks.visible = false; render() }
  else act(() => root.render(null))
  pointer('pointerup'); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
})

test('window blur abandons pending activation instead of stealing focus back on release', () => {
  pointer('pointerdown')
  mocks.visible = true; render()
  act(() => window.dispatchEvent(new Event('blur')))
  pointer('pointerup'); frame()
  expect(mocks.focus).not.toHaveBeenCalled()
})

test('activation without a pointer gesture focuses once while inactive split panes never take focus', () => {
  mocks.visible = true; render(); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledExactlyOnceWith('tab')
  mocks.visible = false; render()
  Object.assign(props.api, { isActive: false })
  mocks.visible = true; render(); frame()
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(1)
})

test('a focus queued on native creation rechecks the press and resumes once after release', () => {
  const waiting: Array<() => boolean> = []
  mocks.focus.mockImplementation((_id: string, shouldFocus: () => boolean) => { waiting.push(shouldFocus) })
  mocks.visible = true; render(); frame()
  expect(waiting).toHaveLength(1)
  pointer('pointerdown')
  expect(waiting[0]!()).toBe(false)
  pointer('pointerup'); frame()
  expect(waiting).toHaveLength(2)
  expect(waiting[1]!()).toBe(true)
  expect(waiting[0]!()).toBe(false)
})
