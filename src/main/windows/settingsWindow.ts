import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { resolveWindowBackground } from '../../shared/theme'
import { getSettings } from '../settingsStore'

let settingsWindow: BrowserWindow | null = null

/** Opens the singleton settings window (focuses it if already open). */
export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return settingsWindow
  }

  const { theme } = getSettings()
  settingsWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 900,
    minHeight: 640,
    maxWidth: 900,
    maxHeight: 640,
    resizable: false,
    center: true,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: resolveWindowBackground(
      theme,
      nativeTheme.shouldUseDarkColors
    ),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  settingsWindow.on('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL'] !== undefined) {
    void settingsWindow.loadURL(
      `${process.env['ELECTRON_RENDERER_URL']}/settings.html`
    )
  } else {
    void settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'))
  }

  return settingsWindow
}
