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
  passthroughShortcut,
  popupWindowSize,
  sanitizeGuestWebPreferences
} from './webviewPolicy'
import { installDisplayMediaHandler } from './displayMedia'
import { askForCredentials, resolveAuthPrompt } from './httpAuth'
import { permissionLabel, permissionTier } from './permissionPolicy'
import type { PermissionsRepo } from './permissionsRepo'
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
/**
 * Remembered site decisions. Injected once at startup so this module keeps
 * knowing nothing about SQLite.
 */
let sitePermissions: PermissionsRepo | null = null

export function useSitePermissions(repo: PermissionsRepo): void {
  sitePermissions = repo
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Asks the student whether a site may do something.
 *
 * A native dialog for the same reason the external-scheme one is: a page can
 * draw a convincing copy of any in-app surface inside its own rect, and this
 * question is exactly the one worth spoofing. The answer is remembered per
 * origin and listed in 설정 → 브라우저.
 */
async function askSitePermission(
  origin: string,
  permission: string
): Promise<boolean> {
  const owner = BrowserWindow.getFocusedWindow()
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    noLink: true,
    buttons: ['차단', '허용'],
    defaultId: 0,
    cancelId: 0,
    message: `${origin} 이(가) ${permissionLabel(permission)}을(를) 요청합니다.`,
    detail: '이 선택은 이 사이트에 대해 기억됩니다. 설정 → 브라우저에서 언제든 되돌릴 수 있습니다.'
  }
  const { response } =
    owner === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(owner, options)
  const granted = response === 1
  sitePermissions?.remember(origin, permission, granted ? 'granted' : 'denied')
  return granted
}

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
    (webContents, permission, callback, details) => {
      const tier = permissionTier(permission)
      if (tier !== 'ask') {
        callback(tier === 'grant')
        return
      }
      const origin = originOf(
        details.requestingUrl !== '' && details.requestingUrl !== undefined
          ? details.requestingUrl
          : (webContents?.getURL() ?? '')
      )
      if (origin === null) {
        callback(false)
        return
      }
      const remembered = sitePermissions?.decisionFor(origin, permission) ?? null
      if (remembered !== null) {
        callback(remembered === 'granted')
        return
      }
      void askSitePermission(origin, permission).then(callback)
    }
  )
  // SYNCHRONOUS — it cannot prompt. It answers from what the student already
  // decided and refuses the rest; the async request handler above is the only
  // place a question can be asked.
  browsingSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      const tier = permissionTier(permission)
      if (tier === 'grant') return true
      if (tier === 'deny') return false
      const origin = originOf(requestingOrigin)
      if (origin === null) return false
      return sitePermissions?.decisionFor(origin, permission) === 'granted'
    }
  )
  // Physical devices are refused outright, so a page cannot even enumerate
  // them — the permission tiers alone would still let `requestDevice` show a
  // chooser that then denies.
  browsingSession.setDevicePermissionHandler(() => false)
  // Granting display-capture is necessary but NOT sufficient: without this,
  // getDisplayMedia() still rejects and the prompt the student just answered
  // means nothing.
  installDisplayMediaHandler()
  // Filtered: an unfiltered handler routes EVERY subresource of every page
  // through a main-process callback, and a 학사 포털 issues 300+ per load.
  browsingSession.webRequest.onBeforeRequest(
    { urls: ['file://*/*'] },
    (details, callback) => {
      callback({ cancel: details.url.startsWith('file:') })
    }
  )
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
export function popupWebPreferences(): Electron.WebPreferences {
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
    // mailto:/tel: get a quiet one-liner. Putting a 교수님 이메일 링크 behind
    // the same red-toned "모르는 프로그램이라면 취소하십시오" box as an
    // unknown installer is how a student learns to ignore that box.
    const everyday = verdict.kind === 'everyday'
    const options: Electron.MessageBoxOptions = everyday
      ? {
          type: 'question',
          noLink: true,
          buttons: ['취소', '열기'],
          defaultId: 1,
          cancelId: 0,
          message: `${externalSchemeDisplay(url)} 을(를) 여시겠습니까?`,
          detail: `${origin} 에서 요청했습니다.`
        }
      : {
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

function certificateLabel(certificate: Electron.Certificate): string {
  const name = certificate.subjectName !== '' ? certificate.subjectName : certificate.subject?.commonName
  const issuer = certificate.issuerName !== '' ? certificate.issuerName : certificate.issuer?.commonName
  return `${name ?? '이름 없음'} · 발급 ${issuer ?? '알 수 없음'}`
}

async function confirmCertificate(
  host: WebContents,
  url: string,
  certificate: Electron.Certificate | undefined
): Promise<boolean> {
  if (certificate === undefined) return false
  const owner = BrowserWindow.fromWebContents(host)
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    noLink: true,
    buttons: ['취소', '보내기'],
    defaultId: 0,
    cancelId: 0,
    message: `${requestingOriginOf(url)} 이(가) 인증서를 요구합니다.`,
    detail: `${certificateLabel(certificate)}\n\n보내면 이 인증서로 신원이 확인됩니다.`
  }
  const { response } =
    owner === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(owner, options)
  return response === 1
}

async function chooseCertificate(
  host: WebContents,
  url: string,
  list: Electron.Certificate[]
): Promise<Electron.Certificate | null> {
  const owner = BrowserWindow.fromWebContents(host)
  // Cancel first, so the default is never "assert an identity".
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    noLink: true,
    buttons: ['취소', ...list.map(certificateLabel)],
    defaultId: 0,
    cancelId: 0,
    message: `${requestingOriginOf(url)} 이(가) 인증서를 요구합니다.`,
    detail: '어떤 인증서를 보낼지 고르십시오.'
  }
  const { response } =
    owner === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(owner, options)
  if (response === 0) return null
  return list[response - 1] ?? null
}

