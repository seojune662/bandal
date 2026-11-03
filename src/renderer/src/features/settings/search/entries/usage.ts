import type { SettingsCatalogEntry } from '../catalogTypes'

export const USAGE_ENTRIES = [
  { id: 'usage.period', category: 'usage', title: 'settings.usage.period.title', description: 'settings.usage.period.description' },
  { id: 'usage.period.window', category: 'usage', group: 'usage.period', title: 'settings.usage.window.label', description: 'settings.usage.window.description', keywords: ['period', 'range', '7일', '30일', '전체'] },
  { id: 'usage.summary', category: 'usage', title: 'settings.usage.summary.title', description: 'settings.usage.summary.description', keywords: ['tokens', 'sessions', 'statistics', '토큰', '통계', '대화'] },
  { id: 'usage.providers', category: 'usage', title: 'settings.usage.providers.title', description: 'settings.usage.providers.description', keywords: ['Claude Code', 'Codex', 'Gemini', 'provider', 'model', '모델'] }
] as const satisfies readonly SettingsCatalogEntry[]
