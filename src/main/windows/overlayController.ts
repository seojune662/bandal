import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { screen, type BrowserWindow } from 'electron'
import type { PushChannel, PushPayload } from '../../shared/ipc/events'
import type { OverlayState } from '../../shared/types/overlay'
import type { Settings } from '../../shared/types/settings'
import {
  clampToArea,
  defaultOrbPosition,
  ORB_WINDOW_SIZE,
  orbPositionFromCursor,
  placePopup,
  POPUP_DEFAULT_SIZE,
  POPUP_MIN_SIZE,
  type Rect
} from './overlayGeometry'
import {
  createOrbWindow,
  createPopupWindow,
  loadOverlayView
} from './overlayWindow'
import {
  createWindowStateStore
} from './windowBounds'

const ORB_STATE_FILE = 'overlay-orb-state.json'
const POPUP_STATE_FILE = 'overlay-popup-state.json'
const DRAG_POLL_MS = 16
const DRAG_TIMEOUT_MS = 10_000

export interface OverlayControllerDeps {
  getSettings(): Settings
  onSettingsChanged(cb: (s: Settings) => void): () => void
  broadcast<K extends PushChannel>(channel: K, payload: PushPayload<K>): void
  getMainWindow(): BrowserWindow | null
  createMainWindow(): BrowserWindow
  preloadPath: string
  windowBackground(): string
  userDataPath: string
}

export interface OverlayController {
  start(): void
  stop(): void
  isActive(): boolean
  getState(): OverlayState
  setCourse(courseId: string): OverlayState
  togglePopup(open?: boolean): { open: boolean }
  orbDragBegin(grab: { grabX: number; grabY: number }): void
  orbDragEnd(): void
  prompt(prompt: string): void
  openInApp(req: { courseId: string; conversationId: string | null }): void
  markQuitting(): void
  isQuitting(): boolean
  setScreenPermission(state: OverlayState['screenPermission']): void
}

function liveWindow(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed()
}

