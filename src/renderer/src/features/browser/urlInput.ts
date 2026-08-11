/**
 * [M3-F] URL-bar input resolution: URL-ish input navigates (https by
 * default), anything else becomes a search-engine query.
 */

import { looksLikeUrl, normalizeUrl } from '../workspace/tabIdentity'

const SEARCH_URL_PREFIX = 'https://www.google.com/search?q='

export interface AddressDisplayParts {
  prefix: string
  domain: string
  suffix: string
  secure: boolean
}

/** Keep the committed URL intact while separating its visual hierarchy. */
export function addressDisplayParts(url: string): AddressDisplayParts {
  try {
    const parsed = new URL(url)
    const host = parsed.host
    const hostStart = url
      .toLocaleLowerCase()
      .indexOf(host.toLocaleLowerCase(), parsed.protocol.length)
    if (host.length === 0 || hostStart < 0) throw new Error('No URL host')
    return {
      prefix: url.slice(0, hostStart),
      domain: url.slice(hostStart, hostStart + host.length),
      suffix: url.slice(hostStart + host.length),
      secure: parsed.protocol === 'https:'
    }
  } catch {
    return { prefix: '', domain: url, suffix: '', secure: false }
  }
}

/** Resolve raw URL-bar input to a loadable URL; null for empty input. */
export function resolveAddressInput(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeUrl(trimmed)) return normalizeUrl(trimmed)
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
}
