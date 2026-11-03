import type { SettingsPanelId } from '../../../../../shared/settingsCategories'
import type { MessageKey } from '../../../i18n/messages/ko-KR'

/**
 * One searchable setting (or a group heading). Declared once per category in
 * `entries/<category>.ts`; the row component reads its label, description,
 * search keywords and deep-link id from here (`searchId`), so the search index
 * cannot drift from what the panel shows.
 */
export interface SettingsCatalogEntry {
  /** Stable id: `<category>.<setting>`; also the deep-link `sectionId`. */
  id: string
  category: SettingsPanelId
  /** Group heading entry id this row sits under (omit for group entries). */
  group?: string
  title: MessageKey
  description?: MessageKey
  /** Extra aliases (brand names, abbreviations) in any language. */
  keywords?: readonly string[]
  /** Sub-tab that must be selected for the row to be visible (Tabs panel). */
  subTab?: string
}
