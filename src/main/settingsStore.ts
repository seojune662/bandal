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
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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

function quarantineSettings(file: string): string {
  const basePath = `${file}.corrupt-${new Date().toISOString()}`
  let quarantinePath = basePath
  let suffix = 1
  while (existsSync(quarantinePath)) {
    quarantinePath = `${basePath}-${suffix}`
    suffix += 1
  }
  renameSync(file, quarantinePath)
  return quarantinePath
}

function writeSettingsAtomically(file: string, settings: Settings): void {
  const temporaryPath = `${file}.tmp`
  let descriptor: number | undefined
  try {
    mkdirSync(dirname(file), { recursive: true })
    descriptor = openSync(temporaryPath, 'w')
    writeFileSync(descriptor, JSON.stringify(settings, null, 2), 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, file)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // Preserve the original persistence failure.
      }
    }
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Preserve the original persistence failure.
    }
    throw error
  }
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
    const quarantinePath = quarantineSettings(file)
    console.warn(`[settings] 설정 파일 읽기 실패 — 격리: ${quarantinePath}`)
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

function broadcastSettings(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('settings:changed', { settings })
    }
  }
}
