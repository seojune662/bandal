import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Session, WebContents } from 'electron'

const bridge = vi.hoisted(() => ({
  handle: vi.fn(),
  cleanProbe: false,
  on: vi.fn(),
  nativeTheme: { shouldUseDarkColors: false },
  settings: { theme: 'system' as 'system' | 'light' | 'dark', browser: { swipeNavigation: true } }
}))
vi.mock('electron', () => ({ ipcMain: { handle: bridge.handle, on: bridge.on }, nativeTheme: bridge.nativeTheme }))
vi.mock('../../../src/main/settingsStore', () => ({ getSettings: () => bridge.settings }))
vi.mock('../../../src/main/features/browser/managedPages', () => ({ isManagedBrowserPage: (id: number) => id === 41 }))
vi.mock('../../../src/main/features/browser/authProbe', () => ({ isCleanBrowserAuthProbe: () => bridge.cleanProbe }))
import { installGestureSession, installSwipeNavigation, navigateBySwipe } from '../../../src/main/features/browser/swipeNavigation'

const session = { registerPreloadScript: vi.fn() }
installGestureSession(session as unknown as Session)
const readState = bridge.handle.mock.calls.find(([channel]) => channel === 'browser-gesture:state')![1]
const frame = { isDestroyed: () => false, detached: false }
const navigate = bridge.on.mock.calls.find(([channel]) => channel === 'browser-gesture:navigate')![1]
const history = { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
const page = { id: 41, navigationHistory: history, isDestroyed: vi.fn(() => false), once: vi.fn() } as unknown as WebContents

beforeEach(() => {
  bridge.settings.theme = 'system'
  bridge.cleanProbe = false
  bridge.settings.browser.swipeNavigation = true
  bridge.nativeTheme.shouldUseDarkColors = false
  history.goBack.mockClear()
  history.goForward.mockClear()
  vi.mocked(page.isDestroyed).mockReturnValue(false)
  vi.mocked(page.once).mockClear()
  installSwipeNavigation(page, () => true)
})

afterEach(() => {
  vi.mocked(page.once).mock.calls.find(([event]) => event === 'destroyed')?.[1]()
  vi.useRealTimers()
})

test('gesture appearance resolves the app preference against OS dark mode', () => {
  expect(readState({ sender: page, senderFrame: frame })).toMatchObject({ canBack: true, canForward: false, enabled: true, theme: 'light' })
  bridge.nativeTheme.shouldUseDarkColors = true
  expect(readState({ sender: page, senderFrame: frame }).theme).toBe('dark')
  bridge.settings.theme = 'light'
  expect(readState({ sender: page, senderFrame: frame }).theme).toBe('light')
  bridge.settings.theme = 'dark'
  bridge.nativeTheme.shouldUseDarkColors = false
  expect(readState({ sender: page, senderFrame: frame }).theme).toBe('dark')
})

test('the clean comparison never registers the gesture preload in a new session', () => {
  const isolated = { registerPreloadScript: vi.fn() }
  bridge.cleanProbe = true
  installGestureSession(isolated as unknown as Session)
  expect(isolated.registerPreloadScript).not.toHaveBeenCalled()
})

test('unmanaged pages cannot use the gesture bridge', () => {
  const unmanaged = { ...page, id: 99 } as unknown as WebContents
  expect(readState({ sender: unmanaged, senderFrame: frame })).toEqual({ canBack: false, canForward: false, enabled: false })
  navigateBySwipe(unmanaged, 'back')
  expect(history.goBack).not.toHaveBeenCalled()
})

test('disabled and unavailable navigation cannot execute', () => {
  bridge.settings.browser.swipeNavigation = false
  expect(readState({ sender: page, senderFrame: frame }).enabled).toBe(false)
  navigateBySwipe(page, 'back')
  bridge.settings.browser.swipeNavigation = true
  navigateBySwipe(page, 'forward')
  expect(history.goBack).not.toHaveBeenCalled()
  expect(history.goForward).not.toHaveBeenCalled()
})

test('a gesture completing after its native tab was hidden cannot navigate', () => {
  let visible = true
  installSwipeNavigation(page, () => visible)
  expect(readState({ sender: page, senderFrame: frame }).enabled).toBe(true)
  visible = false
  expect(readState({ sender: page, senderFrame: frame }).enabled).toBe(false)
  navigateBySwipe(page, 'back')
  expect(history.goBack).not.toHaveBeenCalled()
})

test('destroyed pages never read navigation history or navigate', () => {
  vi.mocked(page.isDestroyed).mockReturnValue(true)
  expect(readState({ sender: page, senderFrame: frame })).toMatchObject({ canBack: false, canForward: false, enabled: false })
  navigateBySwipe(page, 'back')
  expect(history.goBack).not.toHaveBeenCalled()
})

test('separate completed swipes are not dropped by a fixed cooldown', () => {
  vi.useFakeTimers()
  vi.setSystemTime(10000)
  navigateBySwipe(page, 'back')
  vi.advanceTimersByTime(400)
  navigateBySwipe(page, 'back')
  expect(history.goBack).toHaveBeenCalledTimes(2)
})

test.each([null, { isDestroyed: () => true, detached: false }, { isDestroyed: () => false, detached: true }])(
  'a late request from a navigated or detached frame cannot navigate a newer page', senderFrame => {
    const event = { sender: page, senderFrame }
    expect(readState(event)).toMatchObject({ canBack: false, canForward: false, enabled: false })
    navigate(event, 'back')
    expect(history.goBack).not.toHaveBeenCalled()
  }
)

test('live child frames keep their history bridge', () => {
  const childFrame = { isDestroyed: () => false, detached: false }
  navigate({ sender: page, senderFrame: childFrame }, 'back')
  expect(history.goBack).toHaveBeenCalledOnce()
})
