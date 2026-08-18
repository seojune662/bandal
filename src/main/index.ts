import path from 'node:path'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { initDatabase, closeDatabase } from './db/database'
import { createDeepLinkQueue } from './deepLinkQueue'
import { findDeepLinkArg } from './features/group/authCallbackUrl'
import { registerHandlers } from './ipc/registerHandlers'
import { installApplicationMenu } from './menu'
import { createMainWindow } from './windows/mainWindow'
import { openSettingsInApp } from './windows/settingsWindow'
import { reportFatalStartupError } from './startupError'

// [M6-B testability] E2E runs (Playwright _electron) point the app at a
// throwaway profile so tests never touch the real userData. Must run before
// requestSingleInstanceLock — the lock is scoped to the userData path.
const testUserDataDir = process.env['BANDAL_USER_DATA_DIR']
if (testUserDataDir !== undefined && testUserDataDir !== '') {
  app.setPath('userData', testUserDataDir)
}

// [bandal-media] 자료 동영상 스트리밍 스킴. 특권 등록은 반드시 whenReady 전에
// 해야 한다 (Electron 제약). stream: true 가 Range 기반 <video> 탐색의 핵심.
// 실제 핸들러는 registerHandlers.ts 가 whenReady 후 protocol.handle 로 단다.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bandal-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

// Single-instance guard.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // [P2-D] OAuth deep links. Buffered because macOS can deliver the callback
  // before whenReady() — see deepLinkQueue.ts for why dropping it is the
  // "login only works on the second try" bug.
  const deepLinks = createDeepLinkQueue()

  /**
   * Registers this build as the handler for `bandal://`.
   *
   * The `defaultApp` branch is for `electron-vite dev`, where the running
   * binary is Electron itself: the OS has to be told to relaunch
   * `Electron <project path>` rather than bare Electron, or the callback opens
   * a second, project-less app. Note that in dev macOS registers the *Electron*
   * bundle for the scheme — see docs/oauth-setup.md for how to verify.
   */
  function registerProtocolClient(): void {
    const entry = process.argv[1]
    if (process.defaultApp && entry !== undefined) {
      app.setAsDefaultProtocolClient('bandal', process.execPath, [
        path.resolve(entry)
      ])
      return
    }
    app.setAsDefaultProtocolClient('bandal')
  }
  registerProtocolClient()

  // ⚠ MUST be registered before whenReady(). A cold start from a deep link
  // emits `open-url` during startup; a listener attached inside whenReady()
  // misses it entirely and the URL is gone for good.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deepLinks.push(url)
  })

  // Windows/Linux deliver the URL in argv instead; harmless no-op on macOS.
  const argvDeepLink = findDeepLinkArg(process.argv)
  if (argvDeepLink !== null) deepLinks.push(argvDeepLink)

  app.on('second-instance', (_event, argv) => {
    // The relaunch that carries the callback is killed by the single-instance
    // lock, so its argv is the only place the URL exists.
    const url = findDeepLinkArg(argv)
    if (url !== null) deepLinks.push(url)
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

    const router = registerHandlers()

    // Temporary M0 channel to open the settings window from the renderer.
    // Replaced by an app menu entry in a later milestone.
    ipcMain.handle('window:openSettings', () => {
      openSettingsInApp()
      return { ok: true }
    })

    const window = createMainWindow()

    // Replay only once the renderer is listening: the auth result travels back
    // as an `auth:changed` push, and a push sent to a window that has not
    // finished loading is dropped on the floor. `did-fail-load` is here so a
    // failed renderer load cannot strand a queued callback forever — attach()
    // is idempotent, so whichever fires first wins.
    const attachDeepLinks = (): void => {
      deepLinks.attach((url) => router.handleDeepLink(url))
    }
    window.webContents.once('did-finish-load', attachDeepLinks)
    window.webContents.once('did-fail-load', attachDeepLinks)

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
