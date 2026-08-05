/**
 * App settings persisted by the main process (JSON in userData).
 */

import type { AgentProvider } from './agent-events'
import { DEFAULT_THEME_ID } from '../theme'
import type { ThemeId } from '../theme'

/**
 * A theme id from the registry (src/shared/theme.ts) or `system`, which
 * follows the OS between the two 반달 defaults. Adding a theme widens this
 * union automatically — there is no theme name spelled out here.
 */
export type ThemePreference = ThemeId | 'system'

/**
 * [M6-A] Versioned first-run onboarding state.
 *
 * - `flowVersion` is the wizard revision the user last saw. Bumping
 *   ONBOARDING_FLOW_VERSION re-opens the wizard once for existing users.
 * - `closedAt` is the ISO timestamp of dismissal/completion; `null` means
 *   the wizard should show. It is only ever reset deliberately
 *   (설정 > General > "온보딩 다시 보기") — never automatically.
 * - `lastCompletedStep` counts finished steps (0 = none, 3 = all), so a
 *   re-opened wizard can resume where the user left off.
 */
export interface OnboardingState {
  flowVersion: number
  closedAt: string | null
  lastCompletedStep: number
}

export const ONBOARDING_FLOW_VERSION = 1

export const DEFAULT_ONBOARDING: OnboardingState = {
  flowVersion: ONBOARDING_FLOW_VERSION,
  closedAt: null,
  lastCompletedStep: 0
}

export interface Settings {
  theme: ThemePreference
  /** Preferred AI agent provider. */
  agentProvider: AgentProvider
  /** Root folder for course data. Defaults to ~/Documents/Bandal. */
  dataRoot: string
  /** UI language (BCP 47). */
  locale: string
  /** [M6-A] First-run onboarding progress. */
  onboarding: OnboardingState
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME_ID,
  agentProvider: 'claude-code',
  dataRoot: '',
  locale: 'ko-KR',
  onboarding: DEFAULT_ONBOARDING
}

export type SettingsPatch = Partial<Settings>
