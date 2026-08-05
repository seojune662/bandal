import { app, BrowserWindow, ipcMain } from 'electron'
import { initDatabase, closeDatabase } from './db/database'
import { registerHandlers } from './ipc/registerHandlers'
import { createMainWindow } from './windows/mainWindow'
import { openSettingsWindow } from './windows/settingsWindow'

// Single-instance guard.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    createMainWindow()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.bandal.app')

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
