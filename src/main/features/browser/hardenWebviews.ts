/**
 * [M3-F] Electron wiring for the hardened `<webview>` browser tabs.
 *
 * Call `hardenWindowWebviews(win)` on any window created with
 * `webviewTag: true` BEFORE loading its renderer. Policy decisions live in
 * ./webviewPolicy.ts; this module only attaches them to electron objects.
 */

import { app, BrowserWindow, dialog, session, shell } from 'electron'
import type { Event as ElectronEvent, WebContents } from 'electron'
import type {
  BrowserOpenUrl,
  ShortcutPassthrough
} from '../../../shared/ipc/events'
import {
  BROWSING_PARTITION,
  decidePopup,
  isAllowedAttach,
  isBlockedEmbeddedAuthUrl,
  isNavigationAllowed,
  isPermissionAllowed,
  passthroughShortcut,
  popupWindowSize,
  sanitizeGuestWebPreferences
} from './webviewPolicy'
import {
  classifyExternalScheme,
  externalSchemeDisplay,
  requestingOriginOf
} from './externalScheme'
import { createPopupLimiter } from './popupLimiter'
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

const popupLimiter = createPopupLimiter(() => Date.now())

/** One dialog per guest at a time — a page must not be able to spam them. */
const schemeAsksInFlight = new Set<number>()

/**
 * Tells the renderer, and the log, that something was refused.
 *
 * Every deny path used to be a bare `preventDefault()` with no output at all.
 * That is why diagnosing a broken portal meant reading this file: the app knew
 * exactly what it had blocked and told nobody.
 */
function noteBlocked(
  host: WebContents,
  kind: 'navigation' | 'popup' | 'scheme',
  url: string,
  reason: string
): void {
  console.warn(`[browser] blocked ${kind}: ${reason} — ${url}`)
  if (host.isDestroyed()) return
  host.send('browser:blocked', { kind, url, reason })
}

/** The hardened preferences every real popup window gets. */
function popupWebPreferences(): Electron.WebPreferences {
  return {
    partition: BROWSING_PARTITION,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    // A blob: PDF popup is a common 고지서 path; without this it downloads.
    plugins: true
  }
}

/**
 * Offers to hand a custom scheme to the operating system.
 *
 * A NATIVE dialog, not an in-app overlay, and deliberately so: a guest can
 * draw a pixel-perfect copy of any Bandal surface inside its own rect and
 * train the student to press 열기. A macOS sheet is one thing web content
 * cannot forge. It also serialises for free — a page cannot stack them.
 */
async function offerExternalScheme(
  host: WebContents,
  guest: WebContents,
  url: string
): Promise<void> {
  const verdict = classifyExternalScheme(url)
  if (verdict.kind === 'blocked') {
    noteBlocked(host, 'scheme', url, verdict.reason)
    return
  }
  if (schemeAsksInFlight.has(guest.id)) return
  schemeAsksInFlight.add(guest.id)
  try {
    const owner = BrowserWindow.fromWebContents(host)
    const origin = requestingOriginOf(guest.getURL())
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      noLink: true,
      buttons: ['취소', '열기'],
      defaultId: 0,
      cancelId: 0,
      message: '이 페이지가 다른 프로그램을 열려고 합니다.',
      detail:
        `요청한 사이트: ${origin}\n` +
        `실행할 주소: ${externalSchemeDisplay(url)}\n\n` +
        '모르는 프로그램이라면 취소하십시오.'
    }
    const { response } =
      owner === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(owner, options)
    if (response !== 1) return
    try {
      await shell.openExternal(url)
    } catch {
      // No registered handler — the usual case for an uninstalled Korean
      // plugin. Silence here is how you get "눌렀는데 아무 일도 없어요".
      if (!host.isDestroyed()) {
        host.send('browser:external-scheme', { url, origin, outcome: 'no-handler' })
      }
    }
  } finally {
    schemeAsksInFlight.delete(guest.id)
  }
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
    if (isNavigationAllowed(url)) return
    event.preventDefault()
    // `will-navigate` is main-frame only, so a subframe or ad cannot reach
    // this — the dialog is only ever offered for a top-level attempt.
    void offerExternalScheme(host, guest, url)
  }
  guest.on('will-navigate', navigationGuard)
  guest.on('will-redirect', navigationGuard)

  guest.setWindowOpenHandler((details) => {
    const decision = decidePopup({
      openerUrl: guest.getURL(),
      targetUrl: details.url
    })

    if (decision.kind === 'external') {
      handOffExternalAuth(details.url)
      return { action: 'deny' }
    }

    if (decision.kind === 'window') {
      const admission = popupLimiter.admit(guest.id)
      if (!admission.ok) {
        noteBlocked(host, 'popup', details.url, admission.reason)
        if (!host.isDestroyed()) {
          host.send('browser:popup-blocked', {
            url: details.url,
            reason: admission.reason
          })
        }
        return { action: 'deny' }
      }
      const size = popupWindowSize(decision.scope, details.features)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: size.width,
          height: size.height,
          // No app chrome on it: this is the site's own window, not ours.
          autoHideMenuBar: true,
          webPreferences: popupWebPreferences()
        }
      }
    }

    if (decision.kind === 'tab') {
      if (!host.isDestroyed()) {
        const payload: BrowserOpenUrl = { url: decision.url }
        host.send('browser:open-url', payload)
      }
      return { action: 'deny' }
    }

    if (decision.kind === 'scheme') {
      void offerExternalScheme(host, guest, details.url)
      return { action: 'deny' }
    }

    noteBlocked(host, 'popup', details.url, 'not-allowed')
    return { action: 'deny' }
  })

  // A popup we allowed is still a window that can navigate. Without this the
  // popup exception would be a hole: the child could walk to file:// or a
  // custom scheme, which is exactly what `will-navigate` exists to stop.
  guest.on('did-create-window', (window) => {
    const child = window.webContents
    window.once('closed', () => popupLimiter.release(guest.id))
    const guard = (event: { preventDefault: () => void }, url: string): void => {
      if (isBlockedEmbeddedAuthUrl(url)) {
        event.preventDefault()
        handOffExternalAuth(url)
        return
      }
      if (isNavigationAllowed(url)) return
      event.preventDefault()
      void offerExternalScheme(host, child, url)
    }
    child.on('will-navigate', guard)
    child.on('will-redirect', guard)
    // A popup may not open further popups; one level is enough.
    child.setWindowOpenHandler((details) => {
      const decision = decidePopup({
        openerUrl: child.getURL(),
        targetUrl: details.url
      })
      if (decision.kind === 'external') {
        handOffExternalAuth(details.url)
        return { action: 'deny' }
      }
      if (decision.kind === 'tab' && !host.isDestroyed()) {
        host.send('browser:open-url', { url: decision.url } as BrowserOpenUrl)
        return { action: 'deny' }
      }
      noteBlocked(host, 'popup', details.url, 'nested')
      return { action: 'deny' }
    })
  })

  guest.once('destroyed', () => popupLimiter.forget(guest.id))

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
