/**
 * [M8 · backlog §6.1] Browsing-partition user agent (pure — unit-testable).
 *
 * Korean university portals sniff the UA and **fail closed**: 연세대 포털 and
 * KAIST 수강신청 both end their `browserCheck.js` with `default: returnVal =
 * false`, and 서강대 SAINT (SAP NetWeaver) answers "iView를 열 수 없습니다".
 * Electron's default UA carries two tokens no real Chrome has —
 *
 *   Mozilla/5.0 (…) AppleWebKit/537.36 (KHTML, like Gecko)
 *     bandal/0.1.0 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36
 *
 * — so we drop exactly those two and keep everything else byte-for-byte:
 *
 *   Mozilla/5.0 (…) AppleWebKit/537.36 (KHTML, like Gecko)
 *     Chrome/134.0.6998.205 Safari/537.36
 *
 * Hard rules (docs/university-sites.md §7.1-2):
 *  - **Never remove the `Chrome/<version>` token** — that is the token every
 *    sniffer looks for. This module fails safe: if stripping would lose it,
 *    the original UA is returned untouched.
 *  - **Never hardcode the version.** It comes from the running Chromium
 *    (`process.versions.chrome`) via the default UA, so an Electron upgrade
 *    carries it automatically.
 *  - This is not a disguise for a security control. It removes two tokens
 *    that make an otherwise-honest Chromium look unclassifiable.
 */

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A UA is only usable if a sniffer can still find its Chrome token. */
export function hasChromeToken(userAgent: string): boolean {
  return /\bChrome\/\d/.test(userAgent)
}

/**
 * Strips `Electron/<ver>` and `<appName>/<ver>` from an Electron default UA.
 * Returns the input unchanged when the result would no longer be
 * recognisable as Chrome (fail-safe), or when nothing needed stripping.
 */
export function browsingUserAgent(
  defaultUserAgent: string,
  appName: string
): string {
  if (typeof defaultUserAgent !== 'string' || defaultUserAgent.length === 0) {
    return defaultUserAgent
  }

  let stripped = defaultUserAgent.replace(/\s*\bElectron\/\S+/gi, '')
  const name = appName.trim()
  if (name.length > 0) {
    stripped = stripped.replace(
      new RegExp(`\\s*\\b${escapeForRegex(name)}\\/\\S+`, 'gi'),
      ''
    )
  }
  stripped = stripped.replace(/\s{2,}/g, ' ').trim()

  if (!hasChromeToken(stripped)) return defaultUserAgent
  return stripped
}
