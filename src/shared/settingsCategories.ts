/**
 * Settings sidebar category ids. Shared so main (app menu, deep links) and
 * the renderer (SettingsApp) name the same panels. Order here is the sidebar
 * order inside each group; groups are listed in SETTINGS_GROUPS order.
 */
export const SETTINGS_GROUPS = [
  'ai',
  'setup',
  'workflows',
  'interface',
  'privacy',
  'advanced'
] as const
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]

export const SETTINGS_CATEGORIES = [
  { id: 'ai', group: 'ai' },
  { id: 'assistant', group: 'ai' },
  { id: 'account', group: 'setup' },
  { id: 'sync', group: 'setup' },
  { id: 'general', group: 'setup' },
  { id: 'university', group: 'setup' },
  { id: 'courses', group: 'setup' },
  { id: 'packs', group: 'workflows' },
  { id: 'calendar', group: 'workflows' },
  { id: 'browser', group: 'workflows' },
  { id: 'appearance', group: 'interface' },
  { id: 'tabs', group: 'interface' },
  { id: 'widgets', group: 'interface' },
  { id: 'notifications', group: 'interface' },
  { id: 'shortcuts', group: 'interface' },
  { id: 'permissions', group: 'privacy' },
  { id: 'privacy', group: 'privacy' },
  { id: 'usage', group: 'privacy' },
  { id: 'advanced', group: 'advanced' },
  { id: 'experimental', group: 'advanced' },
  { id: 'about', group: 'advanced' }
] as const satisfies readonly { id: string; group: SettingsGroupId }[]

export type SettingsPanelId = (typeof SETTINGS_CATEGORIES)[number]['id']

/**
 * The sidebar, as the iPad app has it: a short list of sections, each showing
 * its panels one under another. Panels keep their ids, so search rows, deep
 * links (`openSettings('tabs')`) and the app menu still name a panel; the
 * section that holds it opens and scrolls to it. Order is the sidebar order.
 */
export const SETTINGS_SECTIONS = [
  { id: 'general', panels: ['general', 'notifications', 'shortcuts', 'advanced', 'experimental'] },
  { id: 'appearance', panels: ['appearance', 'tabs', 'widgets'] },
  { id: 'account', panels: ['account', 'university', 'courses'] },
  { id: 'ai', panels: ['ai', 'assistant', 'usage'] },
  { id: 'sync', panels: ['sync'] },
  { id: 'integrations', panels: ['calendar', 'browser'] },
  { id: 'packs', panels: ['packs'] },
  { id: 'privacy', panels: ['permissions', 'privacy'] },
  { id: 'about', panels: ['about'] }
] as const satisfies readonly { id: string; panels: readonly SettingsPanelId[] }[]

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** The section that shows `panel`. */
export function settingsSectionOf(panel: SettingsPanelId): SettingsSectionId {
  return SETTINGS_SECTIONS.find(section => (section.panels as readonly SettingsPanelId[]).includes(panel))?.id ?? 'general'
}

/** A section's panels, in the order they show. */
export function settingsSectionPanels(section: SettingsSectionId): readonly SettingsPanelId[] {
  return SETTINGS_SECTIONS.find(item => item.id === section)?.panels ?? []
}
/** Accept the former Connections destination for older IPC callers. */
export type SettingsCategoryId = SettingsPanelId | 'mcp'

export function isSettingsCategoryId(value: unknown): value is SettingsCategoryId {
  return value === 'mcp' || SETTINGS_CATEGORIES.some((category) => category.id === value)
}

export function normalizeSettingsCategoryId(value: SettingsCategoryId): SettingsPanelId {
  return value === 'mcp' ? 'packs' : value
}

/**
 * Deep link into settings (Orca's SettingsNavigationTarget, trimmed): open a
 * category, optionally a sub-tab inside it, and scroll to + highlight the row
 * whose `data-settings-target` equals `sectionId`.
 */
export interface SettingsNavigationTarget {
  category: SettingsCategoryId
  subTab?: string
  sectionId?: string
}

export function isSettingsNavigationTarget(value: unknown): value is SettingsNavigationTarget {
  if (typeof value !== 'object' || value === null) return false
  const target = value as Record<string, unknown>
  return (
    isSettingsCategoryId(target['category']) &&
    (target['subTab'] === undefined || typeof target['subTab'] === 'string') &&
    (target['sectionId'] === undefined || typeof target['sectionId'] === 'string')
  )
}

/** Accept the legacy bare category id as well as a full target. */
export function toSettingsNavigationTarget(
  value: SettingsCategoryId | SettingsNavigationTarget
): SettingsNavigationTarget {
  return typeof value === 'string' ? { category: value } : value
}
