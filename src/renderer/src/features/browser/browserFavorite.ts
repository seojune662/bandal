/**
 * ⌘D. `favoritesRepo` / `favorites:*` / `favoritesStore` were already
 * complete — only a way to reach them from the browser was missing.
 */

import { favoriteScopeKey, useFavoritesStore } from '../../stores/favoritesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { showToast } from '../../app/toast'
import { hostnameForUrl } from './browserStartPageModel'
import type { Favorite } from '../../../../shared/types/favorite'
import type { BrowserNavState } from './browserGuestsStore'

const EMPTY: readonly Favorite[] = []

/** The favorite pointing at `url` in the active course, if there is one. */
export function useBrowserFavorite(url: string): Favorite | null {
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const favorites = useFavoritesStore(
    (state) => state.byCourse[favoriteScopeKey(courseId)] ?? EMPTY
  )
  if (url === '') return null
  return (
    favorites.find(
      (favorite) =>
        favorite.descriptor.kind === 'browser' &&
        favorite.descriptor.payload.initialUrl === url
    ) ?? null
  )
}

export function toggleFavorite(tabId: string, nav: BrowserNavState): void {
  const url = nav.url
  if (url === '') return
  const courseId = useWorkspaceStore.getState().activeCourseId
  const store = useFavoritesStore.getState()
  const existing = (
    store.byCourse[favoriteScopeKey(courseId)] ?? EMPTY
  ).find(
    (favorite) =>
      favorite.descriptor.kind === 'browser' &&
      favorite.descriptor.payload.initialUrl === url
  )

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
      descriptor: { kind: 'browser', payload: { tabId, initialUrl: url } }
    })
    .catch(() => {
      showToast('즐겨찾기에 추가하지 못했어요.', 'danger')
    })
}
