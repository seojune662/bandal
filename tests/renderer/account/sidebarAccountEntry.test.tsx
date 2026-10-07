// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { AuthState } from '../../../src/shared/types/auth'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: () => () => {} }))
import { SidebarAccountEntry } from '../../../src/renderer/src/features/account/SidebarAccountEntry'
import { useAuthStore } from '../../../src/renderer/src/stores/authStore'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const initialAuth = useAuthStore.getState(), initialUi = useUiStore.getState()
const viewport = { width: window.innerWidth, height: window.innerHeight }
const signedIn: AuthState = {
  phase: 'signed-in', profile: { id: 'learner-one', nickname: '  이서준  ', avatarColor: 'blue', avatarEmoji: '' },
  email: 'learner@example.test', avatarUrl: null, online: true, errorCode: null
}
let host: HTMLDivElement, root: Root
let signOut: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  signOut = vi.fn(async () => {})
  useAuthStore.setState({ auth: signedIn, signOut })
  useUiStore.setState({ leftRailOpen: true, isSettingsOpen: false, settingsCategory: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<SidebarAccountEntry />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useAuthStore.setState(initialAuth, true); useUiStore.setState(initialUi, true)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height })
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

const trigger = () => host.querySelector<HTMLButtonElement>('.sidebar-account__trigger')!
const menu = () => host.querySelector<HTMLDivElement>('[role="menu"]')
const items = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
async function open() { await act(async () => trigger().click()); await act(async () => vi.advanceTimersByTimeAsync(20)) }
async function key(value: string, target: Element = document.activeElement!) {
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
}
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('profile menu has a clean identity and only real account and app actions', async () => {
  await open()
  expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
  expect(menu()?.getAttribute('aria-label')).toBe('계정 관리')
  expect(host.querySelector('.sidebar-account__profile strong')?.textContent).toBe('이서준')
  expect(host.querySelector('.sidebar-account__email')?.textContent).toBe('learner@example.test')
  expect(items().map(item => item.textContent)).toEqual(['계정 설정', '앱 설정', '로그아웃'])
  expect(menu()?.querySelectorAll('[role="separator"]')).toHaveLength(2)
  expect(host.textContent).not.toMatch(/구독|업그레이드|사용량|닉네임 설정 전/)
  await act(async () => useAuthStore.setState({ auth: { ...signedIn, profile: { ...signedIn.profile!, nickname: null } } }))
  expect(host.querySelector('.sidebar-account__profile strong')?.textContent).toBe('learner')
  await act(async () => useAuthStore.setState({ auth: { ...signedIn, phase: 'signed-out', profile: null } }))
  expect(trigger()).toBeNull()
  expect(menu()).toBeNull()
})

test('account and app settings use their actual destinations and dismiss the menu', async () => {
  await open()
  await act(async () => items()[0]!.click())
  expect(menu()).toBeNull()
  expect(useUiStore.getState()).toMatchObject({ isSettingsOpen: true, settingsCategory: 'account' })
  await open()
  await act(async () => items()[1]!.click())
  expect(menu()).toBeNull()
  expect(useUiStore.getState()).toMatchObject({ isSettingsOpen: true, settingsCategory: null })
})

test('keyboard entry, wrapping, Home/End, Escape and Tab keep predictable focus', async () => {
  trigger().focus()
  await key('ArrowDown', trigger())
  await act(async () => vi.advanceTimersByTimeAsync(20))
  expect(document.activeElement).toBe(items()[0])
  await key('ArrowDown'); expect(document.activeElement).toBe(items()[1])
  await key('ArrowDown'); expect(document.activeElement).toBe(items()[2])
  await key('ArrowDown'); expect(document.activeElement).toBe(items()[0])
  await key('ArrowUp'); expect(document.activeElement).toBe(items()[2])
  await key('Home'); expect(document.activeElement).toBe(items()[0])
  await key('End'); expect(document.activeElement).toBe(items()[2])
  await key('Escape')
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger())
  await key('ArrowUp', trigger())
  await act(async () => vi.advanceTimersByTimeAsync(20))
  expect(document.activeElement).toBe(items()[2])
  expect(items().map(item => item.tabIndex)).toEqual([-1, -1, 0])
  await key('Tab')
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger())
})

test('outside pointer leaves the outside target focused; trigger, blur and hidden rail dismiss', async () => {
  const outside = document.createElement('button'); document.body.append(outside)
  try {
    await open(); outside.focus()
    await act(async () => outside.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(outside)
    await open()
    await act(async () => trigger().dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(menu()).not.toBeNull()
    await act(async () => trigger().click())
    expect(menu()).toBeNull()
    await open(); await act(async () => window.dispatchEvent(new Event('blur')))
    expect(menu()).toBeNull()
    await open(); await act(async () => useUiStore.setState({ leftRailOpen: false }))
    expect(menu()).toBeNull()
  } finally { outside.remove() }
})

test('one pending signout survives dismissal, keeps its error on reopen and allows retry', async () => {
  const first = deferred(), retry = deferred()
  signOut.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  await open()
  await act(async () => { items()[2]!.focus(); items()[2]!.click(); items()[2]!.click() })
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(menu()?.getAttribute('aria-busy')).toBe('true')
  expect(items()[2]!.getAttribute('aria-disabled')).toBe('true')
  await key('End')
  expect(document.activeElement).toBe(items()[1])
  await key('Escape')
  await act(async () => first.reject(new Error('fixture network failure')))
  await open()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('다시 시도해 주세요')
  expect(items()[2]!.getAttribute('aria-disabled')).toBeNull()
  await act(async () => items()[2]!.click())
  expect(signOut).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role="alert"]')).toBeNull()
  await act(async () => retry.resolve())
  expect(menu()).toBeNull()
  await open()
  expect(items()[2]!.getAttribute('aria-disabled')).toBeNull()
})

test('late failure from a previous account cannot alter the new account menu', async () => {
  const pending = deferred()
  signOut.mockReturnValueOnce(pending.promise)
  await open(); await act(async () => items()[2]!.click())
  await act(async () => useAuthStore.setState({ auth: { ...signedIn, profile: { ...signedIn.profile!, id: 'learner-two', nickname: '다른 계정' } } }))
  expect(menu()).toBeNull()
  await open()
  await act(async () => pending.reject(new Error('previous account failure')))
  expect(host.querySelector('.sidebar-account__profile strong')?.textContent).toBe('다른 계정')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(items()[2]!.getAttribute('aria-disabled')).toBeNull()
})

test('shared viewport bounds cap and translate the menu in a small viewport and after resizing', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 170 })
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('sidebar-account__popover')) return original.call(this)
    const width = Math.min(272, parseFloat(this.style.maxWidth) || 272), height = Math.min(220, parseFloat(this.style.maxHeight) || 220)
    return { x: 280, y: -60, left: 280, top: -60, width, height, right: 280 + width, bottom: -60 + height, toJSON: () => ({}) }
  })
  await open()
  expect(menu()?.style.maxWidth).toBe('224px'); expect(menu()?.style.maxHeight).toBe('154px')
  expect(menu()?.style.translate).toBe('-272px 68px')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 })
  await act(async () => { window.dispatchEvent(new Event('resize')); await vi.advanceTimersByTimeAsync(20) })
  expect(menu()?.style.maxWidth).toBe('304px'); expect(menu()?.style.maxHeight).toBe('224px')
  expect(menu()?.style.translate).toBe('-240px 68px')
})
