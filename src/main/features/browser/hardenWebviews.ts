/**
 * [M3-F] Electron wiring for the hardened `<webview>` browser tabs.
 *
 * Call `hardenWindowWebviews(win)` on any window created with
 * `webviewTag: true` BEFORE loading its renderer. Policy decisions live in
 * ./webviewPolicy.ts; this module only attaches them to electron objects.
 */

import { app, session, shell } from 'electron'
import type { BrowserWindow, Event as ElectronEvent, WebContents } from 'electron'
import type {
  BrowserOpenUrl,
  ShortcutPassthrough
} from '../../../shared/ipc/events'
import {
  BROWSING_PARTITION,
  isAllowedAttach,
  isBlockedEmbeddedAuthUrl,
  isNavigationAllowed,
  isPermissionAllowed,
  passthroughShortcut,
  popupForwardUrl,
  sanitizeGuestWebPreferences
} from './webviewPolicy'
import { browsingUserAgent } from './userAgent'
import { createBrowserSessionStore } from './sessionStore'

let browsingSessionHardened = false

/**
 * Harden the shared `persist:browsing` session (idempotent):
 *  - permissions deny-by-default (fullscreen only)
 *  - no file:// requests at all (navigation guards cover the main frame;
 *    this catches subresources/subframes as defense in depth)
 *  - [§6.1] a plain Chrome user agent, so UA-sniffing 학사 포털 stop failing
 *    closed on the `Electron/` and app-name tokens (see ./userAgent.ts)
 */
function hardenBrowsingSession(): void {
  if (browsingSessionHardened) return
  browsingSessionHardened = true

  const browsingSession = session.fromPartition(BROWSING_PARTITION)
  const sessionStore = createBrowserSessionStore()
  // The persist: partition lets Chromium retain persistent cookies itself.
  // Flush cookies and DOM storage on graceful quit without changing expiry.
  sessionStore.startFlushOnQuit()
  browsingSession.setUserAgent(
    browsingUserAgent(browsingSession.getUserAgent(), app.getName())
  )
  browsingSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(isPermissionAllowed(permission))
    }
  )
  browsingSession.setPermissionCheckHandler(
    (_webContents, permission) => isPermissionAllowed(permission)
  )
  browsingSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url.startsWith('file:') })
  })
}

/**
 * Per-guest policies, attached the moment a webview's WebContents exists —
 * waiting for renderer-side registration would race early redirects.
 */
function attachGuestPolicies(host: WebContents, guest: WebContents): void {
  // Google-blocked login origins never load in a guest — hand them to the
  // system browser and tell the renderer so the tab can explain why.
  const handOffExternalAuth = (url: string): void => {
    void shell.openExternal(url)
    if (!host.isDestroyed()) {
      const payload: BrowserOpenUrl = { url }
      host.send('browser:external-auth', payload)
    }
  }

  const navigationGuard = (event: ElectronEvent, url: string): void => {
    if (isBlockedEmbeddedAuthUrl(url)) {
      event.preventDefault()
      handOffExternalAuth(url)
      return
    }
    if (!isNavigationAllowed(url)) event.preventDefault()
  }
  guest.on('will-navigate', navigationGuard)
  guest.on('will-redirect', navigationGuard)

  // window.open / target=_blank: never a native window. http(s) targets are
  // forwarded to the renderer, which opens them as a new Bandal browser tab.
  guest.setWindowOpenHandler(({ url }) => {
    if (isBlockedEmbeddedAuthUrl(url)) {
      handOffExternalAuth(url)
      return { action: 'deny' }
    }
    const forwardUrl = popupForwardUrl(url)
    if (forwardUrl !== null && !host.isDestroyed()) {
      const payload: BrowserOpenUrl = { url: forwardUrl }
      host.send('browser:open-url', payload)
    }
    return { action: 'deny' }
  })

  // [M6-A] ⌘T/⌘W keep working while the guest has keyboard focus: intercept
  // them before the guest page sees the chord and replay them in the host.
  guest.on('before-input-event', (event, input) => {
    const action = passthroughShortcut(input)
    if (action !== null && !host.isDestroyed()) {
      event.preventDefault()
      const payload: ShortcutPassthrough = { action, webContentsId: guest.id }
      host.send('shortcut:passthrough', payload)
    }
  })
}

/**
 * Fail-closed webview hardening for one window:
 *  - `will-attach-webview` denies any guest outside the browsing-partition
 *    allowlist and forces sandboxed, isolated, preload-free webPreferences
 *  - `did-attach-webview` installs the navigation + popup policies
 */
export function hardenWindowWebviews(win: BrowserWindow): void {
  hardenBrowsingSession()

  const host = win.webContents
  host.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedAttach(params)) {
      event.preventDefault()
      return
    }
    // The <webview> preload attribute arrives via params — strip it too.
    delete (params as Record<string, unknown>)['preload']
    sanitizeGuestWebPreferences(webPreferences as Record<string, unknown>)
  })

  host.on('did-attach-webview', (_event, guest) => {
    attachGuestPolicies(host, guest)
  })
}
