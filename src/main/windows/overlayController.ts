import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { screen, type BrowserWindow } from 'electron'
import type { PushChannel, PushPayload } from '../../shared/ipc/events'
import type { OverlayState } from '../../shared/types/overlay'
import type { Settings } from '../../shared/types/settings'
import {
  clampOrbToArea,
  defaultOrbPosition,
  LEGACY_ORB_WINDOW_SIZE,
  normalizeOrbWindowBounds,
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

export type ManagedOverlayState = OverlayState & { desktopVisible: boolean }

export interface OverlayController {
  start(): void
  stop(): void
  isActive(): boolean
  getState(): ManagedOverlayState
  setCourse(courseId: string): ManagedOverlayState
  togglePopup(open?: boolean): { open: boolean }
  orbDragBegin(grab: { grabX: number; grabY: number }): void
  orbDragEnd(): void
  prompt(prompt: string): void
  openInApp(req: { courseId: string; conversationId: string | null }): void
  markQuitting(): void
  isQuitting(): boolean
  setScreenPermission(state: OverlayState['screenPermission']): void
  setOrbHitTest(hit: boolean): void
  syncMainWindowVisibility(): void
  concealForCapture(): () => void
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
  let desktopVisible = false
  let captureConcealments = 0
  let dragInterval: NodeJS.Timeout | null = null
  let dragTimeout: NodeJS.Timeout | null = null
  const conversations = new Map<string, string>()
  const observedMainWindows = new WeakSet<BrowserWindow>()

  const orbState = createWindowStateStore({
    file: join(deps.userDataPath, ORB_STATE_FILE),
    // Keep accepting the legacy 64px state long enough to migrate its centre.
    minWidth: LEGACY_ORB_WINDOW_SIZE,
    minHeight: LEGACY_ORB_WINDOW_SIZE
  })
  const popupState = createWindowStateStore({
    file: join(deps.userDataPath, POPUP_STATE_FILE),
    minWidth: POPUP_MIN_SIZE.width,
    minHeight: POPUP_MIN_SIZE.height
  })

  const courseId = (): string | null =>
    courseOverride ?? settings.lastActiveCourseId

  const conversationFor = (activeCourseId: string): string => {
    let conversationId = conversations.get(activeCourseId)
    if (conversationId === undefined) {
      conversationId = randomUUID()
      conversations.set(activeCourseId, conversationId)
    }
    return conversationId
  }

  const getState = (): ManagedOverlayState => {
    const activeCourseId = courseId()
    return {
      mode: settings.assistantMode,
      courseId: activeCourseId,
      conversationId:
        activeCourseId === null
          ? null
          : conversationFor(activeCourseId),
      popupOpen,
      screenPermission,
      desktopVisible
    }
  }

  const broadcastState = (): void => {
    deps.broadcast('overlay:state', getState())
  }

  const mainWindowIsActive = (): boolean => {
    const main = deps.getMainWindow()
    return (
      liveWindow(main) &&
      main.isVisible() &&
      !main.isMinimized() &&
      main.isFocused()
    )
  }

  const setDesktopVisible = (visible: boolean): boolean => {
    const next = visible && settings.assistantMode === 'desktop' && liveWindow(orb)
    if (liveWindow(orb)) {
      if (next) {
        if (!orb.isVisible()) orb.showInactive()
      } else if (orb.isVisible()) {
        orb.hide()
      }
    }
    if (desktopVisible === next) return false
    desktopVisible = next
    return true
  }

  const syncMainWindowVisibility = (): void => {
    const changed = setDesktopVisible(!mainWindowIsActive())
    if (changed) broadcastState()
  }

  const observeMainWindow = (main: BrowserWindow | null): void => {
    if (!liveWindow(main) || observedMainWindows.has(main)) return
    observedMainWindows.add(main)
    main.on('focus', syncMainWindowVisibility)
    main.on('show', syncMainWindowVisibility)
    main.on('restore', syncMainWindowVisibility)
    main.on('blur', syncMainWindowVisibility)
    main.on('minimize', syncMainWindowVisibility)
    main.on('hide', syncMainWindowVisibility)
    main.on('closed', syncMainWindowVisibility)
  }

  const setOverlayContentProtection = (protectedContent: boolean): void => {
    for (const win of [orb, popup]) {
      if (!liveWindow(win)) continue
      try {
        win.setContentProtection(protectedContent)
      } catch (error) {
        console.warn('[overlay] content protection is unsupported:', error)
      }
    }
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
    syncMainWindowVisibility()
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

    const fixedSize = normalizeOrbWindowBounds(saved)
    return clampOrbToArea(
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
    observeMainWindow(deps.getMainWindow())
    if (captureConcealments > 0) setOverlayContentProtection(true)
    loadOverlayView(orbWindow, 'orb')
    loadOverlayView(popupWindow, 'popup')
    syncMainWindowVisibility()
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
      desktopVisible = false
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
    desktopVisible = false
    if (liveWindow(popupWindow)) popupWindow.destroy()
    if (liveWindow(orbWindow)) orbWindow.destroy()
    broadcastState()
  }

  const setCourse = (nextCourseId: string): ManagedOverlayState => {
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
    const conversationId = conversationFor(activeCourseId)
    togglePopup(true)
    deps.broadcast('overlay:prompt', { conversationId, prompt: text })
  }

  const openInApp = (req: {
    courseId: string
    conversationId: string | null
  }): void => {
    const mappedConversationId = conversationFor(req.courseId)
    const conversationId = req.conversationId ?? mappedConversationId
    const existing = deps.getMainWindow()
    if (liveWindow(existing)) {
      observeMainWindow(existing)
      existing.show()
      existing.focus()
      syncMainWindowVisibility()
      existing.webContents.send('ui:openChat', {
        courseId: req.courseId,
        conversationId
      })
      return
    }

    const created = deps.createMainWindow()
    observeMainWindow(created)
    syncMainWindowVisibility()
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
    const clamped = clampOrbToArea(
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
    },
    setOrbHitTest(hit): void {
      if (!liveWindow(orb)) return
      if (hit) orb.setIgnoreMouseEvents(false)
      else orb.setIgnoreMouseEvents(true, { forward: true })
    },
    syncMainWindowVisibility(): void {
      observeMainWindow(deps.getMainWindow())
      syncMainWindowVisibility()
    },
    concealForCapture(): () => void {
      captureConcealments += 1
      if (captureConcealments === 1) setOverlayContentProtection(true)
      let restored = false
      return (): void => {
        if (restored) return
        restored = true
        captureConcealments = Math.max(0, captureConcealments - 1)
        if (captureConcealments === 0) setOverlayContentProtection(false)
      }
    }
  }
}
