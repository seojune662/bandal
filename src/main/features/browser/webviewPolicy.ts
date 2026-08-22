/**
 * [M3-F] Pure webview hardening policy (no electron imports — unit-testable).
 *
 * Recipe source: docs/orca-analysis.md §1 (Orca's hardened-<webview> approach,
 * re-implemented here — no verbatim Orca code):
 *  - fail-closed `will-attach-webview`: partition allowlist + forced
 *    sandbox/contextIsolation/webSecurity + preload removal
 *  - navigation guard shared by `will-navigate` AND `will-redirect`
 *  - a tiered permission policy (./permissionPolicy.ts)
 *  - `setWindowOpenHandler` → deny + forward http(s) URLs to the renderer
 *
 * The wiring against real electron objects lives in ./hardenWebviews.ts.
 */

import { classifyExternalScheme } from './externalScheme'

/** The only session embedded browser guests may attach to. */
export const BROWSING_PARTITION = 'persist:browsing'

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Fail-closed attach check: only guests declaring the browsing partition and
 * an http(s) (or about:blank) src may attach. Anything else — file://,
 * custom schemes, missing/foreign partitions — is denied.
 */
export function isAllowedAttach(params: {
  src?: unknown
  partition?: unknown
}): boolean {
  const src = typeof params.src === 'string' ? params.src : ''
  const partition = typeof params.partition === 'string' ? params.partition : ''
  if (partition !== BROWSING_PARTITION) return false
  return src === 'about:blank' || isHttpUrl(src)
}

/**
 * Guard for `will-navigate` and `will-redirect`: http(s) and about:blank
 * only. http(s)-origin blob: URLs stay allowed (bot-check challenges load
 * resources through them); `file:` and every other scheme is denied.
 */
export function isNavigationAllowed(url: string): boolean {
  if (url === 'about:blank') return true
  if (url.startsWith('blob:https://') || url.startsWith('blob:http://')) {
    return true
  }
  return isHttpUrl(url)
}

/** window.open target worth forwarding to the renderer as a new tab. */
export function popupForwardUrl(url: string): string | null {
  return isHttpUrl(url) ? url : null
}

/**
 * [§6.1 university-sites] Google refuses sign-in from embedded webviews
 * (`disallowed_useragent`, enforced since 2023). Letting the guest reach
 * accounts.google.com only shows the "안전하지 않을 수 있습니다" wall — and our
 * popup-deny routing severs `window.opener`, so popup-based OAuth could never
 * complete anyway. These URLs must be handed off to the system browser.
 */
export function isBlockedEmbeddedAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return (
      parsed.hostname === 'accounts.google.com' ||
      parsed.hostname === 'accounts.youtube.com'
    )
  } catch {
    return false
  }
}

/**
 * [M6-A] Shortcuts that must keep working while a guest page has keyboard
 * focus. Two families qualify:
 *  - tab lifecycle (⌘T/⌘W/⌘9), which is the app's, not the page's
 *  - browser chrome (⌘R/⌘L/zoom), which every browser takes from the page too
 *
 * Everything else is intentionally dead inside a guest: the page owns its own
 * keymap. `alt` always disqualifies; `shift` only combines with ⌘R.
 */
export type PassthroughAction =
  | 'new-tab'
  | 'close-tab'
  | 'activate-last-tab'
  | 'activate-tab-1'
  | 'activate-tab-2'
  | 'activate-tab-3'
  | 'activate-tab-4'
  | 'activate-tab-5'
  | 'activate-tab-6'
  | 'activate-tab-7'
  | 'activate-tab-8'
  | 'browser-back'
  | 'browser-forward'
  | 'reload'
  | 'reload-hard'
  | 'focus-address'
  | 'find'
  | 'bookmark'
  | 'reopen-tab'
  | 'prev-tab'
  | 'next-tab'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

export function passthroughShortcut(input: {
  type: string
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}): PassthroughAction | null {
  if (input.type !== 'keyDown') return null
  if (!(input.meta || input.control) || input.alt) return null
  const key = input.key.toLowerCase()
  if (input.shift) {
    // Shifted chords we take from the page: reload-hard, reopen-tab and tab
    // cycling — all browser conventions. ⌘⇧B (new browser tab) and ⌘⇧M stay
    // with the page.
    if (key === 'r') return 'reload-hard'
    if (key === 't') return 'reopen-tab'
    if (key === '[') return 'prev-tab'
    if (key === ']') return 'next-tab'
    return null
  }
  switch (key) {
    case 't':
      return 'new-tab'
    case 'w':
      return 'close-tab'
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
      // Tab switching is tab lifetime, not page content. Click into a page
      // and press ⌘2 and nothing used to happen.
      return `activate-tab-${key}` as PassthroughAction
    case '9':
      return 'activate-last-tab'
    case '[':
      return 'browser-back'
    case ']':
      return 'browser-forward'
    case 'r':
      return 'reload'
    case 'l':
      return 'focus-address'
    case 'f':
      return 'find'
    case 'd':
      return 'bookmark'
    case '=':
    case '+':
      return 'zoom-in'
    case '-':
      return 'zoom-out'
    case '0':
      return 'zoom-reset'
    default:
      return null
  }
}

