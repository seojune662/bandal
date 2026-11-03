import type { SettingsCatalogEntry } from '../catalogTypes'

export const SHORTCUTS_ENTRIES = [
  { id: 'shortcuts.priority', category: 'shortcuts', title: 'settings.shortcuts.priority.title' },
  { id: 'shortcuts.priority.mode', category: 'shortcuts', group: 'shortcuts.priority', title: 'settings.shortcuts.priority.label', description: 'settings.shortcuts.priority.description', keywords: ['webview', 'website', 'site', '사이트 우선', '반달 우선'] },
  { id: 'shortcuts.keys', category: 'shortcuts', title: 'settings.shortcuts.keys.title', description: 'settings.shortcuts.keys.description', keywords: ['keybinding', 'hotkey', 'keyboard', '키 바인딩', '키보드', '충돌', '미할당'] },
  { id: 'shortcuts.transfer', category: 'shortcuts', title: 'settings.shortcuts.transfer.title' },
  { id: 'shortcuts.transfer.json', category: 'shortcuts', group: 'shortcuts.transfer', title: 'settings.shortcuts.transfer.json.label', description: 'settings.shortcuts.transfer.json.description', keywords: ['JSON', 'import', 'export', 'backup', '백업', '복사', '붙여넣기'] }
] as const satisfies readonly SettingsCatalogEntry[]
