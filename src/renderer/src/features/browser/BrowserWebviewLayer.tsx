/**
 * [M3-F] Fixed layer hosting every live <webview> guest OUTSIDE the dockview
 * DOM. Mounted once at shell level (AppShell).
 *
 * Also owns the cross-cutting wiring:
 *  - guest destruction when the workspace closes a browser tab
 *  - `browser:open-url` pushes (denied window.open) → new Bandal browser tab
 *  - `browser:external-auth` pushes → short-lived in-panel notice
 *  - pointer passthrough while dockview drags / the new-tab menu / any
 *    external overlay (webviewPassthrough tokens) are active
 */

import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { onPush } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { useNewTabMenu } from '../workspace/newTabMenuController'
import { BrowserGuestView } from './BrowserGuestView'
import { useBrowserGuests } from './browserGuestsStore'
import {
  useActivateTabRequests,
  useAgentTabSync,
  useCloseTabRequests
} from './agentTabSync'
import { rememberOpenRequest, tabIdForWebContents } from './guestActions'
import {
  isPointerPassthroughActive,
  onPointerPassthrough
} from './webviewPassthrough'
import './browser.css'

/** Release guests whose tab is no longer open (closeTab / course switch). */
function useGuestReaper(): void {
  useEffect(
    () =>
      useWorkspaceStore.subscribe((state) => {
        // While a course hydration is in flight openTabs is transiently
        // empty; only reap against a settled workspace.
        if (state.hydration !== 'ready') return
        const openBrowserTabs = new Set<string>()
        for (const descriptor of Object.values(state.openTabs)) {
          if (descriptor.kind === 'browser') {
            openBrowserTabs.add(descriptor.payload.tabId)
          }
        }
        const { nav, recent, overlay, removeGuest } =
          useBrowserGuests.getState()
        const sessionTabIds = new Set([
          ...Object.keys(nav),
          ...Object.keys(recent),
          ...Object.keys(overlay)
        ])
        for (const tabId of sessionTabIds) {
          if (!openBrowserTabs.has(tabId)) removeGuest(tabId)
        }
      }),
    []
  )
}

/** window.open from a guest, denied in main → open as a new browser tab. */
function useOpenUrlForwarding(): void {
  useEffect(
    () =>
      onPush('browser:open-url', ({ url, background, requestId, isPrivate }) => {
        const tabId = uuidv4()
        // Main matched the new tab to the agent's request by URL prefix, which
        // a redirect breaks. Remember which request this tab belongs to so the
        // guest can say so when it registers.
        if (requestId !== undefined) rememberOpenRequest(tabId, requestId)
        useWorkspaceStore
          .getState()
          .openTab(
            descriptorFor('browser', {
              tabId,
              initialUrl: url,
              ...(isPrivate === true ? { isPrivate: true } : {})
            }),
            background === true ? { background: true } : undefined
          )
      }),
    []
  )
}

/** A popup loaded in-app first and then proved that it refuses embedding. */
function useAuthFallbackForwarding(): void {
  useEffect(
    () => onPush('browser:external-auth', ({ url, webContentsId }) => {
      if (webContentsId === undefined) return
      const tabId = tabIdForWebContents(webContentsId)
      if (tabId !== null) {
        useBrowserGuests.getState().setAuthFallback(tabId, url)
      }
    }),
    []
  )
}

/**
 * Say when the browser refuses something the page asked for.
 *
 * Silence here is what made a broken portal indistinguishable from a page
 * with nothing to do — the app knew exactly what it had blocked and told
 * nobody.
 */
function useBlockedNotices(): void {
  useEffect(() => {
    const unsubscribePopup = onPush('browser:popup-blocked', () => {
      // No 허용 button on purpose: a one-click popup allowlist is a phishing
      // lever, and a page that needs a fourth window at once is not a page.
      showToast('팝업을 막았어요.')
    })
    // Main emits this on every deny. Nobody was listening, so a page that
    // navigated to a hard-blocked scheme produced a console.warn and nothing
    // else — the 보안 프로그램 설치 link just did nothing, forever.
    const unsubscribeBlocked = onPush('browser:blocked', ({ kind }) => {
      if (kind !== 'navigation') return
      showToast('이 주소는 반달에서 열 수 없어요.')
    })
    const unsubscribeScheme = onPush('browser:external-scheme', ({ outcome }) => {
      if (outcome !== 'no-handler') return
      showToast('이 프로그램이 설치되어 있지 않아요.')
    })
    return () => {
      unsubscribePopup()
      unsubscribeBlocked()
      unsubscribeScheme()
    }
  }, [])
}

/**
 * True while a dockview interaction owns the pointer: HTML5 dnd (tab/group
 * drags) or a sash resize drag started on a `.dv-sash`.
 */
function useDockviewDragActive(): boolean {
  const [isDragActive, setDragActive] = useState(false)
  useEffect(() => {
    const start = (event?: Event): void => {
      // Material file rows, including images, promote to a native OS drag (dragstart is
      // cancelled, so no dragend ever fires) and their whole point is
      // dropping INTO a guest page (mail attach, LMS upload). Passthrough
      // would remove every guest from drag hit-testing — skip it.
      const target = event?.target
      if (target instanceof Element) {
        const row = target.closest('[data-material-row]')
        const kind = row?.getAttribute('data-kind')
        if (row !== null && kind !== 'dir') return
      }
      setDragActive(true)
    }
    const end = (): void => setDragActive(false)
    const onSashRelease = (): void => {
      end()
      window.removeEventListener('pointerup', onSashRelease, true)
      window.removeEventListener('pointercancel', onSashRelease, true)
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element) || target.closest('.dv-sash') === null) {
        return
      }
      start()
      window.addEventListener('pointerup', onSashRelease, true)
      window.addEventListener('pointercancel', onSashRelease, true)
    }
    window.addEventListener('dragstart', start, true)
    window.addEventListener('dragend', end, true)
    window.addEventListener('drop', end, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    // Safety net: a cancelled dragstart never emits dragend, which used to
    // leave passthrough stuck on (guests unclickable until the next drop).
    window.addEventListener('mouseup', end, true)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('dragstart', start, true)
      window.removeEventListener('dragend', end, true)
      window.removeEventListener('drop', end, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('mouseup', end, true)
      window.removeEventListener('blur', end)
      window.removeEventListener('pointerup', onSashRelease, true)
      window.removeEventListener('pointercancel', onSashRelease, true)
    }
  }, [])
  return isDragActive
}

export function BrowserWebviewLayer(): JSX.Element {
  const liveGuests = useBrowserGuests((state) => state.liveGuests)
  const isMenuOpen = useNewTabMenu((state) => state.isOpen)
  const isDragActive = useDockviewDragActive()
  const [hasExternalToken, setExternalToken] = useState(
    isPointerPassthroughActive
  )
  useEffect(() => onPointerPassthrough(setExternalToken), [])
  useGuestReaper()
  useOpenUrlForwarding()
  useAuthFallbackForwarding()
  useBlockedNotices()
  useAgentTabSync()
  useActivateTabRequests()
  useCloseTabRequests()

  const isPassthrough = isDragActive || isMenuOpen || hasExternalToken

  return (
    <div
      className="browser-webview-layer"
      data-passthrough={isPassthrough ? 'true' : undefined}
    >
      {liveGuests.map((guest) => (
        <BrowserGuestView
          key={`${guest.tabId}:${guest.isPrivate ? 'private' : 'normal'}`}
          tabId={guest.tabId}
          src={guest.src}
          isPrivate={guest.isPrivate}
        />
      ))}
    </div>
  )
}
