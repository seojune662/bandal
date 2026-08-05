/**
 * [M3-F] URL-bar input resolution: URL-ish input navigates (https by
 * default), anything else becomes a search-engine query.
 */

import { looksLikeUrl, normalizeUrl } from '../workspace/tabIdentity'

const SEARCH_URL_PREFIX = 'https://www.google.com/search?q='

/** Resolve raw URL-bar input to a loadable URL; null for empty input. */
export function resolveAddressInput(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  if (looksLikeUrl(trimmed)) return normalizeUrl(trimmed)
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
}
