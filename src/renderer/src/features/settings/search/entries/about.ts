import type { SettingsCatalogEntry } from '../catalogTypes'

export const ABOUT_ENTRIES = [
  { id: 'about.app', category: 'about', title: 'settings.app.name', description: 'settings.about.description', keywords: ['Bandal', 'version', '버전'] },
  { id: 'about.update', category: 'about', title: 'settings.update.title', description: 'settings.update.description', keywords: ['update', 'upgrade', '새 버전', '최신'] },
  { id: 'about.update.check', category: 'about', group: 'about.update', title: 'settings.update.check', description: 'settings.update.automatic', keywords: ['check for updates', 'download', '내려받기', '재시작'] }
] as const satisfies readonly SettingsCatalogEntry[]
