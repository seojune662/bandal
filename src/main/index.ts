import { app, BrowserWindow, ipcMain } from 'electron'
import { initDatabase, closeDatabase } from './db/database'
import { registerHandlers } from './ipc/registerHandlers'
import { installApplicationMenu } from './menu'
import { createMainWindow } from './windows/mainWindow'
import { openSettingsWindow } from './windows/settingsWindow'
import { reportFatalStartupError } from './startupError'

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

    // DB 초기화 실패는 치명적이다 — 여기서 던지면 아래 createMainWindow()가
    // 실행되지 않아 "창 없는 앱"이 된다. 반드시 사용자에게 보이게 만든다.
    try {
      initDatabase()
    } catch (error: unknown) {
      reportFatalStartupError('데이터베이스 초기화', error)
      return
    }

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
  }).catch((error: unknown) => {
    // whenReady 체인의 나머지(메뉴 설치, 핸들러 등록, 창 생성)에서 던진 경우.
    // catch가 없으면 unhandled rejection으로 조용히 사라진다.
    reportFatalStartupError('앱 초기화', error)
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
