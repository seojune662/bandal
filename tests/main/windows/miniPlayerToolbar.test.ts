import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  options: null as Electron.BrowserWindowConstructorOptions | null,
  toolbar: {
    isDestroyed: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    setBounds: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
  },
  BrowserWindow: vi.fn(function BrowserWindow(
    options: Electron.BrowserWindowConstructorOptions
  ) {
    electronMocks.options = options
    return electronMocks.toolbar
  })
}))

vi.mock('electron', () => ({ BrowserWindow: electronMocks.BrowserWindow }))
vi.mock('../../../src/main/windows/overlayWindow', () => ({
  macPanelOptions: vi.fn(() => ({}))
}))

import {
  createMiniPlayerToolbar,
  MINI_PLAYER_TOOLBAR_HEIGHT
} from '../../../src/main/windows/miniPlayerToolbar'

describe('createMiniPlayerToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.options = null
    delete process.env['ELECTRON_RENDERER_URL']
  })

  test('creates a 36px non-focusable child and follows parent geometry', () => {
    let bounds = { x: 40, y: 60, width: 480, height: 270 }
    const listeners = new Map<string, () => void>()
    const parent = {
      getBounds: vi.fn(() => ({ ...bounds })),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener)
      })
    }

    createMiniPlayerToolbar({
      pipWindow: parent as unknown as Electron.BrowserWindow,
      preload: '/preload.js'
    })

    expect(electronMocks.options).toMatchObject({
      parent,
      x: 40,
      y: 60,
      width: 480,
      height: MINI_PLAYER_TOOLBAR_HEIGHT,
      transparent: true,
      frame: false,
      focusable: false,
      alwaysOnTop: true,
      webPreferences: { preload: '/preload.js', sandbox: true }
    })
    expect(electronMocks.toolbar.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('renderer/pip.html'),
      { query: { view: 'toolbar' } }
    )

    bounds = { x: 80, y: 90, width: 640, height: 360 }
    listeners.get('move')?.()
    expect(electronMocks.toolbar.setBounds).toHaveBeenLastCalledWith({
      x: 80,
      y: 90,
      width: 640,
      height: 36
    })
  })
})
