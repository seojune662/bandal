import { createContext, useContext, type ReactNode } from 'react'

import { useLocale, type Locale } from '../../../i18n'
import { useUiStore } from '../../../stores/uiStore'
import { buildSettingsSearchIndex, type ResolvedSettingsEntry, type SettingsSearchIndex } from '../search/catalog'
import { hasSettingsSearchQuery, matchesSettingsSearch } from '../search/settingsSearch'

interface SettingsSearchState {
  index: SettingsSearchIndex
  /** The active pane's own title/description matched: show all of its rows. */
  paneMatches: boolean
}

const SearchContext = createContext<SettingsSearchState | null>(null)
const GroupMatchContext = createContext(false)

export function SettingsSearchProvider({
  index,
  paneMatches,
  children
}: SettingsSearchState & { children: ReactNode }): JSX.Element {
  return <SearchContext.Provider value={{ index, paneMatches }}>{children}</SearchContext.Provider>
}

export const SettingsGroupMatchProvider = GroupMatchContext.Provider

// Panels rendered outside SettingsApp (unit tests, previews) still need the
// catalog copy for their labels: fall back to a static index per locale.
const fallbackIndexes = new Map<Locale, SettingsSearchIndex>()
function fallbackIndex(locale: Locale): SettingsSearchIndex {
  let index = fallbackIndexes.get(locale)
  if (index === undefined) {
    index = buildSettingsSearchIndex(locale)
    fallbackIndexes.set(locale, index)
  }
  return index
}

/** Catalog entry for `searchId`; throws in dev so a typo cannot ship silently. */
export function useSettingsEntry(searchId: string | undefined): ResolvedSettingsEntry | undefined {
  const state = useContext(SearchContext)
  const locale = useLocale()
  if (searchId === undefined) return undefined
  const entry = (state?.index ?? fallbackIndex(locale)).byId.get(searchId)
  if (entry === undefined && import.meta.env.DEV) {
    throw new Error(`[settings] unknown searchId "${searchId}" — add it to search/entries`)
  }
  return entry
}

/**
 * Whether a row/group should render under the current query.
 * - no query → always
 * - the pane or the enclosing group matched → always
 * - otherwise the row's own entry (and, for a group, any row in it) must match
 * Rows without a catalog entry only show while the query is empty.
 */
export function useSettingsSearchVisibility(
  searchId: string | undefined,
  options: { isGroup?: boolean } = {}
): { visible: boolean; selfMatches: boolean } {
  const query = useUiStore(state => state.settingsSearchQuery)
  const state = useContext(SearchContext)
  const groupMatches = useContext(GroupMatchContext)
  if (!hasSettingsSearchQuery(query) || state === null) return { visible: true, selfMatches: false }
  if (state.paneMatches || groupMatches) return { visible: true, selfMatches: groupMatches }
  const entry = searchId === undefined ? undefined : state.index.byId.get(searchId)
  if (entry === undefined) return { visible: false, selfMatches: false }
  const selfMatches = matchesSettingsSearch(query, entry)
  if (selfMatches || options.isGroup !== true) return { visible: selfMatches, selfMatches }
  const rows = state.index.byCategory.get(entry.category) ?? []
  return { visible: rows.some(row => row.group === searchId && matchesSettingsSearch(query, row)), selfMatches: false }
}

export function useIsSettingsSearching(): boolean {
  return hasSettingsSearchQuery(useUiStore(state => state.settingsSearchQuery))
}