const navigationHosts = new WeakMap<WebContents, WebContents>()
const backgroundTabOpens = new WeakSet<WebContents>()

function navigationHost(webContents: WebContents): WebContents {
  const registered = navigationHosts.get(webContents)
  if (registered !== undefined) return registered
  return BrowserWindow.fromWebContents(webContents)?.webContents ?? webContents
}

function handOffExternalAuth(webContents: WebContents, url: string): void {
  void shell.openExternal(url)
  const host = navigationHost(webContents)
  if (!host.isDestroyed()) {
    const payload: BrowserOpenUrl = { url }
    host.send('browser:external-auth', payload)
  }
}

/**
 * Navigation, popup and browser-native prompt policies shared by webviews and
 * standalone site windows. Keeping this independent from a webview host lets
 * the mini player use the exact same main-frame and window.open guards.
 */
export function attachNavigationPolicies(
  webContents: WebContents,
  opts: { openInTab: (url: string) => void }
): void {
  // Google-blocked login origins never load in a guest — hand them to the
  // system browser and tell the renderer so the tab can explain why.
  const navigationGuard = (event: ElectronEvent, url: string): void => {
    if (isBlockedEmbeddedAuthUrl(url)) {
      event.preventDefault()
      handOffExternalAuth(webContents, url)
      return
    }
    if (isNavigationAllowed(url)) return
    event.preventDefault()
    // `will-navigate` is main-frame only, so a subframe or ad cannot reach
    // this — the dialog is only ever offered for a top-level attempt.
    void offerExternalScheme(navigationHost(webContents), webContents, url)
  }
  webContents.on('will-navigate', navigationGuard)
  webContents.on('will-redirect', navigationGuard)

  webContents.setWindowOpenHandler((details) => {
    const decision = decidePopup({
      openerUrl: webContents.getURL(),
      targetUrl: details.url
    })

    if (decision.kind === 'external') {
      handOffExternalAuth(webContents, details.url)
      return { action: 'deny' }
    }

    if (decision.kind === 'window') {
      const admission = popupLimiter.admit(webContents.id)
      if (!admission.ok) {
        const host = navigationHost(webContents)
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
      const background = details.disposition === 'background-tab'
      if (background) backgroundTabOpens.add(webContents)
      try {
        opts.openInTab(decision.url)
      } finally {
        if (background) backgroundTabOpens.delete(webContents)
      }
      return { action: 'deny' }
    }

    if (decision.kind === 'scheme') {
      void offerExternalScheme(
        navigationHost(webContents),
        webContents,
        details.url
      )
      return { action: 'deny' }
    }

    noteBlocked(navigationHost(webContents), 'popup', details.url, 'not-allowed')
    return { action: 'deny' }
  })

  /**
   * Client certificates (mTLS).
   *
   * Electron's default when this event is UNHANDLED is to silently use the
   * FIRST certificate in the list. So a 정부/공공 mTLS endpoint got whichever
   * one the keychain happened to enumerate first — a stale dev cert, an
   * expired one, someone else's — and then failed with an opaque server error
   * or, worse, authenticated as the wrong identity. On macOS the keychain
   * unlock prompt is attributed to "bandal", not to the site, so the student
   * has no idea what consented to what.
   *
   * Note this is the narrow mTLS case. 공동인증서(구 공인인증서) files under
   * ~/NPKI are not TLS client certs and never reach here — those are driven by
   * a native helper over a custom scheme (externalScheme.ts).
   */
  webContents.on('select-client-certificate', (event, url, list, callback) => {
    event.preventDefault()
    if (list.length === 0) return
    if (list.length === 1) {
      // Still worth confirming: this is an identity being asserted.
      void confirmCertificate(navigationHost(webContents), url, list[0]).then((ok) => {
        if (ok && list[0] !== undefined) callback(list[0])
      })
      return
    }
    void chooseCertificate(navigationHost(webContents), url, list).then((chosen) => {
      if (chosen !== null) callback(chosen)
    })
  })

  // HTTP Basic / Digest / NTLM / Negotiate. With NO listener Electron
  // CANCELS the request — which is why 도서관 프록시 and older 학사 시스템
  // rendered a blank rect with no prompt and no way in.
  webContents.on('login', (event, _details, authInfo, callback) => {
    event.preventDefault()
    void resolveAuthPrompt(
      {
        isProxy: authInfo.isProxy,
        host: authInfo.host,
        port: authInfo.port,
        realm: authInfo.realm,
        scheme: authInfo.scheme
      },
      { ask: askForCredentials }
    ).then((result) => {
      if (result === null) callback()
      else callback(result.username, result.password)
    })
  })

  webContents.once('destroyed', () => {
    popupLimiter.forget(webContents.id)
    navigationHosts.delete(webContents)
  })

  /**
   * `beforeunload`.
   *
   * Electron's contract is inverted from the obvious reading: with NO
   * listener the unload is CANCELLED and no dialog is shown, so a 수강신청 or
   * 성적입력 page that sets `onbeforeunload` made every link and every ⌘R do
   * nothing at all. The page looked frozen and nothing was logged.
   */
  webContents.on('will-prevent-unload', (event) => {
    const host = navigationHost(webContents)
    const owner = BrowserWindow.fromWebContents(host)
    const options: Electron.MessageBoxSyncOptions = {
      type: 'question',
      noLink: true,
      buttons: ['머무르기', '나가기'],
      defaultId: 0,
      cancelId: 0,
      message: '이 페이지에서 나가시겠습니까?',
      detail: '작성 중인 내용이 저장되지 않을 수 있습니다.'
    }
    const choice =
      owner === null
        ? dialog.showMessageBoxSync(options)
        : dialog.showMessageBoxSync(owner, options)
    // preventDefault here means "let the navigation proceed" — it cancels the
    // page's cancellation.
    if (choice === 1) event.preventDefault()
  })
}

/**
 * Policies that only make sense for an embedded webview: replay app/browser
 * shortcuts in its host and harden real popup children created by that guest.
 */
export function attachGuestInput(host: WebContents, guest: WebContents): void {
  navigationHosts.set(guest, host)

  // A popup we allowed is still a window that can navigate. Without this the
  // popup exception would be a hole: the child could walk to file:// or a
  // custom scheme, which is exactly what `will-navigate` exists to stop.
  guest.on('did-create-window', (window) => {
    const child = window.webContents
    window.once('closed', () => popupLimiter.release(guest.id))
    const guard = (event: { preventDefault: () => void }, url: string): void => {
      if (isBlockedEmbeddedAuthUrl(url)) {
        event.preventDefault()
        handOffExternalAuth(guest, url)
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
        handOffExternalAuth(guest, details.url)
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
    const openInTab = (url: string): void => {
      if (host.isDestroyed()) return
      const payload: BrowserOpenUrl = {
        url,
        background: backgroundTabOpens.has(guest)
      }
      host.send('browser:open-url', payload)
    }
    attachNavigationPolicies(guest, { openInTab })
    attachGuestInput(host, guest)
  })
}
