// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  managedLogin: null as null | { provider: 'codex'; requestId: string },
  invoke: vi.fn(), changeProfile: null as ((id: string) => Promise<boolean>) | null
}))
vi.mock('../../../src/renderer/src/features/browser/agentLoginTabs', () => ({ getAgentLoginForTab: () => mocks.managedLogin }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({
  settingsSnapshot: () => ({ locale: 'ko-KR', browser: { defaultZoomLevel: 0, homePage: '' } }),
  ensureSettingsLoaded: async () => ({ locale: 'ko-KR' })
}))
vi.mock('../../../src/renderer/src/features/workspace/usePanelVisible', () => ({ usePanelVisible: () => true }))
vi.mock('../../../src/renderer/src/features/workspace/panels/browserAnchor', () => ({ useBrowserAnchorRect: () => {} }))
vi.mock('../../../src/renderer/src/features/browser/BrowserProfilePicker', () => ({ BrowserProfilePicker: ({ onChange }: { onChange: (id: string) => Promise<boolean> }) => { mocks.changeProfile = onChange; return null } }))
vi.mock('../../../src/renderer/src/features/browser/BrowserAddressInput', () => ({ BrowserAddressInput: () => null }))
vi.mock('../../../src/renderer/src/features/browser/videoBridge', () => ({ useWebVideoReport: () => null, openWebVideoInPip: vi.fn() }))

import { guestActions } from '../../../src/renderer/src/features/browser/guestActions'
import { BrowserPanel } from '../../../src/renderer/src/features/browser/BrowserPanel'
import { resetBrowserGuestsForTests, useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { resetFavoritesStoreForTests, useFavoritesStore, favoriteScopeKey } from '../../../src/renderer/src/stores/favoritesStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root, props: IDockviewPanelProps
const listeners = new Set<() => void>()
const ensureGuest = useBrowserGuests.getState().ensureGuest
const refused = 'https://accounts.google.com/v3/signin/challenge/pwd?TL=private-state'
const subscribe = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback) } }
function Harness() { return <BrowserPanel {...useSyncExternalStore(subscribe, () => props)} /> }

