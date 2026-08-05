import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { resolveWindowBackground } from '../../shared/theme'
import { hardenWindowWebviews } from '../features/browser'
import { getSettings } from '../settingsStore'

let mainWindow: BrowserWindow | null = null

/** Painted before any CSS loads, so it must track the theme's --bg-app
 * exactly (src/shared/theme.ts) or launch flashes the wrong color. */
function resolveBackground(): string {
  const { theme } = getSettings()
  return resolveWindowBackground(theme, nativeTheme.shouldUseDarkColors)
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: resolveBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // M3-F embedded browser tabs. Guests are locked down fail-closed by
      // hardenWindowWebviews (partition allowlist, forced sandbox, no preload).
      webviewTag: true
    }
  })

  // Must be attached before the renderer loads so no webview can slip past.
  hardenWindowWebviews(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Open target=_blank links in the external browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
    void mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html`)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
