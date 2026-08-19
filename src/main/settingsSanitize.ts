/**
 * Pure settings sanitizers, split from settingsStore.ts so tests can import
 * them without pulling in the electron runtime (`app`, `BrowserWindow`).
 * settingsStore supplies the environment-dependent defaults.
 */

import { isPaletteId, isThemeId } from '../shared/theme'
import { sanitizeUniversitySettings } from '../shared/universities/sanitize'
import { DEFAULT_ONBOARDING, DEFAULT_TUTORIAL } from '../shared/types/settings'
import type {
  OnboardingState,
  Settings,
  TutorialState
} from '../shared/types/settings'

/** Any registered theme id, or `system`. Unknown ids fall back to the default
 * (a settings.json written by a newer build must not brick an older one). */
function isTheme(value: unknown): value is Settings['theme'] {
  return value === 'system' || isThemeId(value)
}

/** Any registered palette id. Same fall-back rule as `isTheme`. */
function isPalette(value: unknown): value is Settings['palette'] {
  return isPaletteId(value)
}

/** Only renderer locales shipped by this build are accepted from disk/IPC. */
function isLocale(value: unknown): value is Settings['locale'] {
  return value === 'ko-KR' || value === 'en-US'
}

/** [M6-A] Validates the persisted onboarding record, key by key. */
export function sanitizeOnboarding(raw: unknown): OnboardingState {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_ONBOARDING }
  }
  const record = raw as Record<string, unknown>
  return {
    flowVersion:
      typeof record.flowVersion === 'number' &&
      Number.isInteger(record.flowVersion) &&
      record.flowVersion >= 0
        ? record.flowVersion
        : DEFAULT_ONBOARDING.flowVersion,
    closedAt: typeof record.closedAt === 'string' ? record.closedAt : null,
    lastCompletedStep:
      typeof record.lastCompletedStep === 'number' &&
      Number.isInteger(record.lastCompletedStep) &&
      record.lastCompletedStep >= 0
        ? record.lastCompletedStep
        : DEFAULT_ONBOARDING.lastCompletedStep
  }
}

export function sanitizeTutorial(raw: unknown): TutorialState {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_TUTORIAL }
  }
  const record = raw as Record<string, unknown>
  return {
    seenVersion:
      typeof record.seenVersion === 'number' &&
      Number.isInteger(record.seenVersion) &&
      record.seenVersion >= 0
        ? record.seenVersion
        : DEFAULT_TUTORIAL.seenVersion,
    activeCourseId:
      typeof record.activeCourseId === 'string' && record.activeCourseId !== ''
        ? record.activeCourseId
        : null
  }
}

/**
 * Validates unknown JSON into Settings, falling back to `defaults` per key.
 * `defaults` carries the environment-dependent values (dataRoot).
 */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  if (typeof raw !== 'object' || raw === null) {
    return defaults
  }
  const record = raw as Record<string, unknown>
  return {
    theme: isTheme(record.theme) ? record.theme : defaults.theme,
    palette: isPalette(record.palette) ? record.palette : defaults.palette,
    agentProvider:
      record.agentProvider === 'claude-code' || record.agentProvider === 'codex'
        ? record.agentProvider
        : defaults.agentProvider,
    dataRoot:
      typeof record.dataRoot === 'string' && record.dataRoot.length > 0
        ? record.dataRoot
        : defaults.dataRoot,
    locale: isLocale(record.locale) ? record.locale : defaults.locale,
    onboarding: sanitizeOnboarding(record.onboarding),
    tutorial: sanitizeTutorial(record.tutorial),
    university: sanitizeUniversitySettings(record.university),
    openAdjacentTab:
      typeof record.openAdjacentTab === 'boolean'
        ? record.openAdjacentTab
        : defaults.openAdjacentTab,
    restoreLastCourse:
      typeof record.restoreLastCourse === 'boolean'
        ? record.restoreLastCourse
        : defaults.restoreLastCourse,
    lastActiveCourseId:
      typeof record.lastActiveCourseId === 'string' &&
      record.lastActiveCourseId !== ''
        ? record.lastActiveCourseId
        : null
  }
}
