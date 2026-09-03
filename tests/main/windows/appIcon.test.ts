import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import {
  PALETTES,
  THEMES,
  type PaletteId,
  type ThemeId
} from '../../../src/shared/theme'
import {
  DEFAULT_SETTINGS,
  type Settings
} from '../../../src/shared/types/settings'

const electronMocks = vi.hoisted(() => ({
  nativeImage: {
    createFromPath: vi.fn((path: string) => ({ path }))
  }
}))

vi.mock('electron', () => ({ nativeImage: electronMocks.nativeImage }))

import {
  createAppIconApplier,
  resolveIconDir,
  resolveIconVariant
} from '../../../src/main/windows/appIcon'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bandal-app-icon-'))
  temporaryRoots.push(root)
  return root
}

async function createAssets(
  resourcesPath: string,
  variant: string,
  filenames: string[]
): Promise<string> {
  const dir = join(resourcesPath, 'icons', variant)
  await mkdir(dir, { recursive: true })
  await Promise.all(filenames.map((name) => writeFile(join(dir, name), 'icon')))
  return dir
}

function settings(theme: Settings['theme'], palette: PaletteId): Settings {
  return { ...DEFAULT_SETTINGS, theme, palette }
}

afterEach(async () => {
  vi.restoreAllMocks()
  electronMocks.nativeImage.createFromPath.mockClear()
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('resolveIconVariant', () => {
  test('resolves every palette, theme preference, and system appearance', () => {
    const themes: Settings['theme'][] = [...THEMES.map(({ id }) => id), 'system']
    let combinations = 0

    for (const palette of PALETTES.map(({ id }) => id)) {
      for (const theme of themes) {
        for (const prefersDark of [false, true]) {
          const resolvedTheme =
            theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
          const expectedBase = ['dark', 'midnight', 'graphite'].includes(
            resolvedTheme
          )
            ? 'dark'
            : 'light'

          expect(resolveIconVariant(settings(theme, palette), prefersDark)).toBe(
            `${palette}-${expectedBase}`
          )
          combinations += 1
        }
      }
    }

    expect(combinations).toBe(6 * 7 * 2)
  })

  test.each<[ThemeId, 'dark' | 'light']>([
    ['dark', 'dark'],
    ['midnight', 'dark'],
    ['graphite', 'dark'],
    ['light', 'light'],
    ['sepia', 'light'],
    ['high-contrast', 'light']
  ])('%s uses the %s icon base', (theme, base) => {
    expect(resolveIconVariant(settings(theme, 'bandal'), false)).toBe(
      `bandal-${base}`
    )
  })
})

describe('resolveIconDir', () => {
  test('uses process resources when packaged', () => {
    expect(
      resolveIconDir('lavender-dark', {
        isPackaged: true,
        resourcesPath: '/Applications/Bandal.app/Contents/Resources',
        bundleDir: '/repo/out/main'
      })
    ).toBe('/Applications/Bandal.app/Contents/Resources/icons/lavender-dark')
  })

  test('uses the repository resources directory in development', () => {
    expect(
      resolveIconDir('moss-light', {
        isPackaged: false,
        resourcesPath: '/unused',
        bundleDir: '/repo/out/main'
      })
    ).toBe('/repo/resources/icons/moss-light')
  })
})

describe('createAppIconApplier', () => {
  test('updates every Windows window and tray only once per variant', async () => {
    const root = await temporaryRoot()
    const dir = await createAssets(root, 'ink-dark', [
      'icon-256.png',
      'tray.ico'
    ])
    const firstWindow = { setIcon: vi.fn() }
    const secondWindow = { setIcon: vi.fn() }
    const windows = vi.fn(() => [firstWindow, secondWindow] as unknown as BrowserWindow[])
    const tray = { setIconVariant: vi.fn() }
    const dock = { setIcon: vi.fn() }
    const finder = { apply: vi.fn(async () => undefined) }
    const applier = createAppIconApplier({
      getSettings: () => settings('graphite', 'ink'),
      prefersDark: () => false,
      platform: 'win32',
      isPackaged: true,
      resourcesPath: root,
      bundleDir: '/unused',
      dock,
      windows,
      tray,
      finder
    })

    await applier.apply()
    await applier.apply()

    expect(applier.current()).toBe('ink-dark')
    expect(firstWindow.setIcon).toHaveBeenCalledOnce()
    expect(firstWindow.setIcon).toHaveBeenCalledWith(join(dir, 'icon-256.png'))
    expect(secondWindow.setIcon).toHaveBeenCalledWith(join(dir, 'icon-256.png'))
    expect(windows).toHaveBeenCalledOnce()
    expect(tray.setIconVariant).toHaveBeenCalledOnce()
    expect(tray.setIconVariant).toHaveBeenCalledWith(dir)
    expect(dock.setIcon).not.toHaveBeenCalled()
    expect(finder.apply).not.toHaveBeenCalled()
  })

  test('updates the macOS dock, Finder metadata, and template tray icon', async () => {
    const root = await temporaryRoot()
    const dir = await createAssets(root, 'lavender-light', [
      'icon-512.png',
      'trayTemplate.png'
    ])
    const dock = { setIcon: vi.fn() }
    const finder = { apply: vi.fn(async () => undefined) }
    const tray = { setIconVariant: vi.fn() }
    const windows = vi.fn(() => [] as BrowserWindow[])
    const applier = createAppIconApplier({
      getSettings: () => settings('sepia', 'lavender'),
      prefersDark: () => true,
      platform: 'darwin',
      isPackaged: true,
      resourcesPath: root,
      bundleDir: '/unused',
      dock,
      windows,
      tray,
      finder
    })

    await applier.apply()

    const png = join(dir, 'icon-512.png')
    expect(electronMocks.nativeImage.createFromPath).toHaveBeenCalledWith(png)
    expect(dock.setIcon).toHaveBeenCalledWith({ path: png })
    expect(finder.apply).toHaveBeenCalledWith(png)
    expect(tray.setIconVariant).toHaveBeenCalledWith(dir)
    expect(windows).not.toHaveBeenCalled()
  })

  test('clears Finder metadata for the default bandal-dark variant', async () => {
    const root = await temporaryRoot()
    await createAssets(root, 'bandal-dark', ['icon-512.png'])
    const finder = { apply: vi.fn(async () => undefined) }
    const applier = createAppIconApplier({
      getSettings: () => settings('dark', 'bandal'),
      prefersDark: () => true,
      platform: 'darwin',
      isPackaged: true,
      resourcesPath: root,
      bundleDir: '/unused',
      windows: () => [],
      finder
    })

    await applier.apply()

    expect(finder.apply).toHaveBeenCalledWith(null)
  })

  test('does not touch Finder metadata in development', async () => {
    const root = await temporaryRoot()
    const bundleDir = join(root, 'out/main')
    await mkdir(bundleDir, { recursive: true })
    await createAssets(join(root, 'resources'), 'bandal-dark', ['icon-512.png'])
    const finder = { apply: vi.fn(async () => undefined) }
    const applier = createAppIconApplier({
      getSettings: () => settings('dark', 'bandal'),
      prefersDark: () => true,
      platform: 'darwin',
      isPackaged: false,
      resourcesPath: '/unused',
      bundleDir,
      windows: () => [],
      finder
    })

    await applier.apply()

    expect(finder.apply).not.toHaveBeenCalled()
  })

  test('warns and skips surfaces whose icon files are missing', async () => {
    const root = await temporaryRoot()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const win = { setIcon: vi.fn() }
    const tray = { setIconVariant: vi.fn() }
    const applier = createAppIconApplier({
      getSettings: () => settings('light', 'moss'),
      prefersDark: () => false,
      platform: 'win32',
      isPackaged: true,
      resourcesPath: root,
      bundleDir: '/unused',
      windows: () => [win] as unknown as BrowserWindow[],
      tray
    })

    await expect(applier.apply()).resolves.toBeUndefined()

    expect(applier.current()).toBe('moss-light')
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('icon-256.png'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tray.ico'))
    expect(win.setIcon).not.toHaveBeenCalled()
    expect(tray.setIconVariant).not.toHaveBeenCalled()
  })
})
