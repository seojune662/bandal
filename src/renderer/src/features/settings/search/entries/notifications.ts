import type { SettingsCatalogEntry } from '../catalogTypes'

export const NOTIFICATIONS_ENTRIES = [
  { id: 'notifications.alerts', category: 'notifications', title: 'settings.notifications.alerts.title', description: 'settings.notifications.alerts.description', keywords: ['notification', 'alert', '알람'] },
  { id: 'notifications.alerts.enabled', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.enabled.label', description: 'settings.notifications.enabled.description', keywords: ['OS notification', 'system notification', '시스템 알림'] },
  { id: 'notifications.alerts.deadlines', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.deadlines.label', description: 'settings.notifications.deadlines.description', keywords: ['deadline', 'due', 'assignment', '과제'] },
  { id: 'notifications.alerts.leadDays', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.deadlines.leadDaysLabel', description: 'settings.notifications.deadlines.leadDaysDescription', keywords: ['lead time', 'reminder', '1일 전', '3일 전', '7일 전'] },
  { id: 'notifications.alerts.agentComplete', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.agentComplete.label', description: 'settings.notifications.agentComplete.description', keywords: ['AI', 'agent', 'Claude', 'Codex'] },
  { id: 'notifications.alerts.downloads', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.downloads.label', description: 'settings.notifications.downloads.description', keywords: ['download', '다운로드'] },
  { id: 'notifications.alerts.pluginNotices', category: 'notifications', group: 'notifications.alerts', title: 'settings.notifications.pluginNotices.label', description: 'settings.notifications.pluginNotices.description', keywords: ['plugin', '플러그인'] },
  { id: 'notifications.behavior', category: 'notifications', title: 'settings.notifications.behavior.title', description: 'settings.notifications.behavior.description' },
  { id: 'notifications.behavior.sound', category: 'notifications', group: 'notifications.behavior', title: 'settings.notifications.sound.label', description: 'settings.notifications.sound.description', keywords: ['sound', 'mute', '음소거'] },
  { id: 'notifications.behavior.suppressWhileFocused', category: 'notifications', group: 'notifications.behavior', title: 'settings.notifications.suppressWhileFocused.label', description: 'settings.notifications.suppressWhileFocused.description', keywords: ['focus', 'do not disturb', '방해 금지'] },
  { id: 'notifications.behavior.test', category: 'notifications', group: 'notifications.behavior', title: 'settings.notifications.test.label', description: 'settings.notifications.test.description', keywords: ['test', '테스트'] }
] as const satisfies readonly SettingsCatalogEntry[]
