import type { SettingsCatalogEntry } from '../catalogTypes'

export const COURSES_ENTRIES = [
  { id: 'courses.display', category: 'courses', title: 'settings.courses.display.title', description: 'settings.courses.display.description' },
  { id: 'courses.display.showArchived', category: 'courses', group: 'courses.display', title: 'settings.courses.showArchived', description: 'settings.courses.showArchivedHelp', keywords: ['archive', 'archived', 'hidden courses', '아카이브', '보관함'] },
  { id: 'courses.list', category: 'courses', title: 'settings.courses.title', description: 'settings.courses.description', keywords: ['courses', 'classes', 'restore', '복원', '과목 목록'] }
] as const satisfies readonly SettingsCatalogEntry[]
