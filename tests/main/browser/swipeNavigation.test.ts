import { beforeEach, expect, test, vi } from 'vitest'
import type { Session, WebContents } from 'electron'

const bridge = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  nativeTheme: { shouldUseDarkColors: false },
  settings: { theme: 'system' as 'system' | 'light' | 'dark', browser: { swipeNavigation: true } }
}))
vi.mock('electron', () => ({ ipcMain: { handle: bridge.handle, on: bridge.on }, nativeTheme: bridge.nativeTheme }))
vi.mock('../../../src/main/settingsStore', () => ({ getSettings: () => bridge.settings }))
vi.mock('../../../src/main/features/browser/managedPages', () => ({ isManagedBrowserPage: (id: number) => id === 41 }))
import { installGestureSession, navigateBySwipe } from '../../../src/main/features/browser/swipeNavigation'

const session = { registerPreloadScript: vi.fn() }
installGestureSession(session as unknown as Session)
const readState = bridge.handle.mock.calls.find(([channel]) => channel === 'browser-gesture:state')![1]
const history = { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
const page = { id: 41, navigationHistory: history } as unknown as WebContents

beforeEach(() => {
  bridge.settings.theme = 'system'
  bridge.settings.browser.swipeNavigation = true
  bridge.nativeTheme.shouldUseDarkColors = false
  history.goBack.mockClear()
  history.goForward.mockClear()
})

test('gesture appearance resolves the app preference against OS dark mode', () => {
  expect(readState({ sender: page })).toMatchObject({ canBack: true, canForward: false, enabled: true, theme: 'light' })
  bridge.nativeTheme.shouldUseDarkColors = true
  expect(readState({ sender: page }).theme).toBe('dark')
  bridge.settings.theme = 'light'
  expect(readState({ sender: page }).theme).toBe('light')
  bridge.settings.theme = 'dark'
  bridge.nativeTheme.shouldUseDarkColors = false
  expect(readState({ sender: page }).theme).toBe('dark')
})

test('unmanaged pages cannot use the gesture bridge', () => {
  const unmanaged = { ...page, id: 99 } as unknown as WebContents
  expect(readState({ sender: unmanaged })).toEqual({ canBack: false, canForward: false, enabled: false })
  navigateBySwipe(unmanaged, 'back')
  expect(history.goBack).not.toHaveBeenCalled()
})

test('disabled and unavailable navigation cannot execute', () => {
  bridge.settings.browser.swipeNavigation = false
  expect(readState({ sender: page }).enabled).toBe(false)
  navigateBySwipe(page, 'back')
  bridge.settings.browser.swipeNavigation = true
  navigateBySwipe(page, 'forward')
  expect(history.goBack).not.toHaveBeenCalled()
  expect(history.goForward).not.toHaveBeenCalled()
})
