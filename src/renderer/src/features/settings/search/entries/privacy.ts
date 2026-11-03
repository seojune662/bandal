import type { SettingsCatalogEntry } from '../catalogTypes'

export const PRIVACY_ENTRIES = [
  { id: 'privacy.data', category: 'privacy', title: 'settings.privacy.data.title', description: 'settings.privacy.data.groupDescription' },
  { id: 'privacy.data.promise', category: 'privacy', group: 'privacy.data', title: 'settings.privacy.data.promise', description: 'settings.privacy.data.description', keywords: ['telemetry', 'analytics', 'tracking', '수집', '원격 측정', '추적'] },
  { id: 'privacy.diagnostics', category: 'privacy', title: 'settings.privacy.diagnostics.title', description: 'settings.privacy.diagnostics.groupDescription' },
  { id: 'privacy.diagnostics.create', category: 'privacy', group: 'privacy.diagnostics', title: 'settings.privacy.diagnostics.label', description: 'settings.privacy.diagnostics.description', keywords: ['diagnostics', 'logs', 'debug', 'crash', '로그', '오류 보고'] },
  { id: 'privacy.feedback', category: 'privacy', title: 'settings.privacy.feedback.title', description: 'settings.privacy.feedback.groupDescription' },
  { id: 'privacy.feedback.send', category: 'privacy', group: 'privacy.feedback', title: 'settings.privacy.feedback.label', description: 'settings.privacy.feedback.description', keywords: ['feedback', 'bug report', 'feature request', 'contact', '버그', '문의', '건의'] }
] as const satisfies readonly SettingsCatalogEntry[]
