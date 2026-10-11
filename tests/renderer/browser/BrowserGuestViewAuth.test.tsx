// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { BrowserPageEvent, BrowserPageState } from '../../../src/shared/types/browserNative'
import type { BrowserAuthEvent } from '../../../src/shared/ipc/events'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), pageEvent: null as ((event: BrowserPageEvent) => void) | null,
  authEvent: null as ((event: BrowserAuthEvent) => void) | null
}))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: mocks.invoke,
  onPush: (name: string, callback: unknown) => {
    if (name === 'browser:page-event') mocks.pageEvent = callback as typeof mocks.pageEvent
    if (name === 'browser:external-auth') mocks.authEvent = callback as typeof mocks.authEvent
    return () => {}
  }
}))
vi.mock('../../../src/renderer/src/features/browser/selectionBridge', () => ({ useBrowserSelectionBridge: () => {} }))
vi.mock('../../../src/renderer/src/features/browser/loginBridge', () => ({ useBrowserLoginBridge: () => {} }))
vi.mock('../../../src/renderer/src/features/browser/diagnosticsBridge', () => ({ useBrowserDiagnosticsBridge: () => {}, recordHttpResponse: vi.fn() }))
vi.mock('../../../src/renderer/src/features/browser/videoBridge', () => ({ useBrowserVideoBridge: () => {}, videoReportForTab: () => null }))
vi.mock('../../../src/renderer/src/features/browser/BrowserContextMenu', () => ({ BrowserContextMenu: () => null }))

import { BrowserGuestView } from '../../../src/renderer/src/features/browser/BrowserGuestView'
import { resetBrowserGuestsForTests, useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { installBrowserAuthForwarding } from '../../../src/renderer/src/features/browser/browserAuthForwarding'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
let created!: (result: { state: BrowserPageState; adopted: boolean }) => void
let uninstallAuth: () => void
const refused: BrowserPageState = {
  id: 41, url: 'https://accounts.google.com/denied', title: '로그인할 수 없음',
  authDocumentId: 'refused-document',
  httpStatus: 200, loading: false, canGoBack: true, canGoForward: false
}

beforeEach(() => {
  resetBrowserGuestsForTests()
  mocks.pageEvent = null
  mocks.authEvent = null
  mocks.invoke.mockReset().mockImplementation(channel => channel === 'browser:createPage'
    ? new Promise(resolve => { created = resolve })
    : Promise.resolve({ snapshot: null, ok: true }))
  useBrowserGuests.getState().ensureGuest('popup', refused.url, false, 'default', null)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  uninstallAuth = installBrowserAuthForwarding()
})
afterEach(() => { act(() => root.unmount()); uninstallAuth(); host.remove() })

test('a refusal received before popup adoption survives the snapshot and clears on the next real navigation', async () => {
  act(() => root.render(<BrowserGuestView tabId="popup" src={refused.url} profileId="default"
    isPrivate={false} suppressed={false} occlusions={[]} />))
  // Main can detect the site's refusal while its native popup waits for adoption.
  act(() => mocks.authEvent!({ tabId: 'popup', webContentsId: 41, sourceWebContentsId: 41,
    documentId: 'refused-document', status: 'blocked', reason: 'insecure-browser',
    restartUrl: 'https://chatgpt.com/', origin: 'https://accounts.google.com', path: '/denied' }))
  expect(useBrowserGuests.getState().authFallback.popup).toBeUndefined()
  await act(async () => { created({ state: refused, adopted: true }); await Promise.resolve() })
  expect(useBrowserGuests.getState().authFallback.popup).toBe('https://chatgpt.com/')
  expect(useBrowserGuests.getState().nav.popup?.url).toBe(refused.url)
  expect(mocks.invoke.mock.calls.some(call => call[0] === 'browser:pageAction' && call[1]?.action === 'loadURL')).toBe(false)
  act(() => mocks.authEvent!({ tabId: 'popup', webContentsId: 41, sourceWebContentsId: 41,
    documentId: 'next-document', status: 'clear', origin: 'https://chatgpt.com', path: '/' }))
  expect(useBrowserGuests.getState().authFallback.popup).toBe('https://chatgpt.com/')
  act(() => mocks.pageEvent!({ tabId: 'popup', name: 'did-navigate',
    state: { ...refused, authDocumentId: 'next-document', url: 'https://chatgpt.com/' }, detail: { url: 'https://chatgpt.com/', httpResponseCode: 200 } }))
  expect(useBrowserGuests.getState().authFallback.popup).toBeUndefined()
})
