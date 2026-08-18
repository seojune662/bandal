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

  // 렌더러는 로컬 앱 문서다 — 어떤 최상위 내비게이션도 정상 경로가 아니다
  // (버그이거나 처리되지 않은 링크 클릭). 허용 목록 없이 전부 막는다.
  // <webview> 게스트의 내비게이션은 별개 webContents 라 영향받지 않는다.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
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
