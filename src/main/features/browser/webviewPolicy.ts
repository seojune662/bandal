/**
 * [M3-F] Pure webview hardening policy (no electron imports — unit-testable).
 *
 * Recipe source: docs/orca-analysis.md §1 (Orca's hardened-<webview> approach,
 * re-implemented here — no verbatim Orca code):
 *  - fail-closed `will-attach-webview`: partition allowlist + forced
 *    sandbox/contextIsolation/webSecurity + preload removal
 *  - navigation guard shared by `will-navigate` AND `will-redirect`
 *  - deny-by-default permission policy (fullscreen only)
 *  - `setWindowOpenHandler` → deny + forward http(s) URLs to the renderer
 *
 * The wiring against real electron objects lives in ./hardenWebviews.ts.
 */

/** The only session embedded browser guests may attach to. */
export const BROWSING_PARTITION = 'persist:browsing'

/** Deny-by-default permission allowlist for the browsing session. */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen'])

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission)
}

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
    case '9':
      return 'activate-last-tab'
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
}
