/**
 * ⌘D. `favoritesRepo` / `favorites:*` / `favoritesStore` were already
 * complete — only a way to reach them from the browser was missing.
 */

import { favoriteScopeKey, useFavoritesStore } from '../../stores/favoritesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { showToast } from '../../app/toast'
import { browserFavoriteMatches, hostnameForUrl } from './browserStartPageModel'
import type { Favorite } from '../../../../shared/types/favorite'
import { useBrowserGuests, type BrowserNavState } from './browserGuestsStore'

const EMPTY: readonly Favorite[] = []

/** Course pins take precedence over imported global pins in the same profile. */
export function useBrowserFavorite(url: string, profileId = 'default'): Favorite | null {
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const favorites = useFavoritesStore(
    (state) => state.byCourse[favoriteScopeKey(courseId)] ?? EMPTY
  )
  const global = useFavoritesStore((state) => state.byCourse[favoriteScopeKey(null)] ?? EMPTY)
  if (url === '') return null
  return (
    favorites.find((favorite) => browserFavoriteMatches(favorite, url, profileId)) ??
    global.find((favorite) => browserFavoriteMatches(favorite, url, profileId)) ?? null
  )
}

export function toggleFavorite(tabId: string, nav: BrowserNavState): void {
  const url = nav.url
  if (url === '') return
  const courseId = useWorkspaceStore.getState().activeCourseId
  const profileId = useBrowserGuests.getState().liveGuests.find((guest) => guest.tabId === tabId)?.profileId ?? 'default'
  const store = useFavoritesStore.getState()
  const existing = [...(store.byCourse[favoriteScopeKey(courseId)] ?? EMPTY), ...(courseId === null ? EMPTY : store.byCourse[favoriteScopeKey(null)] ?? EMPTY)]
    .find((favorite) => browserFavoriteMatches(favorite, url, profileId))

  if (existing !== undefined) {
    void store.remove(existing.id).catch(() => {
      showToast('즐겨찾기에서 빼지 못했어요.', 'danger')
    })
    return
  }

  void store
    .add({
      courseId,
      // The page title, or the host when a page has none — never a bare URL.
      label: nav.title.trim() === '' ? hostnameForUrl(url) : nav.title.trim(),
      descriptor: { kind: 'browser', payload: { tabId, initialUrl: url, profileId } }
    })
    .catch(() => {
      showToast('즐겨찾기에 추가하지 못했어요.', 'danger')
    })
}
