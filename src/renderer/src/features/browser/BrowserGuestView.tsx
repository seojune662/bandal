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
import { registerGuestElement, unregisterGuestElement } from './guestActions'
import { useWebviewSelectionBridge } from './selectionBridge'
import { useWebviewLoginBridge } from './loginBridge'
import type {
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
  const startPageVisible = useBrowserGuests(
    (state) => state.startPageVisible[tabId] === true
  )
  useWebviewSelectionBridge(webviewRef)
  useWebviewLoginBridge(tabId, webviewRef)

  useEffect(
    () =>
      onBrowserAnchorRect((id, nextRect) => {
        if (id === tabId) setRect(nextRect)
      }),
    [tabId]
  )

  // Becoming visible counts as "used" for LRU purposes.
  const isVisible = rect !== null && !startPageVisible
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
      ['did-fail-load', () => update({ loading: false })]
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
      style={guestStyle(startPageVisible ? null : rect)}
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
    </div>
  )
}
