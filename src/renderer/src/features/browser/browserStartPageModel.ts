import type { Favorite } from '../../../../shared/types/favorite'

/** Existing new-tab commands use this URL as their legacy blank-page marker. */
import { NEW_TAB_URL } from '../../../../shared/tabs'

/** Kept as an alias so existing browser code reads the same. */
export const LEGACY_NEW_TAB_URL = NEW_TAB_URL

export interface BrowserShortcut {
  id: string
  label: string
  url: string
}

export function opensOnStartPage(_initialUrl: string): boolean {
  return false
}

export function hostnameForUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

export function initialForUrl(url: string): string {
  const hostname = hostnameForUrl(url)
  return Array.from(hostname)[0]?.toLocaleUpperCase() ?? '?'
}

export function toneForUrl(url: string): string {
  const hostname = hostnameForUrl(url)
  let hash = 0
  for (const character of hostname) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return String(hash % 6)
}

export function browserFavoriteShortcuts(
  favorites: readonly Favorite[] | undefined
): BrowserShortcut[] {
  if (favorites === undefined) return []
  return favorites.flatMap((favorite) =>
    favorite.descriptor.kind === 'browser'
      ? [
          {
            id: favorite.id,
            label: favorite.label,
            url: favorite.descriptor.payload.initialUrl
          }
        ]
      : []
  )
}
