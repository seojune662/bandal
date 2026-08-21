import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import {
  resolveWindowBackground as resolveThemeWindowBackground,
  resolveWindowSymbolColor
} from '../../shared/theme'
import { hardenWindowWebviews } from '../features/browser'
import { getSettings } from '../settingsStore'
import { createWindowStateStore } from './windowBounds'

let mainWindow: BrowserWindow | null = null
const mainWindowClosedListeners = new Set<() => void>()
const MIN_WIDTH = 1024
const MIN_HEIGHT = 640

/** Painted before any CSS loads, so it must track the theme's --bg-app
 * exactly (src/shared/theme.ts) or launch flashes the wrong color. */
export function resolveWindowBackground(): string {
  const { theme, palette } = getSettings()
  return resolveThemeWindowBackground(
    theme,
    palette,
    nativeTheme.shouldUseDarkColors
  )
}

/** Subscribes to the main window lifetime without taking ownership of it. */
export function onMainWindowClosed(cb: () => void): () => void {
  mainWindowClosedListeners.add(cb)
  return () => mainWindowClosedListeners.delete(cb)
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return mainWindow
  }

  const windowStateStore = createWindowStateStore({
    file: join(app.getPath('userData'), 'window-state.json'),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  })
  const windowState = windowStateStore.read()

  mainWindow = new BrowserWindow({
    width: windowState.bounds?.width ?? 1280,
    height: windowState.bounds?.height ?? 800,
    ...(windowState.bounds !== null
      ? { x: windowState.bounds.x, y: windowState.bounds.y }
      : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // macOS: traffic lights inset into our chrome. Windows: frameless + native
    // caption buttons via titleBarOverlay — without it there are NO window
    // controls at all (min/max/close), which shipped broken through v0.12.x.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: resolveWindowBackground(),
            symbolColor: resolveWindowSymbolColor(
              getSettings().theme,
              nativeTheme.shouldUseDarkColors
            ),
            // Matches --chrome-height (2.75rem) so the caption buttons align
            // with the tab strip row.
            height: 44
          }
        }
      : {}),
    backgroundColor: resolveWindowBackground(),
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
  windowStateStore.track(mainWindow)

  if (windowState.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    for (const listener of mainWindowClosedListeners) listener()
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