export function createOverlayController(
  deps: OverlayControllerDeps
): OverlayController {
  let settings = deps.getSettings()
  let courseOverride: string | null = null
  let orb: BrowserWindow | null = null
  let popup: BrowserWindow | null = null
  let popupOpen = false
  let quitting = false
  let screenPermission: OverlayState['screenPermission'] = 'unknown'
  let dragInterval: NodeJS.Timeout | null = null
  let dragTimeout: NodeJS.Timeout | null = null
  const conversations = new Map<string, string>()

  const orbState = createWindowStateStore({
    file: join(deps.userDataPath, ORB_STATE_FILE),
    minWidth: ORB_WINDOW_SIZE,
    minHeight: ORB_WINDOW_SIZE
  })
  const popupState = createWindowStateStore({
    file: join(deps.userDataPath, POPUP_STATE_FILE),
    minWidth: POPUP_MIN_SIZE.width,
    minHeight: POPUP_MIN_SIZE.height
  })

  const courseId = (): string | null =>
    courseOverride ?? settings.lastActiveCourseId

  const getState = (): OverlayState => {
    const activeCourseId = courseId()
    return {
      mode: settings.assistantMode,
      courseId: activeCourseId,
      conversationId:
        activeCourseId === null
          ? null
          : (conversations.get(activeCourseId) ?? null),
      popupOpen,
      screenPermission
    }
  }

  const broadcastState = (): void => {
    deps.broadcast('overlay:state', getState())
  }

  const saveOrbBounds = (): void => {
    if (!liveWindow(orb)) return
    orbState.save({ bounds: orb.getBounds(), maximized: false })
  }

  const savePopupBounds = (): void => {
    if (!liveWindow(popup)) return
    popupState.save({ bounds: popup.getBounds(), maximized: false })
  }

  const orbDragEnd = (): void => {
    if (dragInterval === null && dragTimeout === null) return
    if (dragInterval !== null) clearInterval(dragInterval)
    if (dragTimeout !== null) clearTimeout(dragTimeout)
    dragInterval = null
    dragTimeout = null
    saveOrbBounds()
  }

  const positionPopup = (): void => {
    if (!liveWindow(orb) || !liveWindow(popup)) return
    const orbBounds = orb.getBounds()
    const size = popup.getSize()
    const width = size[0]!
    const height = size[1]!
    const workArea = screen.getDisplayMatching(orbBounds).workArea
    popup.setBounds(placePopup(orbBounds, { width, height }, workArea))
  }

  const togglePopup = (open?: boolean): { open: boolean } => {
    const desired = open ?? !popupOpen
    if (!liveWindow(popup) || !liveWindow(orb)) {
      popupOpen = false
      broadcastState()
      return { open: false }
    }

    if (desired) {
      positionPopup()
      popup.show()
      popup.focus()
      popupOpen = true
    } else {
      popup.hide()
      popupOpen = false
    }
    broadcastState()
    return { open: popupOpen }
  }

  const attachWindowLifetimes = (
    orbWindow: BrowserWindow,
    popupWindow: BrowserWindow
  ): void => {
    orbWindow.on('blur', orbDragEnd)
    orbWindow.on('hide', orbDragEnd)
    orbWindow.on('close', (event) => {
      if (!quitting) event.preventDefault()
    })

    popupWindow.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      togglePopup(false)
    })
  }

  const initialOrbBounds = (): Rect => {
    const saved = orbState.read().bounds
    if (saved === null) {
      const area = screen.getPrimaryDisplay().workArea
      return {
        ...defaultOrbPosition(area),
        width: ORB_WINDOW_SIZE,
        height: ORB_WINDOW_SIZE
      }
    }

    const fixedSize = {
      x: saved.x,
      y: saved.y,
      width: ORB_WINDOW_SIZE,
      height: ORB_WINDOW_SIZE
    }
    return clampToArea(
      fixedSize,
      screen.getDisplayMatching(fixedSize).workArea
    )
  }

  const isActive = (): boolean => liveWindow(orb) && liveWindow(popup)

  const startWindows = (): void => {
    if (settings.assistantMode !== 'desktop' || isActive()) return

    const orbBounds = initialOrbBounds()
    const savedPopup = popupState.read().bounds
    const popupSize = {
      width: savedPopup?.width ?? POPUP_DEFAULT_SIZE.width,
      height: savedPopup?.height ?? POPUP_DEFAULT_SIZE.height
    }
    const popupBounds = placePopup(
      orbBounds,
      popupSize,
      screen.getDisplayMatching(orbBounds).workArea
    )

    const orbWindow = createOrbWindow({
      position: { x: orbBounds.x, y: orbBounds.y },
      preload: deps.preloadPath
    })
    const popupWindow = createPopupWindow({
      bounds: popupBounds,
      preload: deps.preloadPath,
      backgroundColor: deps.windowBackground()
    })
    orb = orbWindow
    popup = popupWindow
    popupOpen = false

    orbState.track(orbWindow)
    popupState.track(popupWindow)
    attachWindowLifetimes(orbWindow, popupWindow)
    loadOverlayView(orbWindow, 'orb')
    loadOverlayView(popupWindow, 'popup')
    broadcastState()
  }

  const start = (): void => {
    settings = deps.getSettings()
    startWindows()
  }

  const stop = (): void => {
    orbDragEnd()
    if (!liveWindow(orb) && !liveWindow(popup)) {
      popupOpen = false
      broadcastState()
      return
    }

    saveOrbBounds()
    savePopupBounds()
    const orbWindow = orb
    const popupWindow = popup
    orb = null
    popup = null
    popupOpen = false
    if (liveWindow(popupWindow)) popupWindow.destroy()
    if (liveWindow(orbWindow)) orbWindow.destroy()
    broadcastState()
  }

  const setCourse = (nextCourseId: string): OverlayState => {
    courseOverride = nextCourseId
    broadcastState()
    return getState()
  }

  const orbDragBegin = (grab: { grabX: number; grabY: number }): void => {
    if (!liveWindow(orb)) return
    orbDragEnd()
    const dragGrab = { x: grab.grabX, y: grab.grabY }

    const updatePosition = (): void => {
      if (!liveWindow(orb) || !orb.isVisible()) {
        orbDragEnd()
        return
      }
      const position = orbPositionFromCursor(
        screen.getCursorScreenPoint(),
        dragGrab,
        screen.getAllDisplays().map((display) => display.workArea)
      )
      orb.setPosition(position.x, position.y)
    }

    dragInterval = setInterval(updatePosition, DRAG_POLL_MS)
    dragTimeout = setTimeout(orbDragEnd, DRAG_TIMEOUT_MS)
    updatePosition()
  }

  const prompt = (text: string): void => {
    const activeCourseId = courseId()
    if (activeCourseId === null) return
    let conversationId = conversations.get(activeCourseId)
    if (conversationId === undefined) {
      conversationId = randomUUID()
      conversations.set(activeCourseId, conversationId)
    }
    togglePopup(true)
    deps.broadcast('overlay:prompt', { conversationId, prompt: text })
  }

  const openInApp = (req: {
    courseId: string
    conversationId: string | null
  }): void => {
    const existing = deps.getMainWindow()
    if (liveWindow(existing)) {
      existing.show()
      existing.focus()
      if (req.conversationId !== null) {
        existing.webContents.send('ui:openChat', {
          courseId: req.courseId,
          conversationId: req.conversationId
        })
      }
      return
    }

    const created = deps.createMainWindow()
    const conversationId = req.conversationId
    if (conversationId === null) return
    created.webContents.once('did-finish-load', () => {
      if (!created.isDestroyed()) {
        created.webContents.send('ui:openChat', {
          courseId: req.courseId,
          conversationId
        })
      }
    })
  }

  const reclampOrb = (): void => {
    if (!liveWindow(orb)) return
    const current = orb.getBounds()
    const clamped = clampToArea(
      {
        x: current.x,
        y: current.y,
        width: ORB_WINDOW_SIZE,
        height: ORB_WINDOW_SIZE
      },
      screen.getDisplayMatching(current).workArea
    )
    if (clamped.x !== current.x || clamped.y !== current.y) {
      orb.setPosition(clamped.x, clamped.y)
      saveOrbBounds()
    }
  }

  deps.onSettingsChanged((next) => {
    const previous = settings
    settings = next
    const courseChanged =
      next.lastActiveCourseId !== previous.lastActiveCourseId
    if (courseChanged) courseOverride = null

    if (next.assistantMode !== previous.assistantMode) {
      if (next.assistantMode === 'desktop') startWindows()
      else stop()
      return
    }
    if (courseChanged) broadcastState()
  })
  screen.on('display-removed', reclampOrb)
  screen.on('display-metrics-changed', reclampOrb)

  return {
    start,
    stop,
    isActive,
    getState,
    setCourse,
    togglePopup,
    orbDragBegin,
    orbDragEnd,
    prompt,
    openInApp,
    markQuitting(): void {
      quitting = true
    },
    isQuitting(): boolean {
      return quitting
    },
    setScreenPermission(state): void {
      screenPermission = state
      broadcastState()
    }
  }
}
