import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { OverlayView } from '../../shared/types/overlay'
import type { Rect } from './overlayGeometry'
import {
  ORB_WINDOW_SIZE,
  POPUP_MIN_SIZE
} from './overlayGeometry'

export function macPanelOptions(): {
  type?: 'panel'
  hiddenInMissionControl?: boolean
} {
  if (process.platform !== 'darwin') return {}
  return {
    // Electron 43 documents `panel` as the NSPanel-backed type that can float
    // above full-screen apps. BANDAL_OVERLAY_PANEL=0 is the runtime fallback
    // for macOS/window-manager combinations where panel behavior regresses.
    ...(process.env['BANDAL_OVERLAY_PANEL'] === '0'
      ? {}
      : { type: 'panel' as const }),
    hiddenInMissionControl: true
  }
}

function configureOverlayWindow(
  win: BrowserWindow,
  level: 'screen-saver' | 'floating'
): void {
  // Electron 43: screen-saver is above Dock/taskbar; floating is the normal
  // always-on-top tier. The orb needs the former, the interactive popup the latter.
  win.setAlwaysOnTop(true, level)

  if (process.platform === 'darwin') {
    // Electron 43 exposes visibleOnFullScreen specifically for showing a
    // window across Spaces, including above another app's full-screen Space.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.excludedFromShownWindowsMenu = true
  }

  try {
    // Desktop overlays remain visible in ordinary sharing/recording. Capture
    // code temporarily enables protection only around its own screenshot.
    win.setContentProtection(false)
  } catch (error) {
    console.warn('[overlay] content protection is unsupported:', error)
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}

export function createOrbWindow(opts: {
  position: { x: number; y: number }
  preload: string
}): BrowserWindow {
  const win = new BrowserWindow({
    ...opts.position,
    width: ORB_WINDOW_SIZE,
    height: ORB_WINDOW_SIZE,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    ...macPanelOptions(),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  configureOverlayWindow(win, 'screen-saver')
  // Transparent charm margins never block the app underneath. The renderer
  // opts back into mouse handling only over the pill or charm body.
  win.setIgnoreMouseEvents(true, { forward: true })
  return win
}

export function createPopupWindow(opts: {
  bounds: Rect
  preload: string
  backgroundColor: string
}): BrowserWindow {
  const win = new BrowserWindow({
    ...opts.bounds,
    show: false,
    backgroundColor: opts.backgroundColor,
    frame: false,
    roundedCorners: true,
    resizable: true,
    minWidth: POPUP_MIN_SIZE.width,
    minHeight: POPUP_MIN_SIZE.height,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...macPanelOptions(),
    webPreferences: {
      preload: opts.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  configureOverlayWindow(win, 'floating')
  return win
}

export function loadOverlayView(win: BrowserWindow, view: OverlayView): void {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl !== undefined) {
    void win.loadURL(`${rendererUrl}/overlay.html?view=${view}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'), {
      query: { view }
    })
  }
}
