import type { SettingsCatalogEntry } from '../catalogTypes'

export const EXPERIMENTAL_ENTRIES = [
  { id: 'experimental.flags', category: 'experimental', title: 'settings.experimental.title', description: 'settings.experimental.description', keywords: ['beta', 'labs', 'experimental', '베타'] },
  { id: 'experimental.flags.extensionRuntime', category: 'experimental', group: 'experimental.flags', title: 'settings.experimental.extensionRuntime.label', description: 'settings.experimental.extensionRuntime.description', keywords: ['extension', 'plugin', 'sandbox', 'runtime', '확장', '플러그인', '샌드박스'] }
] as const satisfies readonly SettingsCatalogEntry[]
