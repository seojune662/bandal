import type { SettingsCatalogEntry } from '../catalogTypes'

export const ADVANCED_ENTRIES = [
  { id: 'advanced.dataRoot', category: 'advanced', title: 'settings.general.workspace.title', description: 'settings.general.workspace.description', keywords: ['workspace', 'data folder', 'folder', '폴더', '저장 위치'] },
  { id: 'advanced.dataRoot.location', category: 'advanced', group: 'advanced.dataRoot', title: 'settings.advanced.dataRoot.label', description: 'settings.general.workspace.moveNotice', keywords: ['data root', 'location', 'path', '경로', '위치 변경'] },
  { id: 'advanced.maintenance', category: 'advanced', title: 'settings.advanced.maintenance.title', description: 'settings.advanced.maintenance.description', keywords: ['maintenance', 'troubleshooting', '문제 해결'] },
  { id: 'advanced.maintenance.logs', category: 'advanced', group: 'advanced.maintenance', title: 'settings.advanced.logs.label', description: 'settings.advanced.logs.description', keywords: ['logs', 'log', 'debug', '디버그'] },
  { id: 'advanced.maintenance.cache', category: 'advanced', group: 'advanced.maintenance', title: 'settings.advanced.cache.label', description: 'settings.advanced.cache.description', keywords: ['cache', 'clear', '비우기', '썸네일'] },
  { id: 'advanced.maintenance.reset', category: 'advanced', group: 'advanced.maintenance', title: 'settings.advanced.reset.label', description: 'settings.advanced.reset.description', keywords: ['reset', 'defaults', 'restore', '기본값', '초기화'] }
] as const satisfies readonly SettingsCatalogEntry[]
