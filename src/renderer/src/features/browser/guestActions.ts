/**
 * [M3-F] Imperative handle registry for live <webview> elements.
 *
 * Kept outside React state (mirrors the workspace's DockviewApi pattern):
 * BrowserGuestView registers its element, BrowserPanel chrome drives
 * navigation through `guestActions`. Webview methods throw while the guest
 * is detached/booting, so every call is guarded.
 */

import type { WebviewTag } from './webviewTypes'

const elements = new Map<string, WebviewTag>()

export function registerGuestElement(tabId: string, element: WebviewTag): void {
  elements.set(tabId, element)
}

export function unregisterGuestElement(
  tabId: string,
  element: WebviewTag
): void {
  if (elements.get(tabId) === element) elements.delete(tabId)
}

function withGuest(tabId: string, action: (element: WebviewTag) => void): void {
  const element = elements.get(tabId)
  if (element === undefined) return
  try {
    action(element)
  } catch (error) {
    console.error('[Bandal] 브라우저 탭 동작을 실행하지 못했습니다.', error)
  }
}

export const guestActions = {
  back: (tabId: string): void => {
    withGuest(tabId, (element) => element.goBack())
  },
  forward: (tabId: string): void => {
    withGuest(tabId, (element) => element.goForward())
  },
  reload: (tabId: string): void => {
    withGuest(tabId, (element) => element.reload())
  },
  stop: (tabId: string): void => {
    withGuest(tabId, (element) => element.stop())
  },
  navigate: (tabId: string, url: string): void => {
    withGuest(tabId, (element) => {
      element.loadURL(url).catch(() => {
        // Aborted/failed loads surface through did-fail-load; nothing to do.
      })
    })
  }
}
