import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/types/settings'

const electronMocks = vi.hoisted(() => {
  const trayInstances: Array<{
    setToolTip: ReturnType<typeof vi.fn>
    setContextMenu: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }> = []
  return {
    trayInstances,
    app: { isPackaged: false },
    menu: { buildFromTemplate: vi.fn(() => ({})) },
    nativeImage: { createEmpty: vi.fn(() => ({ empty: true })) },
    Tray: vi.fn(function () {
      const instance = {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn()
      }
      trayInstances.push(instance)
      return instance
    })
  }
})

vi.mock('electron', () => ({
  app: electronMocks.app,
  Menu: electronMocks.menu,
  nativeImage: electronMocks.nativeImage,
  Tray: electronMocks.Tray
}))

import { installTray, resolveTrayIconPath } from '../../../src/main/windows/tray'

describe('resolveTrayIconPath', () => {
  test('resolves development assets relative to the bundled out/main directory', () => {
    expect(
      resolveTrayIconPath({
        isPackaged: false,
        resourcesPath: '/Applications/Bandal.app/Contents/Resources',
        bundleDir: '/repo/out/main',
        platform: 'darwin'
      })
    ).toBe('/repo/resources/trayTemplate.png')
  })

  test('resolves packaged Windows assets from process.resourcesPath/tray', () => {
    expect(
      resolveTrayIconPath({
        isPackaged: true,
        resourcesPath: 'C:\\Program Files\\Bandal\\resources',
        bundleDir: 'C:\\repo\\out\\main',
        platform: 'win32'
      })
    ).toBe('C:\\Program Files\\Bandal\\resources/tray/tray.ico')
  })
})

describe('installTray', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.trayInstances.length = 0
  })

  test('falls back to an empty icon when loading the tray image throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    warn.mockClear()
    electronMocks.Tray
      .mockImplementationOnce(() => {
        throw new Error('Failed to load image')
      })
      .mockImplementationOnce(function () {
        const instance = {
          setToolTip: vi.fn(),
          setContextMenu: vi.fn(),
          on: vi.fn(),
          destroy: vi.fn()
        }
        electronMocks.trayInstances.push(instance)
        return instance
      })

    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      assistantMode: 'desktop'
    }
    expect(() =>
      installTray({
        getSettings: () => settings,
        setSettings: () => settings,
        openMain: vi.fn(),
        quit: vi.fn()
      })
    ).not.toThrow()

    expect(electronMocks.nativeImage.createEmpty).toHaveBeenCalledOnce()
    expect(electronMocks.trayInstances).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[tray\]/),
      expect.any(Error)
    )
    warn.mockRestore()
  })

  test('continues without a tray when both creation attempts throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    warn.mockClear()
    electronMocks.Tray.mockImplementation(() => {
      throw new Error('tray unavailable')
    })
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      assistantMode: 'desktop'
    }

    expect(() =>
      installTray({
        getSettings: () => settings,
        setSettings: () => settings,
        openMain: vi.fn(),
        quit: vi.fn()
      })
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[tray\] failed to load tray icon/),
      expect.any(Error)
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[tray\] failed to create tray/),
      expect.any(Error)
    )
    warn.mockRestore()
  })
})
