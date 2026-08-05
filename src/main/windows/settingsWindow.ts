import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_BACKGROUND } from '../../shared/theme'
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
    width: 720,
    height: 560,
    minWidth: 560,
    minHeight: 420,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor:
      theme === 'light' ? WINDOW_BACKGROUND.light : WINDOW_BACKGROUND.dark,
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
