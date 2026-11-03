import type { SettingsCatalogEntry } from '../catalogTypes'

export const WIDGETS_ENTRIES = [
  { id: 'widgets.dock', category: 'widgets', title: 'settings.widgets.dock.title', description: 'settings.widgets.dock.description', keywords: ['dock', 'sidebar', '사이드바', '위젯 순서'] },
  { id: 'widgets.dock.todo', category: 'widgets', group: 'widgets.dock', title: 'settings.widgets.todo.label', description: 'settings.widgets.todo.description', keywords: ['todo', 'to-do', '할 일'] },
  { id: 'widgets.dock.board', category: 'widgets', group: 'widgets.dock', title: 'settings.widgets.board.label', description: 'settings.widgets.board.description', keywords: ['board', 'kanban', '보드'] },
  { id: 'widgets.dock.mail', category: 'widgets', group: 'widgets.dock', title: 'settings.widgets.mail.label', description: 'settings.widgets.mail.description', keywords: ['mail', 'email', '메일', 'Gmail'] },
  { id: 'widgets.mail', category: 'widgets', title: 'settings.widgets.connection.title', description: 'settings.widgets.connection.description', keywords: ['mail', 'email', 'webmail', '웹메일'] },
  { id: 'widgets.mail.service', category: 'widgets', group: 'widgets.mail', title: 'settings.widgets.mailService.label', description: 'settings.widgets.mailService.description', keywords: ['school mail', '학교 메일'] },
  { id: 'widgets.mail.url', category: 'widgets', group: 'widgets.mail', title: 'settings.widgets.mailUrl.label', description: 'settings.widgets.mailUrl.description', keywords: ['URL', 'address', '주소', 'webmail'] },
  { id: 'widgets.mail.gmail', category: 'widgets', group: 'widgets.mail', title: 'settings.widgets.gmail.label', description: 'settings.widgets.gmail.hint', keywords: ['Gmail', 'Google', 'disconnect', '연결 해제', '로그아웃'] }
] as const satisfies readonly SettingsCatalogEntry[]
