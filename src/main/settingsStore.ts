/**
 * Minimal working settings store: JSON file in app.getPath('userData').
 * Real implementation (not a stub) — theme must persist in M0.
 *
 * Sanitizers live in settingsSanitize.ts (electron-free, unit-testable);
 * this file owns the electron-bound pieces: paths, cache, persistence and
 * the `settings:changed` broadcast.
 */

import { app, BrowserWindow } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types/settings'
import type { Settings, SettingsPatch } from '../shared/types/settings'
import { sanitizeSettings } from './settingsSanitize'
import { quarantineFile, writeFileAtomic } from './lib/atomicWrite'

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

function writeSettingsAtomically(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileAtomic(file, JSON.stringify(settings, null, 2))
}

export function getSettings(): Settings {
  if (cached !== null) {
    return cached
  }
  const file = settingsPath()
  if (!existsSync(file)) {
    cached = defaultsWithPaths()
    return cached
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    cached = sanitizeSettings(raw, defaultsWithPaths())
  } catch {
    const quarantinePath = quarantineFile(file)
    if (quarantinePath !== null) {
      console.warn(`[settings] 설정 파일 읽기 실패 — 격리: ${quarantinePath}`)
    }
    cached = defaultsWithPaths()
  }
  return cached
}

/** Applies a patch, persists to disk, and broadcasts `settings:changed`. */
export function setSettings(patch: SettingsPatch): Settings {
  const previous = getSettings()
  const next = sanitizeSettings({ ...previous, ...patch }, defaultsWithPaths())
  try {
    writeSettingsAtomically(settingsPath(), next)
  } catch (error) {
    cached = previous
    throw error
  }
  cached = next
  broadcastSettings(next)
  return next
}

/** Resets preferences while retaining setup, data-location, and progress state. */
export function resetSettings(
  write: (patch: SettingsPatch) => Settings = setSettings
): Settings {
  const current = getSettings()
  return write({
    ...DEFAULT_SETTINGS,
    dataRoot: current.dataRoot,
    locale: current.locale,
    onboarding: current.onboarding,
    tutorial: current.tutorial,
    university: current.university,
    milestones: current.milestones,
    lastActiveCourseId: current.lastActiveCourseId
  })
}

function broadcastSettings(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:changed', { settings })
    }
  }
}
