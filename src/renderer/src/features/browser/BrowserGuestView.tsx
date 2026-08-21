/**
 * [M3-F] One live <webview> guest, positioned over its panel anchor.
 *
 * Lives in the fixed BrowserWebviewLayer — never inside the dockview panel
 * DOM — so tab drags/splits re-parent only the lightweight anchor while the
 * guest (and its renderer process) survives. A null anchor rect hides the
 * guest (visibility, not unmount), per the browserAnchor contract.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  getBrowserAnchorRect,
  onBrowserAnchorRect,
  type AnchorRect
} from '../workspace/panels/browserAnchor'
import { useBrowserGuests, type BrowserNavState } from './browserGuestsStore'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { ABORTED_ERROR_CODE } from './loadError'
import {
  BrowserContextMenu,
  type BrowserContextMenuState
} from './BrowserContextMenu'
import { isDefaultZoom } from './zoom'
import {
  registerGuestElement,
  registerGuestWebContents,
  unregisterGuestElement
} from './guestActions'
import { useWebviewSelectionBridge } from './selectionBridge'
import { useWebviewLoginBridge } from './loginBridge'
import { useWebviewDiagnosticsBridge } from './diagnosticsBridge'
import type {
  PageFaviconUpdatedEvent,
  ContextMenuEvent,
  FoundInPageEvent,
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  PageTitleUpdatedEvent,
  WebviewTag
} from './webviewTypes'

/** The only partition main-side hardening allows guests to attach with. */
const BROWSING_PARTITION = 'persist:browsing'

interface BrowserGuestViewProps {
  tabId: string
  src: string
}

