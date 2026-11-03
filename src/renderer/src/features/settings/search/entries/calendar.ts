import type { SettingsCatalogEntry } from '../catalogTypes'

export const CALENDAR_ENTRIES = [
  { id: 'calendar.apple', category: 'calendar', title: 'settings.calendar.apple.title', description: 'settings.calendar.apple.description', keywords: ['Apple Calendar', 'iCloud', 'macOS', 'EventKit', '애플 캘린더'] },
  { id: 'calendar.apple.connection', category: 'calendar', group: 'calendar.apple', title: 'settings.calendar.apple.connection', description: 'settings.calendar.apple.connectDescription', keywords: ['connect', 'disconnect', 'permission', '연결', '연결 해제', '권한'] },
  { id: 'calendar.display', category: 'calendar', title: 'settings.calendar.display.title', description: 'settings.calendar.display.description', keywords: ['calendars', 'subscribed', 'holidays', '구독', '공휴일'] },
  { id: 'calendar.display.refresh', category: 'calendar', group: 'calendar.display', title: 'settings.calendar.display.refresh', description: 'settings.calendar.display.refreshDescription', keywords: ['refresh', 'reload', '새로고침'] },
  { id: 'calendar.export', category: 'calendar', title: 'settings.calendar.export.title', description: 'settings.calendar.export.description', keywords: ['export', 'send', 'sync', '내보내기', '동기화'] },
  { id: 'calendar.export.destination', category: 'calendar', group: 'calendar.export', title: 'settings.calendar.export.destination', description: 'settings.calendar.export.destinationDescription', keywords: ['destination', 'deadline', '마감', '과제'] }
] as const satisfies readonly SettingsCatalogEntry[]