beforeEach(() => {
  mocks.managedLogin = null
  mocks.invoke.mockReset().mockResolvedValue({ allowed: true, favorites: [] })
  resetBrowserGuestsForTests()
  useBrowserGuests.setState({ ensureGuest })
  resetFavoritesStoreForTests()
  useFavoritesStore.setState({ byCourse: { [favoriteScopeKey(null)]: [] } })
  useBrowserGuests.getState().ensureGuest('tab', refused, false, 'default', null)
  useBrowserGuests.getState().setAuthFallback('tab', { restartUrl: 'https://chatgpt.com/' })
  props = {
    params: { descriptor: { kind: 'browser', payload: { tabId: 'tab', initialUrl: refused, profileId: 'default' } } },
    api: {
      title: '', setTitle: vi.fn(),
      updateParameters: vi.fn(parameters => {
        // PanelContentHost publishes Dockview params through an external store.
        // Exercise a synchronous props commit before the switch callback ends.
        flushSync(() => {
          props = { ...props, params: { ...props.params, ...parameters } }
          for (const listener of listeners) listener()
        })
      })
    }
  } as unknown as IDockviewPanelProps
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

test('synchronous profile params updates cannot recreate the old session when the login URL restarts', async () => {
  act(() => root.render(<Harness />))
  const ensure = vi.spyOn(useBrowserGuests.getState(), 'ensureGuest')
  await act(async () => { expect(await mocks.changeProfile!('personal')).toBe(true) })
  expect(useBrowserGuests.getState().liveGuests).toMatchObject([{ profileId: 'personal', src: 'https://chatgpt.com/' }])
  expect(ensure.mock.calls.every(call => call[3] === 'personal')).toBe(true)
  expect(props.params.descriptor.payload).toMatchObject({ profileId: 'personal', initialUrl: 'https://chatgpt.com/' })
})

test('switching a rejected login to private mode never recreates the ordinary session', async () => {
  act(() => root.render(<Harness />))
  const ensure = vi.spyOn(useBrowserGuests.getState(), 'ensureGuest')
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="시크릿 모드 켜기"]')!.click() })
  expect(useBrowserGuests.getState().liveGuests).toMatchObject([{ profileId: 'default', isPrivate: true, src: 'https://chatgpt.com/' }])
  expect(ensure.mock.calls.every(call => call[2] === true)).toBe(true)
  expect(props.params.descriptor.payload).toMatchObject({ isPrivate: true, initialUrl: 'https://chatgpt.com/' })
})

test('cancelling beforeunload retains the existing profile, URL, and login notice', async () => {
  act(() => root.render(<Harness />))
  const ensure = vi.spyOn(useBrowserGuests.getState(), 'ensureGuest')
  mocks.invoke.mockResolvedValueOnce({ allowed: false })
  await act(async () => { expect(await mocks.changeProfile!('personal')).toBe(false) })
  expect(ensure.mock.calls.every(call => call[3] === 'default')).toBe(true)
  expect(useBrowserGuests.getState().liveGuests).toMatchObject([{ profileId: 'default', src: refused }])
  expect(useBrowserGuests.getState().authFallback.tab?.restartUrl).toBe('https://chatgpt.com/')
  expect(props.api.updateParameters).not.toHaveBeenCalled()
})


test('supervised refusal explains the separate external session and opens a fresh service URL', async () => {
  useBrowserGuests.getState().setAuthFallback('tab', { restartUrl: 'https://chatgpt.com/', reason: 'supervised-account' })
  act(() => root.render(<Harness />))
  expect(host.textContent).toContain('Family Link 관리 계정의 로그인을 거부')
  expect(host.textContent).toContain('보호자 승인')
  expect(host.textContent).toContain('외부 로그인은 반달에 연결되지 않아요')
  const open = [...host.querySelectorAll('button')].find(button => button.textContent === '기본 브라우저에서 사이트 열기')!
  await act(async () => { open.click() })
  expect(mocks.invoke).toHaveBeenCalledWith('shell:openExternal', { url: 'https://chatgpt.com/' })
})


test('supervised retry navigates to the original service and removes the old refusal', () => {
  useBrowserGuests.getState().setAuthFallback('tab', { restartUrl: 'https://chatgpt.com/', reason: 'supervised-account' })
  const navigate = vi.spyOn(guestActions, 'navigate').mockImplementation(() => {})
  act(() => root.render(<Harness />))
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '원래 사이트 다시 열기')!
  act(() => retry.click())
  expect(navigate).toHaveBeenCalledExactlyOnceWith('tab', 'https://chatgpt.com/')
  expect(useBrowserGuests.getState().authFallback.tab).toBeUndefined()
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'shell:openExternal')).toBe(false)
})


test('managed sign-in refusal continues the original OAuth attempt in the external browser', async () => {
  mocks.managedLogin = { provider: 'codex', requestId: 'managed-attempt' }
  mocks.invoke.mockResolvedValue({ ok: true, allowed: true, favorites: [] })
  act(() => root.render(<Harness />))
  expect(host.textContent).toContain('기본 브라우저에서 로그인하면 반달이 연결을 확인해요')
  const open = [...host.querySelectorAll('button')].find(button => button.textContent === '기본 브라우저에서 로그인 계속하기')!
  await act(async () => { open.click() })
  expect(mocks.invoke).toHaveBeenCalledWith('agent:reopenLogin', { provider: 'codex', requestId: 'managed-attempt', external: true })
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'shell:openExternal')).toBe(false)
})

test('managed supervised refusal offers the working external continuation without a misleading retry', () => {
  mocks.managedLogin = { provider: 'codex', requestId: 'managed-attempt' }
  useBrowserGuests.getState().setAuthFallback('tab', { restartUrl: 'https://chatgpt.com/', reason: 'supervised-account' })
  act(() => root.render(<Harness />))
  expect(host.textContent).not.toContain('원래 사이트 다시 열기')
  expect(host.textContent).not.toContain('반달에서 로그인 다시 열기')
  expect(host.textContent).toContain('기본 브라우저에서 로그인 계속하기')
})
