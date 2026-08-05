/**
 * Minimal working settings store: JSON file in app.getPath('userData').
 * Real implementation (not a stub) — theme must persist in M0.
 */

import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types/settings'
import type { Settings, SettingsPatch } from '../shared/types/settings'

const SETTINGS_FILE = 'settings.json'

let cached: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function defaultsWithPaths(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    dataRoot: join(homedir(), 'Documents', 'Bandal')
  }
}

function isTheme(value: unknown): value is Settings['theme'] {
  return value === 'dark' || value === 'light' || value === 'system'
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
        : defaults.locale
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
