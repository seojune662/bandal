/**
 * Minimal working settings store: JSON file in app.getPath('userData').
 * Real implementation (not a stub) — theme must persist in M0.
 */

import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isThemeId } from '../shared/theme'
import { DEFAULT_ONBOARDING, DEFAULT_SETTINGS } from '../shared/types/settings'
import type {
  OnboardingState,
  Settings,
  SettingsPatch
} from '../shared/types/settings'

const SETTINGS_FILE = 'settings.json'

let cached: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function defaultsWithPaths(): Settings {
  // [M6-B testability] BANDAL_DATA_ROOT overrides the default course-data
  // location (~/Documents/Bandal) so E2E runs write into a temp directory.
  const envDataRoot = process.env['BANDAL_DATA_ROOT']
  return {
    ...DEFAULT_SETTINGS,
    dataRoot:
      envDataRoot !== undefined && envDataRoot !== ''
        ? envDataRoot
        : join(homedir(), 'Documents', 'Bandal')
  }
}

/** Any registered theme id, or `system`. Unknown ids fall back to the default
 * (a settings.json written by a newer build must not brick an older one). */
function isTheme(value: unknown): value is Settings['theme'] {
  return value === 'system' || isThemeId(value)
}

/** [M6-A] Validates the persisted onboarding record, key by key. */
function sanitizeOnboarding(raw: unknown): OnboardingState {
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

/** Validates unknown JSON into Settings, falling back to defaults per key. */
function sanitize(raw: unknown): Settings {
  const defaults = defaultsWithPaths()
  if (typeof raw !== 'object' || raw === null) {
    return defaults
  }
  const record = raw as Record<string, unknown>
  return {
    theme: isTheme(record.theme) ? record.theme : defaults.theme,
    agentProvider:
      record.agentProvider === 'claude-code' || record.agentProvider === 'codex'
        ? record.agentProvider
        : defaults.agentProvider,
    dataRoot:
      typeof record.dataRoot === 'string' && record.dataRoot.length > 0
        ? record.dataRoot
        : defaults.dataRoot,
    locale:
      typeof record.locale === 'string' && record.locale.length > 0
        ? record.locale
        : defaults.locale,
    onboarding: sanitizeOnboarding(record.onboarding)
  }
}

export function getSettings(): Settings {
  if (cached !== null) {
    return cached
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    cached = sanitize(raw)
  } catch {
    // Missing or corrupt file → defaults.
    cached = defaultsWithPaths()
  }
  return cached
}

/** Applies a patch, persists to disk, and broadcasts `settings:changed`. */
export function setSettings(patch: SettingsPatch): Settings {
  const next = sanitize({ ...getSettings(), ...patch })
  cached = next
  try {
    const file = settingsPath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    console.error('[settings] failed to persist settings:', error)
  }
  broadcastSettings(next)
  return next
}

function broadcastSettings(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:changed', { settings })
    }
  }
}
