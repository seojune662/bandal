import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types/settings'

const electronMocks = vi.hoisted(() => ({
  userDataPath: '',
  getAllWindows: vi.fn(() => []),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMocks.userDataPath
  },
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows
  }
}))

const temporaryDirectories: string[] = []
const originalDataRoot = process.env['BANDAL_DATA_ROOT']

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  electronMocks.getAllWindows.mockReturnValue([])
  if (originalDataRoot === undefined) {
    delete process.env['BANDAL_DATA_ROOT']
  } else {
    process.env['BANDAL_DATA_ROOT'] = originalDataRoot
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryUserData(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bandal-settings-'))
  temporaryDirectories.push(directory)
  electronMocks.userDataPath = directory
  process.env['BANDAL_DATA_ROOT'] = join(directory, 'course-data')
  return directory
}

async function loadSettingsStore() {
  vi.resetModules()
  return import('../../src/main/settingsStore')
}

describe('settings store recovery', () => {
  test('quarantines malformed JSON and returns defaults without losing the bytes', async () => {
    const userDataPath = temporaryUserData()
    const file = join(userDataPath, 'settings.json')
    const corruptContents = '{"private":"never-log-this"'
    writeFileSync(file, corruptContents, 'utf8')
    const timestamp = '2026-08-22T03:04:05.000Z'
    vi.useFakeTimers()
    vi.setSystemTime(new Date(timestamp))
    writeFileSync(
      `${file}.corrupt-${timestamp}`,
      'previous quarantine',
      'utf8'
    )
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getSettings } = await loadSettingsStore()

    const settings = getSettings()

    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(settings.dataRoot).toBe(join(userDataPath, 'course-data'))
    expect(existsSync(file)).toBe(false)
    const quarantinedName = `settings.json.corrupt-${timestamp}-1`
    expect(readdirSync(userDataPath)).toContain(quarantinedName)
    const quarantinedPath = join(userDataPath, quarantinedName)
    expect(readFileSync(quarantinedPath, 'utf8')).toBe(corruptContents)
    expect(warning).toHaveBeenCalledWith(
      `[settings] 설정 파일 읽기 실패 — 격리: ${quarantinedPath}`
    )
    expect(warning.mock.calls.flat().join(' ')).not.toContain('never-log-this')
  })

  test('throws on an atomic write failure and keeps cache and broadcasts unchanged', async () => {
    const userDataPath = temporaryUserData()
    const file = join(userDataPath, 'settings.json')
    writeFileSync(file, JSON.stringify({ theme: 'system' }), 'utf8')
    const send = electronMocks.send
    electronMocks.getAllWindows.mockReturnValue([{
      isDestroyed: () => false,
      webContents: { send }
    }])
    const { getSettings, setSettings } = await loadSettingsStore()
    const previous = getSettings()

    chmodSync(userDataPath, 0o500)
    try {
      expect(() => setSettings({ theme: 'light' })).toThrow()
      expect(getSettings()).toEqual(previous)
      expect(send).not.toHaveBeenCalled()
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'system' })
      expect(existsSync(`${file}.tmp`)).toBe(false)
    } finally {
      chmodSync(userDataPath, 0o700)
    }
  })

  test('renames an fsynced temporary file before updating cache and broadcasting', async () => {
    const userDataPath = temporaryUserData()
    const file = join(userDataPath, 'settings.json')
    const send = electronMocks.send
    electronMocks.getAllWindows.mockReturnValue([{
      isDestroyed: () => false,
      webContents: { send }
    }])
    const { getSettings, setSettings } = await loadSettingsStore()

    const saved = setSettings({ theme: 'light' })

    expect(saved.theme).toBe('light')
    expect(getSettings()).toEqual(saved)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ theme: 'light' })
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(send).toHaveBeenCalledWith('settings:changed', { settings: saved })
  })

  test('reset preserves setup and progress fields while restoring preferences', async () => {
    temporaryUserData()
    const { getSettings, resetSettings, setSettings } = await loadSettingsStore()
    setSettings({
      theme: 'light',
      locale: 'en-US',
      lastActiveCourseId: 'course-1',
      onboarding: { flowVersion: 2, closedAt: '2026-09-01T00:00:00.000Z', lastCompletedStep: 3 }
    })

    const reset = resetSettings()

    expect(reset.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(reset.locale).toBe('en-US')
    expect(reset.lastActiveCourseId).toBe('course-1')
    expect(reset.onboarding.closedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(getSettings()).toEqual(reset)
  })
})
