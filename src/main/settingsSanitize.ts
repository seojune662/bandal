/**
 * Pure settings sanitizers, split from settingsStore.ts so tests can import
 * them without pulling in the electron runtime (`app`, `BrowserWindow`).
 * settingsStore supplies the environment-dependent defaults.
 */

import { isOrbCharmId } from '../shared/orbCharm'
import { isPaletteId, isThemeId } from '../shared/theme'
import { isSearchEngineId } from '../shared/search'
import { parseChord, SHORTCUT_SPECS } from '../shared/keymap'
import { sanitizeUniversitySettings } from '../shared/universities/sanitize'
import { isZoomLevel } from '../shared/browserZoom'
import { isAgentProvider } from '../shared/types/agent-events'
import {
  DEFAULT_BROWSER_SETTINGS,
  DEFAULT_EXPERIMENTAL,
  DEFAULT_NOTIFICATIONS,
  EXPERIMENTAL_FLAGS,
  isDeadlineLeadDays,
  isLinkRouting,
  isShortcutPriority,
  DEFAULT_DESKTOP_ORB,
  DEFAULT_MILESTONES,
  DEFAULT_ONBOARDING,
  DEFAULT_TUTORIAL,
  isDensity,
  isEditorFont,
  isFontScale
} from '../shared/types/settings'
import type {
  AssistantMode,
  BrowserSettings,
  DeadlineLeadDays,
  DesktopOrbSettings,
  ExperimentalSettings,
  NotificationSettings,
  Milestones,
  OnboardingState,
  Settings,
  TutorialState
} from '../shared/types/settings'

const CUSTOMIZABLE_SHORTCUT_IDS: ReadonlySet<string> = new Set(
  SHORTCUT_SPECS.filter((spec) => spec.customizable).map((spec) => spec.id)
)

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

export function isAssistantMode(value: unknown): value is AssistantMode {
  return value === 'in-app' || value === 'desktop'
}

export function sanitizeDesktopOrb(raw: unknown): DesktopOrbSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_DESKTOP_ORB }
  }
  const record = raw as Record<string, unknown>
  return {
    keepAliveOnClose:
      typeof record.keepAliveOnClose === 'boolean'
        ? record.keepAliveOnClose
        : DEFAULT_DESKTOP_ORB.keepAliveOnClose
  }
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

export function sanitizeKeybindings(
  raw: unknown
): Record<string, string | null> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const sanitized: Record<string, string | null> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!CUSTOMIZABLE_SHORTCUT_IDS.has(id)) continue
    if (value === null) {
      sanitized[id] = null
    } else if (typeof value === 'string' && parseChord(value) !== null) {
      sanitized[id] = value
    }
  }
  return sanitized
}

export function sanitizeMilestones(raw: unknown): Milestones {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_MILESTONES }
  }
  const record = raw as Record<string, unknown>
  return {
    pipUsedAt:
      typeof record.pipUsedAt === 'string' ? record.pipUsedAt : null
  }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Keeps only `<taskId>:<days>` → ISO string entries; anything else is noise. */
function sanitizeSentLedger(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const ledger: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === 'string' &&
      key.length <= 128 &&
      /^[^:]+:(1|3|7)$/.test(key) &&
      !Number.isNaN(Date.parse(value))
    ) {
      ledger[key] = value
    }
  }
  return ledger
}

export function sanitizeNotifications(raw: unknown): NotificationSettings {
  const d = DEFAULT_NOTIFICATIONS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...d, deadlineLeadDays: [...d.deadlineLeadDays], sent: {} }
  }
  const r = raw as Record<string, unknown>
  const leadDays = Array.isArray(r.deadlineLeadDays)
    ? [...new Set(r.deadlineLeadDays.filter(isDeadlineLeadDays))].sort(
        (a, b) => b - a
      )
    : [...d.deadlineLeadDays]
  return {
    enabled: bool(r.enabled, d.enabled),
    deadlines: bool(r.deadlines, d.deadlines),
    deadlineLeadDays: leadDays as DeadlineLeadDays[],
    agentComplete: bool(r.agentComplete, d.agentComplete),
    downloads: bool(r.downloads, d.downloads),
    pluginNotices: bool(r.pluginNotices, d.pluginNotices),
    sound: bool(r.sound, d.sound),
    suppressWhileFocused: bool(r.suppressWhileFocused, d.suppressWhileFocused),
    sent: sanitizeSentLedger(r.sent)
  }
}

/** '' (new-tab page) or an absolute http(s) URL up to 2048 chars. */
export function sanitizeHomePage(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '' || raw.length > 2048) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export function sanitizeBrowserSettings(raw: unknown): BrowserSettings {
  const d = DEFAULT_BROWSER_SETTINGS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...d }
  }
  const r = raw as Record<string, unknown>
  return {
    agentUse: bool(r.agentUse, d.agentUse),
    homePage: sanitizeHomePage(r.homePage),
    defaultZoomLevel: isZoomLevel(r.defaultZoomLevel)
      ? r.defaultZoomLevel
      : d.defaultZoomLevel,
    linkRouting: isLinkRouting(r.linkRouting) ? r.linkRouting : d.linkRouting
  }
}

/** Unknown (graduated) flags are dropped; missing ones take the default. */
export function sanitizeExperimental(raw: unknown): ExperimentalSettings {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const result = { ...DEFAULT_EXPERIMENTAL }
  for (const flag of EXPERIMENTAL_FLAGS) {
    result[flag] = bool(record[flag], DEFAULT_EXPERIMENTAL[flag])
  }
  return result
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
    // Only the registered steps: an arbitrary multiplier from disk (1.05, '1',
    // NaN) would produce a font-size the picker cannot show as selected.
    fontScale: isFontScale(record.fontScale)
      ? record.fontScale
      : defaults.fontScale,
    editorFont: isEditorFont(record.editorFont)
      ? record.editorFont
      : defaults.editorFont,
    density: isDensity(record.density) ? record.density : defaults.density,
    browserSearchEngine: isSearchEngineId(record.browserSearchEngine)
      ? record.browserSearchEngine
      : defaults.browserSearchEngine,
    agentProvider: isAgentProvider(record.agentProvider)
      ? record.agentProvider
      : defaults.agentProvider,
    assistantMode: isAssistantMode(record.assistantMode)
      ? record.assistantMode
      : 'in-app',
    desktopOrb: sanitizeDesktopOrb(record.desktopOrb),
    dataRoot:
      typeof record.dataRoot === 'string' && record.dataRoot.length > 0
        ? record.dataRoot
        : defaults.dataRoot,
    locale: isLocale(record.locale) ? record.locale : defaults.locale,
    onboarding: sanitizeOnboarding(record.onboarding),
    tutorial: sanitizeTutorial(record.tutorial),
    keybindings: sanitizeKeybindings(record.keybindings),
    milestones: sanitizeMilestones(record.milestones),
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
        : null,
    orbCharm: isOrbCharmId(record.orbCharm) ? record.orbCharm : defaults.orbCharm,
    notifications: sanitizeNotifications(record.notifications),
    browser: sanitizeBrowserSettings(record.browser),
    shortcutPriority: isShortcutPriority(record.shortcutPriority)
      ? record.shortcutPriority
      : defaults.shortcutPriority,
    experimental: sanitizeExperimental(record.experimental)
  }
}
