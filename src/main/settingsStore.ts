/**
 * Minimal working settings store: JSON file in app.getPath('userData').
 * Real implementation (not a stub) — theme must persist in M0.
 *
 * Sanitizers live in settingsSanitize.ts (electron-free, unit-testable);
 * this file owns the electron-bound pieces: paths, cache, persistence and
 * the `settings:changed` broadcast.
 */

import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types/settings'
import type { Settings, SettingsPatch } from '../shared/types/settings'
import { sanitizeSettings } from './settingsSanitize'

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

export function getSettings(): Settings {
  if (cached !== null) {
    return cached
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    cached = sanitizeSettings(raw, defaultsWithPaths())
  } catch {
    // Missing or corrupt file → defaults.
    cached = defaultsWithPaths()
  }
  return cached
}

/** Applies a patch, persists to disk, and broadcasts `settings:changed`. */
export function setSettings(patch: SettingsPatch): Settings {
  const next = sanitizeSettings({ ...getSettings(), ...patch }, defaultsWithPaths())
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
