/**
 * Omnibox candidates for what is currently typed.
 *
 * History lives in main (SQLite), so it arrives asynchronously; everything
 * else — open tabs, favorites, school shortcuts — is already in the renderer
 * and shows instantly. The list therefore fills in twice, which is why the
 * local sources are not gated on the fetch.
 */

import { useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'
import { settingsSnapshot } from '../../stores/settingsSnapshot'
import {
  favoriteScopeKey,
  useFavoritesStore
} from '../../stores/favoritesStore'
import type { Favorite } from '../../../../shared/types/favorite'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUniversityStore } from '../../stores/universityStore'
import {
  DEFAULT_SEARCH_ENGINE,
  suggestionsFor,
  type AddressSuggestion,
  type SearchEngineId
} from './urlInput'

/** Stable identity so the zustand selector does not re-render every tick. */
const EMPTY_FAVORITES: readonly Favorite[] = []

/** Typing is faster than SQLite; this keeps the query off every keystroke. */
const HISTORY_DEBOUNCE_MS = 90

export function searchEngine(): SearchEngineId {
  return settingsSnapshot().browserSearchEngine ?? DEFAULT_SEARCH_ENGINE
}

interface HistoryHit {
  url: string
  title: string
  host: string
}

export function useAddressSuggestions(draft: string | null): AddressSuggestion[] {
  const [history, setHistory] = useState<HistoryHit[]>([])
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const favorites = useFavoritesStore(
    (state) => state.byCourse[favoriteScopeKey(courseId)] ?? EMPTY_FAVORITES
  )
  const openTabs = useWorkspaceStore((state) => state.openTabs)
  const services = useUniversityStore((state) => state.services)

  useEffect(() => {
    if (draft === null || draft.trim() === '') {
      setHistory([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void invoke('browser:searchHistory', { query: draft })
        .then((result) => {
          if (!cancelled) setHistory(result.entries)
        })
        .catch(() => {
          // Suggestions are a convenience; a failed lookup just means fewer.
        })
    }, HISTORY_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft])

  if (draft === null) return []

  return suggestionsFor(
    draft,
    {
      history,
      favorites: favorites.flatMap((favorite) =>
        favorite.descriptor.kind === 'browser'
          ? [
              {
                label: favorite.label,
                url: favorite.descriptor.payload.initialUrl
              }
            ]
          : []
      ),
      services: services.map((service) => ({
        label: service.label,
        url: service.url
      })),
      openTabs: Object.values(openTabs).flatMap((descriptor) =>
        descriptor.kind === 'browser'
          ? [
              {
                title: descriptor.payload.initialUrl,
                url: descriptor.payload.initialUrl
              }
            ]
          : []
      )
    },
    searchEngine()
  )
}
