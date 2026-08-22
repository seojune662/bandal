import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const windows: Array<{
    options: Electron.BrowserWindowConstructorOptions
    setAlwaysOnTop: ReturnType<typeof vi.fn>
    setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
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
        loadFile: vi.fn(async () => undefined),
        loadURL: vi.fn(async () => undefined),
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
  createWebPipWindow,
  loadLocalPipView
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

  test('passes the complete local player route to the packaged renderer', () => {
    const win = createLocalPipWindow({
      bounds: BOUNDS,
      preload: '/preload.js',
      backgroundColor: '#101827'
    })

    loadLocalPipView(win, {
      kind: 'local',
      courseId: 'course 1',
      relPath: 'week 1/lecture.mp4',
      title: '첫 강의'
    })

    expect(electronMocks.windows[0]?.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer\/pip\.html$/),
      {
        query: {
          view: 'player',
          course: 'course 1',
          rel: 'week 1/lecture.mp4',
          title: '첫 강의'
        }
      }
    )
  })

  test('encodes the complete local player route in the development URL', () => {
    const previousRendererUrl = process.env['ELECTRON_RENDERER_URL']
    process.env['ELECTRON_RENDERER_URL'] = 'https://renderer.test'
    try {
      const win = createLocalPipWindow({
        bounds: BOUNDS,
        preload: '/preload.js',
        backgroundColor: '#101827'
      })

      loadLocalPipView(win, {
        kind: 'local',
        courseId: 'course 1',
        relPath: 'week 1/lecture.mp4',
        title: 'First lecture'
      })

      expect(electronMocks.windows[0]?.loadURL).toHaveBeenCalledWith(
        'https://renderer.test/pip.html?view=player&course=course+1&rel=week+1%2Flecture.mp4&title=First+lecture'
      )
    } finally {
      if (previousRendererUrl === undefined) {
        delete process.env['ELECTRON_RENDERER_URL']
      } else {
        process.env['ELECTRON_RENDERER_URL'] = previousRendererUrl
      }
    }
  })
})
