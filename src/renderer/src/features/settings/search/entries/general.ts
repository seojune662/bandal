import type { SettingsCatalogEntry } from '../catalogTypes'

export const GENERAL_ENTRIES = [
  { id: 'general.language', category: 'general', title: 'settings.general.language.title', description: 'settings.general.language.description' },
  { id: 'general.language.app', category: 'general', group: 'general.language', title: 'settings.general.language.label', description: 'settings.general.language.help', keywords: ['locale', 'Korean', 'English', '한국어'] },
  { id: 'general.tabs', category: 'general', title: 'settings.general.tabs.title', description: 'settings.general.tabs.description' },
  { id: 'general.tabs.openBeside', category: 'general', group: 'general.tabs', title: 'settings.general.tabs.openBeside', description: 'settings.general.tabs.openBesideDescription', keywords: ['split', '분할'] },
  { id: 'general.tabs.restore', category: 'general', group: 'general.tabs', title: 'settings.general.tabs.restore', description: 'settings.general.tabs.restoreDescription', keywords: ['session', '세션', '마지막 과목'] },
  { id: 'general.onboarding', category: 'general', title: 'settings.general.onboarding.title', description: 'settings.general.onboarding.description' },
  { id: 'general.onboarding.reopen', category: 'general', group: 'general.onboarding', title: 'settings.general.onboarding.reopen', description: 'settings.general.onboarding.idle', keywords: ['onboarding', '온보딩'] },
  { id: 'general.onboarding.tutorial', category: 'general', group: 'general.onboarding', title: 'settings.general.tutorial.reopen', description: 'settings.general.tutorial.idle', keywords: ['tour', '둘러보기'] }
] as const satisfies readonly SettingsCatalogEntry[]
