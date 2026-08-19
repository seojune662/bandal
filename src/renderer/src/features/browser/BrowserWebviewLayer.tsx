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

import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { onPush } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { useNewTabMenu } from '../workspace/newTabMenuController'
import { BrowserGuestView } from './BrowserGuestView'
import { useBrowserGuests } from './browserGuestsStore'
import {
  isPointerPassthroughActive,
  onPointerPassthrough
} from './webviewPassthrough'
import './browser.css'

const EXTERNAL_AUTH_NOTICE_MS = 6000

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
      onPush('browser:open-url', ({ url }) => {
        useWorkspaceStore
          .getState()
          .openTab(descriptorFor('browser', { tabId: uuidv4(), initialUrl: url }))
      }),
    []
  )
}

/** Explain when main moves a guest auth flow to the default browser. */
function useExternalAuthNotice(): void {
  const dismissTimer = useRef<number | null>(null)

  useEffect(() => {
    const unsubscribe = onPush('browser:external-auth', ({ url }) => {
      const state = useBrowserGuests.getState()
      state.showExternalAuthNotice(url)

      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current)
      }
      dismissTimer.current = window.setTimeout(() => {
        useBrowserGuests.getState().dismissExternalAuthNotice()
        dismissTimer.current = null
      }, EXTERNAL_AUTH_NOTICE_MS)
    })

    return () => {
      unsubscribe()
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current)
      }
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
  useExternalAuthNotice()

  const isPassthrough = isDragActive || isMenuOpen || hasExternalToken

  return (
    <div
      className="browser-webview-layer"
      data-passthrough={isPassthrough ? 'true' : undefined}
    >
      {liveGuests.map((guest) => (
        <BrowserGuestView key={guest.tabId} tabId={guest.tabId} src={guest.src} />
      ))}
    </div>
  )
}