function guestStyle(rect: AnchorRect | null): CSSProperties {
  if (rect === null) return { visibility: 'hidden' }
  return {
    visibility: 'visible',
    transform: `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`,
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

export function BrowserGuestView({
  tabId,
  src
}: BrowserGuestViewProps): JSX.Element {
  const webviewRef = useRef<WebviewTag | null>(null)
  const [rect, setRect] = useState<AnchorRect | null>(() =>
    getBrowserAnchorRect(tabId)
  )
  const [contextMenu, setContextMenu] =
    useState<BrowserContextMenuState | null>(null)
  const overlayVisible = useBrowserGuests(
    (state) => (state.overlay[tabId] ?? null) !== null
  )
  useWebviewSelectionBridge(webviewRef)
  useWebviewLoginBridge(tabId, webviewRef)
  useWebviewDiagnosticsBridge(tabId, webviewRef)

  useEffect(
    () =>
      onBrowserAnchorRect((id, nextRect) => {
        if (id === tabId) setRect(nextRect)
      }),
    [tabId]
  )

  // Becoming visible counts as "used" for LRU purposes.
  const isVisible = rect !== null && !overlayVisible
  useEffect(() => {
    if (isVisible) useBrowserGuests.getState().touchGuest(tabId)
  }, [isVisible, tabId])

  useEffect(() => {
    const element = webviewRef.current
    if (element === null) return
    registerGuestElement(tabId, element)

    const update = (patch: Partial<BrowserNavState>): void => {
      useBrowserGuests.getState().updateNav(tabId, patch)
    }
    const applyZoom = (): void => {
      const level = useBrowserGuests.getState().zoom[tabId]
      if (level === undefined || isDefaultZoom(level)) return
      try {
        element.setZoomLevel(level)
      } catch {
        // Detached; the next dom-ready re-applies it.
      }
    }
    const historyState = (): Partial<BrowserNavState> => {
      try {
        return {
          canGoBack: element.canGoBack(),
          canGoForward: element.canGoForward()
        }
      } catch {
        return {} // not attached yet — the next event refreshes it
      }
    }

    const listeners: ReadonlyArray<[string, EventListener]> = [
      [
        'did-start-loading',
        () => {
          // iframe/광고 서브프레임 로드에도 이 이벤트가 온다 — 메인 프레임
          // 항해가 아닐 때 로딩 바를 켜면 사이트가 "계속 로딩 중"으로 보인다.
          try {
            if (!element.isLoadingMainFrame()) return
          } catch {
            // not attached yet — treat as main-frame load
          }
          useBrowserGuests.getState().setOverlay(tabId, null)
          update({ loading: true })
        }
      ],
      ['did-stop-loading', () => update({ loading: false, ...historyState() })],
      [
        'did-navigate',
        ((event: DidNavigateEvent) =>
          update({ url: event.url, ...historyState() })) as EventListener
      ],
      [
        'did-navigate-in-page',
        ((event: DidNavigateInPageEvent) => {
          if (event.isMainFrame) update({ url: event.url, ...historyState() })
        }) as EventListener
      ],
      [
        'page-title-updated',
        ((event: PageTitleUpdatedEvent) =>
          update({ title: event.title })) as EventListener
      ],
      [
        'did-fail-load',
        ((event: DidFailLoadEvent) => {
          update({ loading: false })
          // Subframe failures (ads, trackers, a dead iframe) must never take
          // over the whole tab — the page around them is fine.
          if (event.isMainFrame === false) return
          if (event.errorCode === ABORTED_ERROR_CODE) return
          useBrowserGuests.getState().setOverlay(tabId, {
            kind: 'error',
            errorCode: event.errorCode,
            errorDescription: event.errorDescription,
            url: event.validatedURL
          })
        }) as EventListener
      ],
      [
        // Not a nav concern: this is where the guest's WebContents id first
        // exists, and main needs the id -> tabId mapping to route a chord it
        // swallowed (see ShortcutPassthrough). Re-running per navigation is
        // harmless and self-healing.
        'dom-ready',
        () => {
          registerGuestWebContents(tabId, element)
          applyZoom()
        }
      ],
      [
        // A cross-origin navigation gets a new render process, and the zoom
        // level lives on the process — without this the page silently snaps
        // back to 100% mid-session.
        'did-navigate',
        () => applyZoom()
      ],
      [
        'context-menu',
        ((event: ContextMenuEvent) => {
          // Guest-viewport coordinates: the menu is host DOM, so shift them by
          // where the guest actually sits on screen.
          const rect = element.getBoundingClientRect()
          setContextMenu({
            x: rect.left + event.params.x,
            y: rect.top + event.params.y,
            guestX: event.params.x,
            guestY: event.params.y,
            linkURL: event.params.linkURL,
            srcURL: event.params.srcURL,
            mediaType: event.params.mediaType,
            selectionText: event.params.selectionText,
            isEditable: event.params.isEditable === true,
            pageURL: event.params.pageURL,
            pageTitle:
              useBrowserGuests.getState().nav[tabId]?.title ?? '',
            courseId: useCoursesStore.getState().selectedCourseId
          })
        }) as EventListener
      ],
      [
        // A dead renderer used to leave a blank rect under a live-looking
        // toolbar, with the PREVIOUS title still in the tab. Closing the tab
        // was the only way out.
        'render-process-gone',
        ((event: Event & { reason?: string }) => {
          useBrowserGuests.getState().setOverlay(tabId, {
            kind: 'crashed',
            url: useBrowserGuests.getState().nav[tabId]?.url ?? '',
            reason: event.reason ?? 'crashed'
          })
        }) as EventListener
      ],
      [
        'crashed',
        (() => {
          useBrowserGuests.getState().setOverlay(tabId, {
            kind: 'crashed',
            url: useBrowserGuests.getState().nav[tabId]?.url ?? '',
            reason: 'crashed'
          })
        }) as EventListener
      ],
      [
        'page-favicon-updated',
        ((event: PageFaviconUpdatedEvent) => {
          // Chromium lists every declared icon; the last is the best match.
          const best = event.favicons.at(-1)
          if (best === undefined) return
          void invoke('browser:favicon', { url: best })
            .then((result) => {
              useBrowserGuests.getState().setFavicon(tabId, result.dataUrl)
            })
            .catch(() => {
              // A missing icon is a missing icon; the globe stands in.
            })
        }) as EventListener
      ],
      [
        'found-in-page',
        ((event: FoundInPageEvent) => {
          // Intermediate updates carry running totals; only the final one is
          // authoritative for the count.
          useBrowserGuests.getState().setFindResult(tabId, {
            activeMatch: event.result.activeMatchOrdinal,
            matchCount: event.result.matches
          })
        }) as EventListener
      ]
    ]
    for (const [name, listener] of listeners) {
      element.addEventListener(name, listener)
    }
    return () => {
      for (const [name, listener] of listeners) {
        element.removeEventListener(name, listener)
      }
      unregisterGuestElement(tabId, element)
    }
  }, [tabId])

  return (
    <div
      className="browser-guest"
      style={guestStyle(overlayVisible ? null : rect)}
    >
      <webview
        ref={(element) => {
          webviewRef.current = element as WebviewTag | null
        }}
        src={src}
        partition={BROWSING_PARTITION}
        // Without this attribute Chromium drops window.open/target=_blank
        // INSIDE the guest — main's setWindowOpenHandler never even fires
        // (it still denies native windows and forwards URLs as Bandal tabs).
        // @types/react types it as boolean, but React's runtime silently
        // DROPS boolean-true for unknown attributes — only a string reaches
        // the DOM, so the cast is load-bearing. Verified via
        // renderToStaticMarkup: {true} → no attribute, '' → attribute set.
        allowpopups={'' as unknown as boolean}
      />
      {contextMenu !== null && (
        <BrowserContextMenu
          tabId={tabId}
          state={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
