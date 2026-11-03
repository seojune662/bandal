import { SETTINGS_CATEGORIES, type SettingsPanelId } from '../../../../../shared/settingsCategories'
import type { Locale } from '../../../i18n'
import { translate } from '../../../i18n/translate'
import type { SettingsCatalogEntry } from './catalogTypes'
import type { SettingsSearchEntry } from './settingsSearch'
import { SETTINGS_CATALOG_ENTRIES } from './entries'

export type { SettingsCatalogEntry } from './catalogTypes'

export interface ResolvedSettingsEntry extends SettingsSearchEntry {
  id: string
  category: SettingsPanelId
  group?: string
  subTab?: string
}

const OTHER_LOCALE: Record<Locale, Locale> = { 'ko-KR': 'en-US', 'en-US': 'ko-KR' }

/**
 * Localize an entry. The other locale's title becomes a keyword so a Korean
 * UI still finds "theme" and an English UI still finds "테마" (Orca indexes
 * English fallbacks the same way in settings-search-keywords.ts).
 */
export function resolveSettingsEntry(entry: SettingsCatalogEntry, locale: Locale): ResolvedSettingsEntry {
  const other = OTHER_LOCALE[locale]
  const keywords = [...(entry.keywords ?? []), translate(other, entry.title)]
  if (entry.description !== undefined) keywords.push(translate(other, entry.description))
  return {
    id: entry.id,
    category: entry.category,
    title: translate(locale, entry.title),
    ...(entry.description !== undefined ? { description: translate(locale, entry.description) } : {}),
    keywords,
    ...(entry.group !== undefined ? { group: entry.group } : {}),
    ...(entry.subTab !== undefined ? { subTab: entry.subTab } : {})
  }
}

export interface SettingsSearchIndex {
  byId: ReadonlyMap<string, ResolvedSettingsEntry>
  byCategory: ReadonlyMap<SettingsPanelId, readonly ResolvedSettingsEntry[]>
  /** Pane entry (category label + description + keywords) for each category. */
  panes: ReadonlyMap<SettingsPanelId, SettingsSearchEntry>
}

export function buildSettingsSearchIndex(
  locale: Locale,
  extraEntries: readonly ResolvedSettingsEntry[] = []
): SettingsSearchIndex {
  const byId = new Map<string, ResolvedSettingsEntry>()
  const byCategory = new Map<SettingsPanelId, ResolvedSettingsEntry[]>()
  const panes = new Map<SettingsPanelId, SettingsSearchEntry>()
  for (const { id } of SETTINGS_CATEGORIES) {
    byCategory.set(id, [])
    const other = OTHER_LOCALE[locale]
    panes.set(id, {
      title: translate(locale, `settings.category.${id}.label`),
      description: translate(locale, `settings.category.${id}.description`),
      keywords: [
        ...translate(locale, `settings.category.${id}.keywords`).split(/[\s,·]+/),
        translate(other, `settings.category.${id}.label`)
      ].filter(Boolean)
    })
  }
  const all = [...SETTINGS_CATALOG_ENTRIES.map(entry => resolveSettingsEntry(entry, locale)), ...extraEntries]
  for (const entry of all) {
    byId.set(entry.id, entry)
    byCategory.get(entry.category)?.push(entry)
  }
  return { byId, byCategory, panes }
}

/** Pane first, then its settings — the list shape the ranker expects. */
export function paneSearchEntries(index: SettingsSearchIndex, category: SettingsPanelId): SettingsSearchEntry[] {
  const pane = index.panes.get(category)
  return [...(pane === undefined ? [] : [pane]), ...(index.byCategory.get(category) ?? [])]
}
