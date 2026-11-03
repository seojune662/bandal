import type { SettingsCatalogEntry } from '../catalogTypes'

export const ASSISTANT_ENTRIES = [
  { id: 'assistant.screen', category: 'assistant', title: 'settings.assistant.screen.title', description: 'settings.assistant.screen.description', keywords: ['screen reading', 'screen assistant', '화면 보기'] },
  { id: 'assistant.screen.permission', category: 'assistant', group: 'assistant.screen', title: 'settings.ai.permissions.screen.label', description: 'settings.assistant.screen.permissionDescription', keywords: ['Screen Recording', 'macOS', '화면 녹화', 'permission', '권한'] },
  { id: 'assistant.screen.systemPermissions', category: 'assistant', group: 'assistant.screen', title: 'settings.assistant.permissions.title', description: 'settings.assistant.permissions.description', keywords: ['permissions', 'Accessibility', '손쉬운 사용', '시스템 설정'] }
] as const satisfies readonly SettingsCatalogEntry[]
