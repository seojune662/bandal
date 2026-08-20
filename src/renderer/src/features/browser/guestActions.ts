/**
 * [M3-F] Imperative handle registry for live <webview> elements.
 *
 * Kept outside React state (mirrors the workspace's DockviewApi pattern):
 * BrowserGuestView registers its element, BrowserPanel chrome drives
 * navigation through `guestActions`. Webview methods throw while the guest
 * is detached/booting, so every call is guarded.
 */

import { invoke } from '../../lib/ipc'
import type { FindInPageOptions, WebviewTag } from './webviewTypes'

const elements = new Map<string, WebviewTag>()

/**
 * webContentsId -> tabId. Main identifies a guest by its WebContents id (that
 * is all it has when a chord is swallowed mid-page), while everything in the
 * renderer is keyed by tabId. Filled on `dom-ready`: `getWebContentsId()`
 * throws before the guest attaches.
 */
const tabIdByWebContents = new Map<number, string>()

export function registerGuestElement(tabId: string, element: WebviewTag): void {
  elements.set(tabId, element)
}

/** Call once the guest has attached, when its WebContents id exists. */
export function registerGuestWebContents(tabId: string, element: WebviewTag): void {
  try {
    const webContentsId = element.getWebContentsId()
    tabIdByWebContents.set(webContentsId, tabId)
    // Main only ever sees a WebContents id, so it needs the same mapping to
    // let the agent address a tab. Re-sent per dom-ready: self-healing.
    void invoke('browserAgent:registerTab', { tabId, webContentsId }).catch(
      () => {
        // The agent simply cannot reach this tab; nothing to surface.
      }
    )
  } catch {
    // Detached again already — the next dom-ready re-registers it.
  }
}

export function tabIdForWebContents(webContentsId: number): string | null {
  return tabIdByWebContents.get(webContentsId) ?? null
}

export function unregisterGuestElement(
  tabId: string,
  element: WebviewTag
): void {
  if (elements.get(tabId) === element) elements.delete(tabId)
  for (const [webContentsId, mapped] of tabIdByWebContents) {
    if (mapped === tabId) tabIdByWebContents.delete(webContentsId)
  }
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
  reloadIgnoringCache: (tabId: string): void => {
    withGuest(tabId, (element) => element.reloadIgnoringCache())
  },
  setZoom: (tabId: string, level: number): void => {
    withGuest(tabId, (element) => element.setZoomLevel(level))
  },
  /**
   * Omit `options` to start a fresh search (reports match 1 of N); pass
   * `{ findNext: true, forward }` to step.
   *
   * Measured, not read off the docs: an explicit `{ findNext: false }` emits
   * NO `found-in-page` event at all, so the count would sit at 0/0 forever.
   * Omitting the object entirely is not the same thing.
   */
  find: (tabId: string, text: string, options?: FindInPageOptions): void => {
    if (text === '') return
    withGuest(tabId, (element) =>
      options === undefined
        ? element.findInPage(text)
        : element.findInPage(text, options)
    )
  },
  copySelection: (tabId: string): void => {
    withGuest(tabId, (element) => element.copy())
  },
  /**
   * The only way to find out why a Korean portal is broken from inside a
   * release build — which is the only place a real school login exists.
   */
  /** Renders the page to PDF bytes. Rejects if the guest is not attached. */
  printToPdf: async (
    tabId: string,
    options: Record<string, unknown>
  ): Promise<Uint8Array> => {
    const element = elements.get(tabId)
    if (element === undefined) throw new Error('이 탭을 인쇄할 수 없어요.')
    return element.printToPDF(options)
  },

  /**
   * The guest's top-level content type.
   *
   * A tab already showing a PDF cannot be rendered with printToPDF — plugin
   * content is not rasterized and the result is blank.
   */
  contentType: async (tabId: string): Promise<string | null> => {
    const element = elements.get(tabId)
    if (element === undefined) return null
    try {
      const value = await element.executeJavaScript('document.contentType')
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  },

  currentUrl: (tabId: string): string | null => {
    const element = elements.get(tabId)
    if (element === undefined) return null
    try {
      return element.getURL()
    } catch {
      return null
    }
  },

  openDevTools: (tabId: string): void => {
    withGuest(tabId, (element) => element.openDevTools({ mode: 'detach' }))
  },

  copyImageAt: (tabId: string, x: number, y: number): void => {
    withGuest(tabId, (element) => element.copyImageAt(x, y))
  },
  /**
   * Saves through Chromium's own download path rather than re-fetching, so
   * cookies, redirects and Content-Disposition behave exactly as they do for a
   * real click — and there is one download code path, not two.
   */
  download: (tabId: string, url: string): void => {
    withGuest(tabId, (element) => element.downloadURL(url))
  },
  stopFind: (tabId: string): void => {
    withGuest(tabId, (element) => element.stopFindInPage('clearSelection'))
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