/**
 * Registrable site for a Korean academic host.
 *
 * `ac.kr` is a public suffix, so `inha.ac.kr` — not `ac.kr` — is the unit that
 * means "the same university". Everything else falls back to the last two
 * labels, which is right for `example.com` and wrong for nothing we care about.
 */
export function academicSite(url: string): string | null {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    host = parsed.hostname.toLowerCase()
  } catch {
    return null
  }
  const labels = host.split('.')
  if (labels.length < 2) return null
  // `*.ac.kr`, `*.edu`, `*.go.kr` … anything with a two-label public suffix.
  const twoLabelSuffixes = ['ac.kr', 'go.kr', 'or.kr', 're.kr', 'co.kr']
  const lastTwo = labels.slice(-2).join('.')
  if (twoLabelSuffixes.includes(lastTwo)) {
    return labels.length >= 3 ? labels.slice(-3).join('.') : null
  }
  return lastTwo
}

/**
 * Whether a `window.open` may become a REAL popup window rather than a Bandal
 * tab.
 *
 * Forwarding every popup to a tab severs `window.opener`, and an SSO popup
 * that reports back with `window.opener.postMessage` then waits forever —
 * 인하대·아주대·세종대·경희대 portals all use `window.open` for login, ID
 * lookup and menu navigation (docs/university-sites.md §7.2.10).
 *
 * The exception is deliberately narrow: same university, http(s) only. A
 * popup to anywhere else is still denied and forwarded, because the opener
 * relationship is exactly what an attacker would want to keep.
 *
 * Note the port is NOT part of the comparison here on purpose — 인하대's IdP
 * is `:8443` and its portal is `:443`, and they are the same institution.
 */
export function isSameSiteAcademicPopup(
  openerUrl: string,
  targetUrl: string
): boolean {
  const opener = academicSite(openerUrl)
  const target = academicSite(targetUrl)
  if (opener === null || target === null) return false
  if (!isNavigationAllowed(targetUrl)) return false
  if (isBlockedEmbeddedAuthUrl(targetUrl)) return false
  return opener === target
}

/**
 * Force the hardened guest webPreferences in-place. Mutation is deliberate:
 * Electron's `will-attach-webview` contract only honors changes made to the
 * `webPreferences` object it hands us.
 */
export function sanitizeGuestWebPreferences(
  webPreferences: Record<string, unknown>
): void {
  // A guest must never inherit any preload bridge (either key variant).
  delete webPreferences['preload']
  delete webPreferences['preloadURL']
  webPreferences['nodeIntegration'] = false
  webPreferences['nodeIntegrationInSubFrames'] = false
  webPreferences['nodeIntegrationInWorker'] = false
  webPreferences['contextIsolation'] = true
  webPreferences['sandbox'] = true
  webPreferences['webSecurity'] = true
  webPreferences['allowRunningInsecureContent'] = false
  webPreferences['experimentalFeatures'] = false
  webPreferences['enableBlinkFeatures'] = ''
  webPreferences['webviewTag'] = false
  webPreferences['partition'] = BROWSING_PARTITION
  // Chromium's built-in PDF viewer. Electron defaults `plugins` to false,
  // which meant a .pdf link downloaded instead of rendering and every
  // <embed type="application/pdf"> came up blank — while Safari and Chrome
  // both show it. In Electron 43 (Chromium 150) this flag enables PDFium and
  // nothing else: NPAPI went in Chromium 45, PPAPI/Flash in 88. Since Electron
  // 41, PDFs render as out-of-process iframes (OOPIFs), not as separate
  // WebContents. PDFium remains sandboxed, matching Chrome's posture. Nothing
  // here touches preload, node integration, webSecurity or the partition
  // allowlist.
  //
  // It also makes `navigator.pdfViewerEnabled` true and `navigator.plugins`
  // non-empty, which legacy Korean report viewers branch on.
  webPreferences['plugins'] = true
  // Chrome offers "이 페이지에서 추가 대화상자를 만들지 않도록 차단" after a
  // few. We had no escape hatch at all: a `while(true){alert()}` — an ad, or
  // a broken portal script — produced an unbounded chain of window-modal
  // native boxes that froze 필기, 보드 and 채팅 along with the browser.
  webPreferences['safeDialogs'] = true
  webPreferences['safeDialogsMessage'] =
    '이 페이지가 대화상자를 계속 띄우고 있어요. 더 이상 보여주지 않을게요.'
}

