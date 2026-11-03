import type { SettingsCatalogEntry } from '../catalogTypes'

export const PERMISSIONS_ENTRIES = [
  { id: 'permissions.system', category: 'permissions', title: 'settings.permissions.system.title', description: 'settings.permissions.inheritance', keywords: ['macOS', 'privacy & security', 'TCC', '개인정보 보호 및 보안'] },
  { id: 'permissions.system.screen', category: 'permissions', group: 'permissions.system', title: 'settings.permissions.screen.label', description: 'settings.permissions.screen.description', keywords: ['Screen Recording', 'screen capture', '화면 녹화', '스크린샷'] },
  { id: 'permissions.system.accessibility', category: 'permissions', group: 'permissions.system', title: 'settings.permissions.accessibility.label', description: 'settings.permissions.accessibility.description', keywords: ['Accessibility', 'click', 'typing', '클릭', '입력'] },
  { id: 'permissions.system.notifications', category: 'permissions', group: 'permissions.system', title: 'settings.permissions.notifications.label', description: 'settings.permissions.notifications.description', keywords: ['Notifications', 'alerts', '알림 권한'] },
  { id: 'permissions.system.documents', category: 'permissions', group: 'permissions.system', title: 'settings.permissions.documents.label', description: 'settings.permissions.documents.description', keywords: ['Documents', 'Files and Folders', 'file access', '파일', '폴더 접근'] }
] as const satisfies readonly SettingsCatalogEntry[]
