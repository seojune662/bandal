import type { SettingsCatalogEntry } from '../catalogTypes'

export const UNIVERSITY_ENTRIES = [
  { id: 'university.school', category: 'university', title: 'settings.university.mine.title', description: 'settings.university.mine.emptyHelp', keywords: ['university', 'school', 'college', 'campus', '대학교', '캠퍼스'] },
  { id: 'university.school.picker', category: 'university', group: 'university.school', title: 'settings.university.picker.title', description: 'settings.university.catalogHelp', keywords: ['search school', '학교 검색', '직접 추가', 'custom'] },
  { id: 'university.school.clear', category: 'university', group: 'university.school', title: 'settings.university.clearTitle', description: 'settings.university.clearHelp', keywords: ['clear', 'remove school', '해제'] },
  { id: 'university.primary', category: 'university', title: 'settings.university.primary.title', description: 'settings.university.shortcuts.description', keywords: ['shortcuts', 'favorites', 'portal', 'LMS', 'library', '즐겨찾기', '포털', '도서관', '외부 브라우저', 'reorder', '순서'] },
  { id: 'university.secondary', category: 'university', title: 'settings.university.secondary.title', description: 'settings.university.secondary.description', keywords: ['more', '더보기'] },
  { id: 'university.layout', category: 'university', title: 'settings.university.layout.title', description: 'settings.university.layout.description' },
  { id: 'university.layout.hidden', category: 'university', group: 'university.layout', title: 'settings.university.hidden', description: 'settings.university.hiddenHelp', keywords: ['hidden', 'restore', 'unhide', '숨김 해제'] },
  { id: 'university.savedLogins', category: 'university', title: 'settings.browser.logins.title', description: 'settings.browser.logins.description', keywords: ['password', 'login', '비밀번호', '로그인', '자동 로그인', 'autofill'] },
  { id: 'university.layout.reset', category: 'university', group: 'university.layout', title: 'settings.university.resetLayout', description: 'settings.university.resetLayoutHelp', keywords: ['reset', 'default order', '초기화'] }
] as const satisfies readonly SettingsCatalogEntry[]
