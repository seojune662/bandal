import { attachNativePage } from './nativePageHandle'
import { overlapsNativePage } from './useNativePageOcclusion'
/**
 * One native browser page, positioned over its stable DOM panel anchor.
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
import { ABORTED_ERROR_CODE } from './loadError'
import {
  BrowserContextMenu,
  type BrowserContextMenuState
} from './BrowserContextMenu'
import { isDefaultZoom } from './zoom'
import {
  shouldFinishMainFrameLoading,
  shouldHandleLoadFailure
} from './loadingIndicator'
import {
  registerGuestElement,
  registerGuestWebContents,
  unregisterGuestElement
} from './guestActions'
import { useBrowserSelectionBridge } from './selectionBridge'
import { useBrowserLoginBridge } from './loginBridge'
import { useBrowserDiagnosticsBridge, recordHttpResponse } from './diagnosticsBridge'
import {
  useBrowserVideoBridge,
  videoReportForTab
} from './videoBridge'
import type {
  PageFaviconUpdatedEvent,
  ContextMenuEvent,
  FoundInPageEvent,
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  PageTitleUpdatedEvent,
  BrowserPageHandle
} from './browserPageTypes'

interface BrowserGuestViewProps {
  tabId: string
  src: string
  isPrivate: boolean
  profileId: string
  suppressed: boolean
  occlusions: readonly AnchorRect[]
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
  src,
  isPrivate,
  profileId,
  suppressed,
  occlusions
}: BrowserGuestViewProps): JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const pageRef = useRef<BrowserPageHandle | null>(null)
  const nativeRef = useRef<ReturnType<typeof attachNativePage> | null>(null)
  const ownerCourse = useBrowserGuests(state =>
    state.liveGuests.find(guest => guest.tabId === tabId)?.courseId ?? null
  )
  const [rect, setRect] = useState<AnchorRect | null>(() =>
    getBrowserAnchorRect(tabId)
  )
  const obscured = suppressed || overlapsNativePage(rect, occlusions)
  const [contextMenu, setContextMenu] =
    useState<BrowserContextMenuState | null>(null)
  const overlayVisible = useBrowserGuests(
    (state) => (state.overlay[tabId] ?? null) !== null
  )
  useEffect(() => {
    if (!anchorRef.current) return
    const native = attachNativePage(anchorRef.current, tabId, isPrivate, ownerCourse, profileId)
    nativeRef.current = native
    pageRef.current = native.handle
    return () => { native.dispose(); nativeRef.current = null; pageRef.current = null }
  }, [tabId, isPrivate, ownerCourse, profileId])
  useEffect(() => {
    nativeRef.current?.bounds(overlayVisible || obscured || contextMenu ? null : rect, rect !== null && !overlayVisible && (obscured || contextMenu !== null))
  }, [rect, overlayVisible, obscured, contextMenu])
  useBrowserSelectionBridge(pageRef)
  useBrowserLoginBridge(tabId, pageRef, !isPrivate)
  useBrowserDiagnosticsBridge(tabId, pageRef)
  useBrowserVideoBridge(tabId, pageRef)

  useEffect(
    () =>
      onBrowserAnchorRect((id, nextRect) => {
        if (id === tabId) setRect(nextRect)
      }),
    [tabId]
  )

  // Keep visit order without discarding hidden page state.
  const isVisible = rect !== null && !overlayVisible
  useEffect(() => {
    if (isVisible) useBrowserGuests.getState().touchGuest(tabId)
  }, [isVisible, tabId])

  useEffect(() => {
    const element = pageRef.current
    if (element === null) return
    registerGuestElement(tabId, element)
    let initialNavigationStarted = false
    let disposed = false

    const update = (patch: Partial<BrowserNavState>): void => {
      useBrowserGuests.getState().updateNav(tabId, patch)
    }
    const applyZoom = (): void => {
      const level = useBrowserGuests.getState().zoom[tabId]
      if (level === undefined || isDefaultZoom(level)) return
      try {
        void element.setZoomLevel(level).catch(() => undefined)
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
      ['dom-ready', () => { registerGuestWebContents(tabId, element); applyZoom() }],
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
          update({ loading: true, httpStatus: 0 })
        }
      ],
      [
        'did-stop-loading',
        () => {
          if (!shouldFinishMainFrameLoading(element)) return
          update({ loading: false, ...historyState() })
        }
      ],
      [
        'did-navigate',
        ((event: DidNavigateEvent) => {
          recordHttpResponse(tabId, event.url, event.httpResponseCode ?? 0)
          update({ httpStatus: event.httpResponseCode ?? 0 })
          if (event.url !== 'about:blank') update({ url: event.url, hasDocument: true, ...historyState() })
        }) as EventListener
      ],
      [
        'did-navigate-in-page',
        ((event: DidNavigateInPageEvent) => {
          if (event.isMainFrame) update({ url: event.url, hasDocument: true, ...historyState() })
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
          // Subframe failures (ads, trackers, a dead iframe) must never take
          // over the whole tab — the page around them is fine.
          if (!shouldHandleLoadFailure(event.isMainFrame)) return
          update({ loading: false })
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
        'did-finish-load',
        () => {
          let url = ''
          try {
            url = element.getURL()
          } catch {
            return
          }
          let host = ''
          try {
            host = new URL(url).hostname
          } catch {
            return
          }
          if (host !== 'accounts.google.com' && host !== 'accounts.youtube.com') {
            useBrowserGuests.getState().setAuthFallback(tabId, null)
            return
          }
          void element.executeJavaScript(`(() => {
            const text = (document.body?.innerText || '').slice(0, 20000);
            return /disallowed[_ -]?useragent|browser or app may not be secure|couldn't sign you in|브라우저 또는 앱이 안전하지 않을 수|지원되지 않는 브라우저/i.test(text);
          })()`).then((blocked) => {
            useBrowserGuests.getState().setAuthFallback(
              tabId,
              blocked === true ? url : null
            )
          }).catch(() => undefined)
        }
      ],
      [
        // Not a nav concern: this is where the guest's WebContents id first
        // exists, and main needs the id -> tabId mapping to route a chord it
        // swallowed (see ShortcutPassthrough). Re-running per navigation is
        // harmless and self-healing.
        'native-ready',
        () => {
          registerGuestWebContents(tabId, element)
          applyZoom()
          if (!initialNavigationStarted && !nativeRef.current?.isAdopted()) {
            initialNavigationStarted = true
            void (async () => {
              const matched = await invoke('browser:courseForUrl', { url: src }).catch(() => ({ courseId: null }))
              if (disposed) return
              await invoke('browser:setDownloadTarget', {
                webContentsId: element.getWebContentsId(), tabId,
                courseId: matched.courseId ?? ownerCourse
              })
              if (!disposed) await element.loadURL(src).catch(() => undefined)
            })().catch((error: unknown) => {
              // Download navigations intentionally abort their document load.
              if (String(error).includes('ERR_ABORTED')) return
              if (!disposed) useBrowserGuests.getState().setOverlay(tabId, {
                kind: 'error', errorCode: -2,
                errorDescription: '페이지를 열지 못했어요.', url: src
              })
            })
          }
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
          const rect = element.element.getBoundingClientRect()
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
            hasPlayingVideo:
              videoReportForTab(tabId)?.hasPlayingVideo === true,
            courseId: ownerCourse
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
          void invoke('browser:favicon', { url: best, profileId, isPrivate })
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
      disposed = true
      for (const [name, listener] of listeners) {
        element.removeEventListener(name, listener)
      }
      unregisterGuestElement(tabId, element)
    }
  }, [tabId])

  return (
    <div
      className="browser-guest"
      data-tab-id={tabId}
      style={guestStyle(overlayVisible ? null : rect)}
    >
      <div className="browser-native-anchor" ref={anchorRef} />
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
