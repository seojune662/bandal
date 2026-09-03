import path, { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow, ipcMain, nativeTheme, protocol } from 'electron'
import type { IpcResponse } from '../shared/ipc/contract'
import type { PushPayload } from '../shared/ipc/events'
import { resolveKeymap } from '../shared/keymap'
import type { Settings, SettingsPatch } from '../shared/types/settings'
import { initDatabase, closeDatabase } from './db/database'
import { createDeepLinkQueue } from './deepLinkQueue'
import { findDeepLinkArg } from './features/group/authCallbackUrl'
import { broadcast, registerHandlers } from './ipc/registerHandlers'
import { installApplicationMenu } from './menu'
import { getSettings, setSettings as persistSettings } from './settingsStore'
import {
  createMainWindow,
  getMainWindow,
  onMainWindowClosed,
  refreshTitleBarOverlay,
  resolveWindowBackground
} from './windows/mainWindow'
import { createOverlayController } from './windows/overlayController'
import { openSettingsInApp } from './windows/settingsWindow'
import { installTray } from './windows/tray'
import { createAppIconApplier } from './windows/appIcon'
import {
  createFinderIconApplier,
  resolveAppBundlePath
} from './windows/macFinderIcon'
import { reportFatalStartupError } from './startupError'
import { PLUGIN_SCHEME } from './features/plugins/pluginProtocol'

const execFileAsync = promisify(execFile)

const settingsChangedListeners = new Set<(settings: Settings) => void>()

function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  settingsChangedListeners.add(cb)
  return () => settingsChangedListeners.delete(cb)
}

