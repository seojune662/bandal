import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const windows: Array<{
    options: Electron.BrowserWindowConstructorOptions
    setAlwaysOnTop: ReturnType<typeof vi.fn>
    setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
    webContents: {
      setWindowOpenHandler: ReturnType<typeof vi.fn>
    }
  }> = []
  return {
    windows,
    BrowserWindow: vi.fn(function BrowserWindow(
      options: Electron.BrowserWindowConstructorOptions
    ) {
      const win = {
        options,
        setAlwaysOnTop: vi.fn(),
        setVisibleOnAllWorkspaces: vi.fn(),
        webContents: { setWindowOpenHandler: vi.fn() }
      }
      windows.push(win)
      return win
    })
  }
})

const hardeningMocks = vi.hoisted(() => ({
  attachNavigationPolicies: vi.fn(),
  popupWebPreferences: vi.fn(() => ({
    partition: 'persist:browsing',
    contextIsolation: true,
    sandbox: true,
    plugins: true
  }))
}))

vi.mock('electron', () => ({ BrowserWindow: electronMocks.BrowserWindow }))
vi.mock('../../../src/main/features/browser/hardenWebviews', () => hardeningMocks)
vi.mock('../../../src/main/windows/overlayWindow', () => ({
  macPanelOptions: vi.fn(() => ({}))
}))

import {
  createLocalPipWindow,
  createWebPipWindow
} from '../../../src/main/windows/miniPlayerWindow'

const BOUNDS = { x: 100, y: 200, width: 480, height: 270 }

describe('mini player window factories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.windows.length = 0
  })

  test('creates an isolated local app window that survives the taskbar', () => {
    createLocalPipWindow({
      bounds: BOUNDS,
      preload: '/preload.js',
      backgroundColor: '#101827'
    })

    const created = electronMocks.windows[0]!
    expect(created.options).toMatchObject({
      ...BOUNDS,
      frame: false,
      roundedCorners: true,
      resizable: true,
      minWidth: 240,
      minHeight: 135,
      skipTaskbar: false,
      backgroundColor: '#101827',
      webPreferences: {
        preload: '/preload.js',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    expect(created.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(created.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true
    })
    expect(created.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
  })

  test('uses browsing preferences and shared navigation policies for web video', () => {
    const openInTab = vi.fn()
    createWebPipWindow({ bounds: BOUNDS, openInTab })

    const created = electronMocks.windows[0]!
    expect(created.options.webPreferences).toMatchObject({
      partition: 'persist:browsing',
      contextIsolation: true,
      sandbox: true,
      plugins: true,
      backgroundThrottling: false
    })
    expect(hardeningMocks.attachNavigationPolicies).toHaveBeenCalledWith(
      created.webContents,
      { openInTab }
    )
  })
})
