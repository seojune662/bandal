import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const win = {
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setContentProtection: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    showInactive: vi.fn(),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
  }
  return {
    options: null as Electron.BrowserWindowConstructorOptions | null,
    win,
    BrowserWindow: vi.fn(function BrowserWindow(
      options: Electron.BrowserWindowConstructorOptions
    ) {
      electronMocks.options = options
      return win
    })
  }
})

vi.mock('electron', () => ({ BrowserWindow: electronMocks.BrowserWindow }))

import { createOrbWindow } from '../../../src/main/windows/overlayWindow'

describe('createOrbWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.options = null
  })

  test('creates a 240px pass-through canvas with ordinary capture visibility', () => {
    createOrbWindow({ position: { x: 10, y: 20 }, preload: '/preload.js' })

    expect(electronMocks.options).toMatchObject({
      x: 10,
      y: 20,
      width: 240,
      height: 240,
      show: false,
      transparent: true,
      focusable: false
    })
    expect(electronMocks.win.setContentProtection).toHaveBeenCalledWith(false)
    expect(electronMocks.win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, {
      forward: true
    })
    expect(electronMocks.win.showInactive).not.toHaveBeenCalled()
  })
})
