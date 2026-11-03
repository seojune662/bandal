/**
 * Settings search ranking. Ported from Orca's components/settings/
 * settings-search.ts (MIT): tiered exact > prefix > substring scores, with the
 * pane title above entry titles above descriptions above keywords, and ties
 * keeping catalog order.
 *
 * Bandal changes: NFC + locale-insensitive lowercase folding (Korean input
 * methods can emit decomposed jamo), and a character cap instead of Orca's
 * clipboard byte helper.
 */

export interface SettingsSearchEntry {
  title: string
  description?: string
  keywords?: readonly string[]
}

export interface RankedSettingsSearchItem<T> {
  item: T
  score: number
}

const QUERY_MAX_CHARS = 512
const NO_MATCH = 0
const EMPTY_QUERY = 1

interface ScoreTier {
  exact: number
  prefix: number
  substring: number
}

const PANE_TITLE: ScoreTier = { exact: 900, prefix: 850, substring: 800 }
const ENTRY_TITLE: ScoreTier = { exact: 700, prefix: 650, substring: 600 }
const DESCRIPTION: ScoreTier = { exact: 500, prefix: 450, substring: 400 }
const KEYWORD: ScoreTier = { exact: 300, prefix: 250, substring: 200 }

function fold(value: string): string {
  // Turkish İ lowercases to i + U+0307; drop the dot so plain-i queries match.
  return value.normalize('NFC').toLowerCase().replaceAll('̇', '')
}

export function normalizeSettingsSearchQuery(query: string): string {
  return fold(query.trim())
}

export function hasSettingsSearchQuery(query: string): boolean {
  return normalizeSettingsSearchQuery(query) !== ''
}

function scoreText(query: string, value: string | undefined, tier: ScoreTier): number {
  if (value === undefined || value === '') return NO_MATCH
  const folded = fold(value)
  if (folded === query) return tier.exact
  if (folded.startsWith(query)) return tier.prefix
  if (folded.includes(query)) return tier.substring
  return NO_MATCH
}

function scoreValues(query: string, values: readonly string[] | undefined, tier: ScoreTier): number {
  let best = NO_MATCH
  for (const value of values ?? []) best = Math.max(best, scoreText(query, value, tier))
  return best
}

/**
 * Score one entry or a pane's entry list. With a list, the first entry is the
 * pane itself (title + description) and ranks above the settings inside it.
 */
export function scoreSettingsSearch(
  query: string,
  entries: SettingsSearchEntry | readonly SettingsSearchEntry[]
): number {
  if (query.length > QUERY_MAX_CHARS) return NO_MATCH
  const normalized = normalizeSettingsSearchQuery(query)
  if (normalized === '') return EMPTY_QUERY

  const isPaneList = Array.isArray(entries)
  const list: readonly SettingsSearchEntry[] = isPaneList ? entries : [entries as SettingsSearchEntry]
  let best = NO_MATCH
  list.forEach((entry, index) => {
    best = Math.max(
      best,
      scoreText(normalized, entry.title, isPaneList && index === 0 ? PANE_TITLE : ENTRY_TITLE),
      scoreText(normalized, entry.description, DESCRIPTION),
      scoreValues(normalized, entry.keywords, KEYWORD)
    )
  })
  return best
}

export function matchesSettingsSearch(
  query: string,
  entries: SettingsSearchEntry | readonly SettingsSearchEntry[]
): boolean {
  return scoreSettingsSearch(query, entries) > NO_MATCH
}

/** Keep matching items, best first; ties keep their original order. */
export function rankSettingsSearchItems<T>(
  query: string,
  items: readonly T[],
  getEntries: (item: T) => SettingsSearchEntry | readonly SettingsSearchEntry[]
): RankedSettingsSearchItem<T>[] {
  if (query.length > QUERY_MAX_CHARS) return []
  if (!hasSettingsSearchQuery(query)) return items.map(item => ({ item, score: EMPTY_QUERY }))
  return items
    .map((item, index) => ({ item, index, score: scoreSettingsSearch(query, getEntries(item)) }))
    .filter(candidate => candidate.score > NO_MATCH)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }))
}
