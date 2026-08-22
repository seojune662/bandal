/**
 * Auto-update runtime.
 *
 * Wraps electron-updater's `autoUpdater` behind the `UpdateStatus` union so the
 * renderer never sees electron-updater types, and so every state transition
 * reaches every window through one push channel.
 *
 * Three deliberate choices:
 *
 * 1. **`autoDownload = false`.** A macOS update is a ~95 MB zip. Students on
 *    metered phone tethering should not discover that after the fact — the
 *    download starts when they press the button.
 * 2. **Silent when there is nothing to say.** "No update available" and
 *    "offline" are the normal case on almost every check. They resolve to
 *    `idle`, never to `error`, so the toast stays quiet.
 * 3. **Disabled unless packaged.** In `electron-vite dev` there is no
 *    `app-update.yml`, and asking anyway throws on every check. The phase is
 *    `unsupported` and the UI hides itself.
 */

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../../../shared/types/update'
import { killAllClaudeProcessesSync } from '../agent'
import { resolveAppVersion } from './appVersion'
import { describeError, isNoFeed, isOfflineish } from './errorMessages'

export { resolveAppVersion } from './appVersion'

// electron-updater is CommonJS; the named export is not reachable via ESM
// destructuring in the electron-vite bundle.
const { autoUpdater } = electronUpdater

/** First check runs after startup settles — window paint wins the race. */
const INITIAL_CHECK_DELAY_MS = 10_000
/** Then every 6 hours, for the student who never quits the app. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdaterRuntime {
  /** Latest known state. Cheap; never hits the network. */
  status(): UpdateStatus
  /** Explicit user-initiated check. */
  check(): Promise<UpdateStatus>
  /** Begin downloading an available update. */
  download(): Promise<UpdateStatus>
  /** Quit and install. Returns false if there was nothing staged. */
  install(): boolean
  /** Stops the periodic timer. */
  dispose(): void
}

export interface UpdaterDeps {
  /** Broadcasts a state change to every renderer window. */
  broadcast: (status: UpdateStatus) => void
  /** Injectable for tests. Defaults to `app.isPackaged`. */
  isPackaged?: boolean
  /** Injectable for tests. Defaults to the installed or build app version. */
  currentVersion?: string
}

export function createUpdaterRuntime(deps: UpdaterDeps): UpdaterRuntime {
  const isPackaged = deps.isPackaged ?? app.isPackaged
  const currentVersion =
    deps.currentVersion ??
    resolveAppVersion(isPackaged, app.getVersion(), __APP_VERSION__)

  let status: UpdateStatus = isPackaged
    ? { phase: 'idle', currentVersion, lastCheckedAt: null }
    : { phase: 'unsupported', currentVersion }
  let timer: NodeJS.Timeout | null = null
  let initialTimer: NodeJS.Timeout | null = null

  function setStatus(next: UpdateStatus): void {
    status = next
    deps.broadcast(next)
  }

  if (!isPackaged) {
    // Nothing else in this module should run: no feed, no timers, no listeners.
    return {
      status: () => status,
      check: async () => status,
      download: async () => status,
      install: () => false,
      dispose: () => undefined
    }
  }

  function dispose(): void {
    if (timer !== null) clearInterval(timer)
    if (initialTimer !== null) clearTimeout(initialTimer)
    timer = null
    initialTimer = null
  }

  autoUpdater.autoDownload = false
  // Applying on quit would swap the app out from under a student who just
  // closed the window mid-session. The restart is always explicit.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) => {
    setStatus({
      phase: 'available',
      currentVersion,
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ phase: 'idle', currentVersion, lastCheckedAt: Date.now() })
  })

  autoUpdater.on('download-progress', (progress) => {
    const version = status.phase === 'available' || status.phase === 'downloading'
      ? status.version
      : currentVersion
    setStatus({
      phase: 'downloading',
      currentVersion,
      version,
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ phase: 'ready', currentVersion, version: info.version })
  })

  autoUpdater.on('error', (error: Error) => {
    console.error('[updater]', error)
    // No app-update.yml: this build was never wired to a release feed. Stop
    // checking rather than retry every 6 hours forever.
    if (isNoFeed(error.message)) {
      dispose()
      setStatus({ phase: 'unsupported', currentVersion })
      return
    }
    // Offline is the normal state of a laptop in a lecture hall, not a failure
    // worth a red toast.
    if (isOfflineish(error.message)) {
      setStatus({ phase: 'idle', currentVersion, lastCheckedAt: Date.now() })
      return
    }
    setStatus({
      phase: 'error',
      currentVersion,
      message: describeError(error.message)
    })
  })

  async function check(): Promise<UpdateStatus> {
    if (
      status.phase === 'downloading' ||
      status.phase === 'ready' ||
      // Feed already proven absent — retrying only re-logs the same ENOENT.
      status.phase === 'unsupported'
    ) {
      return status
    }
    setStatus({ phase: 'checking', currentVersion })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // The 'error' listener above already set the status; this catch only
      // stops the rejection from escaping.
      if (!(error instanceof Error)) {
        setStatus({ phase: 'idle', currentVersion, lastCheckedAt: Date.now() })
      }
    }
    return status
  }

  async function download(): Promise<UpdateStatus> {
    if (status.phase !== 'available' && status.phase !== 'error') {
      return status
    }
    try {
      await autoUpdater.downloadUpdate()
    } catch {
      // Reported through the 'error' listener.
    }
    return status
  }

  function install(): boolean {
    if (status.phase !== 'ready') {
      return false
    }
    // The CLI holds file handles under the install dir on Windows; a survivor
    // makes the NSIS updater fail to replace the app. Harmless on macOS.
    killAllClaudeProcessesSync()
    // isSilent=false so the student sees the NSIS progress; isForceRunAfter so
    // the app comes back up instead of just vanishing.
    autoUpdater.quitAndInstall(false, true)
    return true
  }

  initialTimer = setTimeout(() => {
    void check()
  }, INITIAL_CHECK_DELAY_MS)
  initialTimer.unref()

  timer = setInterval(() => {
    void check()
  }, RECHECK_INTERVAL_MS)
  timer.unref()

  return { status: () => status, check, download, install, dispose }
}
