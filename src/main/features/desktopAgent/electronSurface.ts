import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  screen,
  systemPreferences,
  type Display,
  type NativeImage
} from 'electron'
import { probeExec } from '../agent/platform'
import type {
  DesktopSurfaceDeps,
  DisplayInfo,
  RawCapture,
  ScreenAccess,
  WindowInfo
} from './desktopSurface'
import { fitWithin } from './image'
import { frontmostMac, frontmostWin, type FrontmostApp } from './platformProbes'

const OS_PROBE_TIMEOUT_MS = 3_000

function displayInfo(display: Display, primaryId: number): DisplayInfo {
  return {
    id: String(display.id),
    label: display.label,
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId
  }
}

function thumbnailSize(display: Display, maxLongEdgePx: number) {
  return fitWithin(
    display.bounds.width * display.scaleFactor,
    display.bounds.height * display.scaleFactor,
    maxLongEdgePx
  )
}

function rawCapture(image: NativeImage): RawCapture | null {
  if (image.isEmpty()) return null
  const size = image.getSize()
  return {
    width: size.width,
    height: size.height,
    toJPEG: (quality) => image.toJPEG(quality)
  }
}

async function execProbe(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await probeExec(cmd, args, {
    timeoutMs: OS_PROBE_TIMEOUT_MS
  })
  return stdout
}

function ownWindowTitles(): Set<string> {
  return new Set(
    BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed())
      .map((window) => window.getTitle())
      .filter((title) => title !== '')
  )
}

function isOwnWindow(title: string, titles: Set<string>): boolean {
  return (
    title.startsWith('Bandal') ||
    title.startsWith('반달') ||
    titles.has(title)
  )
}

export function createElectronDesktopDeps(): DesktopSurfaceDeps {
  async function frontmostApp(): Promise<FrontmostApp | null> {
    if (process.platform === 'darwin') return frontmostMac(execProbe)
    if (process.platform === 'win32') return frontmostWin(execProbe)
    return null
  }

  return {
    listDisplays() {
      const primaryId = screen.getPrimaryDisplay().id
      return screen
        .getAllDisplays()
        .map((display) => displayInfo(display, primaryId))
    },

    cursorDisplayId() {
      return String(
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
      )
    },

    async captureDisplay(displayId, maxLongEdgePx) {
      const display = screen
        .getAllDisplays()
        .find((candidate) => String(candidate.id) === displayId)
      if (display === undefined) return null

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbnailSize(display, maxLongEdgePx),
        fetchWindowIcons: false
      })
      const source = sources.find(
        (candidate) => String(candidate.display_id) === String(display.id)
      )
      return source === undefined ? null : rawCapture(source.thumbnail)
    },

    async captureWindow(windowId, maxLongEdgePx) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: thumbnailSize(display, maxLongEdgePx),
        fetchWindowIcons: false
      })
      const source = sources.find((candidate) => candidate.id === windowId)
      return source === undefined ? null : rawCapture(source.thumbnail)
    },

    async listWindows(): Promise<WindowInfo[]> {
      const [sources, foreground] = await Promise.all([
        desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false
        }),
        frontmostApp()
      ])
      const titles = ownWindowTitles()
      let foregroundMetadataAssigned = false

      return sources
        .filter((source) => !isOwnWindow(source.name, titles))
        .map((source) => {
          // Electron exposes the window title but not its owning app. The OS
          // probe can safely enrich the foreground window; other app names
          // remain unknown rather than presenting their titles as app names.
          const matchesForeground =
            !foregroundMetadataAssigned &&
            foreground !== null &&
            (foreground.windowTitle === source.name ||
              (foreground.windowTitle === null &&
                foreground.appName === source.name))
          const appName = matchesForeground ? foreground.appName : null
          const frontmost =
            foreground !== null &&
            appName === foreground.appName
          if (matchesForeground) foregroundMetadataAssigned = true
          return {
            id: source.id,
            title: source.name,
            appName,
            frontmost
          }
        })
    },

    frontmostApp,

    readClipboardText() {
      return clipboard.readText()
    },

    screenAccess(): ScreenAccess {
      if (process.platform === 'darwin') {
        return systemPreferences.getMediaAccessStatus('screen')
      }
      if (process.platform === 'win32') return 'granted'
      return 'unknown'
    }
  }
}
