/**
 * App settings persisted by the main process (JSON in userData).
 */

import type { AgentProvider } from './agent-events'

export type ThemePreference = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemePreference
  /** Preferred AI agent provider. */
  agentProvider: AgentProvider
  /** Root folder for course data. Defaults to ~/Documents/Bandal. */
  dataRoot: string
  /** UI language (BCP 47). */
  locale: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  agentProvider: 'claude-code',
  dataRoot: '',
  locale: 'ko-KR'
}

export type SettingsPatch = Partial<Settings>