function setSettings(patch: SettingsPatch): Settings {
  const settings = persistSettings(patch)
  for (const listener of settingsChangedListeners) listener(settings)
  return settings
}

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
      // pdf.js 가 fetch 로 range 요청한다 — corsEnabled 없이는 렌더러
      // 오리진에서의 cross-origin fetch 가 CORS 로 조용히 죽는다.
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: PLUGIN_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
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
    // Rebuild only when accelerator settings change; rebuilding for unrelated
    // settings would drop an open submenu and re-register every accelerator.
    const initialSettings = getSettings()
    let menuKeybindings = JSON.stringify(initialSettings.keybindings)
    installApplicationMenu(resolveKeymap(initialSettings.keybindings))

    // DB 초기화 실패는 치명적이다 — 여기서 던지면 아래 createMainWindow()가
    // 실행되지 않아 "창 없는 앱"이 된다. 반드시 사용자에게 보이게 만든다.
    try {
      initDatabase()
    } catch (error: unknown) {
      reportFatalStartupError('데이터베이스 초기화', error)
      return
    }

    const overlay = createOverlayController({
      getSettings,
      onSettingsChanged,
      broadcast,
      getMainWindow,
      createMainWindow,
      preloadPath: join(__dirname, '../preload/index.js'),
      windowBackground: resolveWindowBackground,
      userDataPath: app.getPath('userData')
    })

    const openMain = (): void => {
      const existing = getMainWindow()
      const main = existing ?? createMainWindow()
      if (existing !== null) {
        main.show()
        main.focus()
      } else {
        overlay.syncMainWindowVisibility()
      }
    }

    type OpenTarget =
      | {
          channel: 'ui:openMaterial'
          payload: PushPayload<'ui:openMaterial'>
        }
      | { channel: 'ui:openUrl'; payload: PushPayload<'ui:openUrl'> }
    type PendingOpen = NonNullable<
      IpcResponse<'ui:consumePendingOpen'>
    >
    let pendingOpen: PendingOpen | null = null

    const pushToMain = (target: OpenTarget): void => {
      const existing = getMainWindow()
      if (existing === null) {
        // Like deepLinkQueue, do not send at did-finish-load: React has not
        // mounted AppShell's onPush listeners yet, so that push is lossy. The
        // renderer consumes this one-slot handoff after its effects mount.
        createMainWindow()
        pendingOpen =
          target.channel === 'ui:openMaterial'
            ? { ...(pendingOpen ?? {}), material: target.payload }
            : { ...(pendingOpen ?? {}), url: target.payload }
        overlay.syncMainWindowVisibility()
        return
      }
      existing.show()
      existing.focus()
      if (!existing.webContents.isDestroyed()) {
        existing.webContents.send(target.channel, target.payload)
      }
    }
    const openMaterial = (
      payload: PushPayload<'ui:openMaterial'>
    ): void => pushToMain({ channel: 'ui:openMaterial', payload })
    const openUrl = (payload: PushPayload<'ui:openUrl'>): void =>
      pushToMain({ channel: 'ui:openUrl', payload })
    const openUrlInTab = (url: string): void => {
      openUrl({ url, positionSec: 0, playbackRate: 1 })
    }

    let miniPlayerOpen = false
    let syncMiniPlayerTray = (): void => undefined
    const router = registerHandlers({
      overlay,
      setSettings,
      preloadPath: join(__dirname, '../preload/index.js'),
      pluginPanelPreloadPath: join(__dirname, '../preload/pluginPanel.js'),
      userDataPath: app.getPath('userData'),
      windowBackground: resolveWindowBackground,
      openMaterial,
      openUrl,
      openInTab: openUrlInTab,
      consumePendingOpen: () => {
        const pending = pendingOpen
        pendingOpen = null
        return pending
      },
      onMiniPlayerStateChanged: (open) => {
        miniPlayerOpen = open
        syncMiniPlayerTray()
      }
    })

    const trayDeps = {
      getSettings,
      setSettings,
      openMain,
      quit: () => app.quit()
    }
    const tray = installTray(trayDeps)
    let miniPlayerTray: ReturnType<typeof installTray> | null = null
    let iconVariantDir: string | null = null

    syncMiniPlayerTray = (): void => {
      const temporaryTrayNeeded =
        miniPlayerOpen && getSettings().assistantMode === 'in-app'
      if (!temporaryTrayNeeded) {
        miniPlayerTray?.destroy()
        miniPlayerTray = null
        return
      }
      if (miniPlayerTray !== null) return

      miniPlayerTray = installTray({
        getSettings: () => ({ ...getSettings(), assistantMode: 'desktop' }),
        setSettings: (patch) =>
          setSettings(
            patch.assistantMode === 'in-app'
              ? { ...patch, assistantMode: 'desktop' }
              : patch
          ),
        openMain,
        quit: () => app.quit()
      })
      if (iconVariantDir !== null) {
        miniPlayerTray.setIconVariant(iconVariantDir)
      }
    }

    const trayIconTarget = {
      setIconVariant(dir: string): void {
        iconVariantDir = dir
        tray.setIconVariant(dir)
        miniPlayerTray?.setIconVariant(dir)
      }
    }

    const appBundlePath = resolveAppBundlePath(app.getPath('exe'))
    const finder =
      process.platform === 'darwin' &&
      app.isPackaged &&
      appBundlePath !== null
        ? createFinderIconApplier({
            appBundlePath,
            async exec(command, args) {
              const result = await execFileAsync(command, args, {
                encoding: 'utf8'
              })
              return {
                code: 0,
                stdout: result.stdout,
                stderr: result.stderr
              }
            }
          })
        : undefined
    const appIcon = createAppIconApplier({
      getSettings,
      prefersDark: () => nativeTheme.shouldUseDarkColors,
      platform: process.platform,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      bundleDir: __dirname,
      ...(app.dock === undefined ? {} : { dock: app.dock }),
      windows: () => BrowserWindow.getAllWindows(),
      tray: trayIconTarget,
      ...(finder === undefined ? {} : { finder })
    })

    const refreshAppearance = (): void => {
      void appIcon.apply()
      const main = getMainWindow()
      if (main !== null && !main.isDestroyed()) {
        refreshTitleBarOverlay(
          main,
          getSettings(),
          nativeTheme.shouldUseDarkColors
        )
      }
    }
    onSettingsChanged((settings) => {
      const nextMenuKeybindings = JSON.stringify(settings.keybindings)
      if (nextMenuKeybindings !== menuKeybindings) {
        menuKeybindings = nextMenuKeybindings
        installApplicationMenu(resolveKeymap(settings.keybindings))
      }
      tray.refresh()
      syncMiniPlayerTray()
      refreshAppearance()
    })
    nativeTheme.on('updated', refreshAppearance)

    // Temporary M0 channel to open the settings window from the renderer.
    // Replaced by an app menu entry in a later milestone.
    ipcMain.handle('window:openSettings', () => {
      openSettingsInApp()
      return { ok: true }
    })

    const window = createMainWindow()
    overlay.start()
    tray.refresh()
    refreshAppearance()

    onMainWindowClosed(() => {
      const settings = getSettings()
      if (
        settings.assistantMode === 'desktop' &&
        !settings.desktopOrb.keepAliveOnClose
      ) {
        overlay.stop()
      }
      if (
        process.platform !== 'darwin' &&
        !overlay.isActive() &&
        !router.miniPlayer.isAlive()
      ) {
        app.quit()
      }
    })

    app.on('before-quit', () => {
      overlay.markQuitting()
      router.miniPlayer.markQuitting()
    })

    app.on('window-all-closed', () => {
      if (
        process.platform !== 'darwin' &&
        !overlay.isActive() &&
        !router.miniPlayer.isAlive()
      ) {
        app.quit()
      }
    })

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
      if (getMainWindow() === null) {
        createMainWindow()
        overlay.syncMainWindowVisibility()
      }
    })
  }).catch((error: unknown) => {
    // whenReady 체인의 나머지(메뉴 설치, 핸들러 등록, 창 생성)에서 던진 경우.
    // catch가 없으면 unhandled rejection으로 조용히 사라진다.
    reportFatalStartupError('앱 초기화', error)
  })

  app.on('will-quit', () => {
    closeDatabase()
  })
}