/**
 * A popup whose document the OPENER writes, rather than one the network
 * serves.
 *
 * There is no URL to forward to a Bandal tab, so forwarding is structurally
 * impossible — and denying it hands the page `null`, which is what killed
 * 서울대 shine's OZ Report Viewer with "Failed to create the report manager":
 * the next line was `w.document.write(...)` on null.
 *
 *   window.open('', 'printWin').document.write(...)   ← 고지서·증명서 출력
 *   window.open(URL.createObjectURL(pdfBlob))         ← PDF 미리보기
 *
 * A blob: URL is keyed to the CREATING document, so even a same-partition tab
 * would 404 on it. It has to be a real window.
 *
 * Safety rests on origin inheritance: an about:blank child IS the opener's
 * origin, and a blob: child is scoped to it. Neither gains anything the opener
 * did not already have — this is what every browser does.
 */
export function isOpenerScopedPopupTarget(url: string): boolean {
  // Chromium reports `window.open('', …)` as either form depending on how it
  // resolved the empty string.
  if (url === '' || url === 'about:blank') return true
  return url.startsWith('blob:https://') || url.startsWith('blob:http://')
}

export type PopupDecision =
  /** Hand to the system browser; the embedded view is refused by the site. */
  | { kind: 'external' }
  /** A real popup window. */
  | { kind: 'window'; scope: 'opener' | 'sso' }
  /** Open as a Bandal tab; `window.opener` is severed. */
  | { kind: 'tab'; url: string }
  /** A custom scheme worth asking the student about. */
  | { kind: 'scheme' }
  | { kind: 'deny' }

/**
 * What `window.open` should become. Pure, so every branch is testable without
 * an Electron window.
 */
export function decidePopup(input: {
  openerUrl: string
  targetUrl: string
}): PopupDecision {
  const { openerUrl, targetUrl } = input
  if (isBlockedEmbeddedAuthUrl(targetUrl)) return { kind: 'external' }
  if (isOpenerScopedPopupTarget(targetUrl)) return { kind: 'window', scope: 'opener' }
  if (isSameSiteAcademicPopup(openerUrl, targetUrl)) {
    return { kind: 'window', scope: 'sso' }
  }
  const forwardUrl = popupForwardUrl(targetUrl)
  if (forwardUrl !== null) return { kind: 'tab', url: forwardUrl }
  // The scheme classifier — not this function — decides what is worth asking
  // about, so a `deny` here really does mean denied and `scheme` really does
  // mean a dialog is coming.
  const verdict = classifyExternalScheme(targetUrl).kind
  return verdict === 'ask' || verdict === 'everyday'
    ? { kind: 'scheme' }
    : { kind: 'deny' }
}

const POPUP_MIN_PX = 320
const POPUP_MAX_WIDTH_PX = 1400
const POPUP_MAX_HEIGHT_PX = 1200
/** An SSO sheet. Narrow on purpose — it is a login form. */
const SSO_SIZE = { width: 520, height: 640 } as const
/** A document the opener writes: a 고지서 at 520x640 is unreadable. */
const OPENER_SIZE = { width: 900, height: 760 } as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function featureNumber(features: string, key: string): number | null {
  const match = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(\\d+)`).exec(features)
  if (match === null) return null
  const value = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(value) ? value : null
}

/**
 * How big a popup should be. The site's own `features` string wins when it is
 * sane, clamped so a page cannot open a 1x1 window (invisible) or one larger
 * than any screen.
 */
export function popupWindowSize(
  scope: 'opener' | 'sso',
  features: string
): { width: number; height: number } {
  const base = scope === 'sso' ? SSO_SIZE : OPENER_SIZE
  const width = featureNumber(features, 'width') ?? base.width
  const height = featureNumber(features, 'height') ?? base.height
  return {
    width: clamp(width, POPUP_MIN_PX, POPUP_MAX_WIDTH_PX),
    height: clamp(height, POPUP_MIN_PX, POPUP_MAX_HEIGHT_PX)
  }
}
