import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { WINDOW_BACKGROUND } from '../../shared/theme'
import { getSettings } from '../settingsStore'

let mainWindow: BrowserWindow | null = null

function resolveBackground(): string {
  const { theme } = getSettings()
  if (theme === 'light') {
    return WINDOW_BACKGROUND.light
  }
  // 'dark' and 'system' both start dark; renderer refines 'system' via
  // prefers-color-scheme once loaded.
  return WINDOW_BACKGROUND.dark
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
      sandbox: true
    }
  })

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
