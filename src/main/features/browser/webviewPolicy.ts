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
