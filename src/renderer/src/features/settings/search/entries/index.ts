import type { SettingsCatalogEntry } from '../catalogTypes'
import { AI_ENTRIES } from './ai'
import { ASSISTANT_ENTRIES } from './assistant'
import { ACCOUNT_ENTRIES } from './account'
import { SYNC_ENTRIES } from './sync'
import { GENERAL_ENTRIES } from './general'
import { UNIVERSITY_ENTRIES } from './university'
import { COURSES_ENTRIES } from './courses'
import { PACKS_ENTRIES } from './packs'
import { CALENDAR_ENTRIES } from './calendar'
import { BROWSER_ENTRIES } from './browser'
import { APPEARANCE_ENTRIES } from './appearance'
import { TABS_ENTRIES } from './tabs'
import { WIDGETS_ENTRIES } from './widgets'
import { NOTIFICATIONS_ENTRIES } from './notifications'
import { SHORTCUTS_ENTRIES } from './shortcuts'
import { PERMISSIONS_ENTRIES } from './permissions'
import { PRIVACY_ENTRIES } from './privacy'
import { USAGE_ENTRIES } from './usage'
import { ADVANCED_ENTRIES } from './advanced'
import { EXPERIMENTAL_ENTRIES } from './experimental'
import { ABOUT_ENTRIES } from './about'

/** Every category's searchable settings, in sidebar order. */
export const SETTINGS_CATALOG_ENTRIES: readonly SettingsCatalogEntry[] = [
  ...AI_ENTRIES,
  ...ASSISTANT_ENTRIES,
  ...ACCOUNT_ENTRIES,
  ...SYNC_ENTRIES,
  ...GENERAL_ENTRIES,
  ...UNIVERSITY_ENTRIES,
  ...COURSES_ENTRIES,
  ...PACKS_ENTRIES,
  ...CALENDAR_ENTRIES,
  ...BROWSER_ENTRIES,
  ...APPEARANCE_ENTRIES,
  ...TABS_ENTRIES,
  ...WIDGETS_ENTRIES,
  ...NOTIFICATIONS_ENTRIES,
  ...SHORTCUTS_ENTRIES,
  ...PERMISSIONS_ENTRIES,
  ...PRIVACY_ENTRIES,
  ...USAGE_ENTRIES,
  ...ADVANCED_ENTRIES,
  ...EXPERIMENTAL_ENTRIES,
  ...ABOUT_ENTRIES
]
