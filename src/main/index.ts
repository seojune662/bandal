import { app, BrowserWindow, ipcMain } from 'electron'
import { initDatabase, closeDatabase } from './db/database'
import { registerHandlers } from './ipc/registerHandlers'
import { installApplicationMenu } from './menu'
import { createMainWindow } from './windows/mainWindow'
import { openSettingsWindow } from './windows/settingsWindow'

// [M6-B testability] E2E runs (Playwright _electron) point the app at a
// throwaway profile so tests never touch the real userData. Must run before
// requestSingleInstanceLock — the lock is scoped to the userData path.
const testUserDataDir = process.env['BANDAL_USER_DATA_DIR']
if (testUserDataDir !== undefined && testUserDataDir !== '') {
  app.setPath('userData', testUserDataDir)
}

// Single-instance guard.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createMainWindow()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.bandal.app')

    // [M6-A] Custom menu: keeps ⌘W free for "close tab" in the renderer.
    installApplicationMenu()

    initDatabase()
    registerHandlers()

    // Temporary M0 channel to open the settings window from the renderer.
    // Replaced by an app menu entry in a later milestone.
    ipcMain.handle('window:openSettings', () => {
      openSettingsWindow()
      return { ok: true }
    })

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    closeDatabase()
  })
}
