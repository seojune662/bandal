import { describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/types/settings'
import type { BrowserWindow, Rectangle } from 'electron'
import type { OverlayControllerDeps } from '../../../src/main/windows/overlayController'

const electronMocks = vi.hoisted(() => ({
  screen: {
    getPrimaryDisplay: vi.fn(),
    getDisplayMatching: vi.fn(),
    getAllDisplays: vi.fn(),
    getCursorScreenPoint: vi.fn(),
    on: vi.fn()
  }
}))

const windowFactoryMocks = vi.hoisted(() => ({
  createOrbWindow: vi.fn(),
  createPopupWindow: vi.fn(),
  loadOverlayView: vi.fn()
}))

const storeMocks = vi.hoisted(() => ({
  orb: { read: vi.fn(), track: vi.fn(), save: vi.fn() },
  popup: { read: vi.fn(), track: vi.fn(), save: vi.fn() },
  createWindowStateStore: vi.fn()
}))

vi.mock('electron', () => ({ screen: electronMocks.screen }))
vi.mock('../../../src/main/windows/overlayWindow', () => windowFactoryMocks)
vi.mock('../../../src/main/windows/windowBounds', () => ({
  createWindowStateStore: storeMocks.createWindowStateStore
}))

import { createOverlayController } from '../../../src/main/windows/overlayController'

class FakeWebContents {
  readonly send = vi.fn()
  private readonly onceListeners = new Map<string, () => void>()

  once(event: string, listener: () => void): this {
    this.onceListeners.set(event, listener)
    return this
  }

  emit(event: string): void {
    const listener = this.onceListeners.get(event)
    this.onceListeners.delete(event)
    listener?.()
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents()
  readonly show = vi.fn(() => {
    this.visible = true
    this.emit('show')
  })
  readonly showInactive = vi.fn(() => {
    this.visible = true
  })
  readonly focus = vi.fn(() => {
    this.focused = true
    this.emit('focus')
  })
  readonly hide = vi.fn(() => {
    this.visible = false
    this.focused = false
    this.emit('hide')
  })
  readonly destroy = vi.fn(() => {
    this.destroyed = true
    this.visible = false
  })
  readonly setContentProtection = vi.fn()
  readonly setIgnoreMouseEvents = vi.fn()
  readonly setBounds = vi.fn((bounds: Rectangle) => {
    this.bounds = { ...bounds }
  })
  readonly setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y }
  })
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>()
  private destroyed = false
  private visible: boolean
  private focused: boolean
  private minimized = false

  constructor(private bounds: Rectangle, visible = true, focused = false) {
    this.visible = visible
    this.focused = focused
  }

  on(event: string, listener: (event: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isVisible(): boolean {
    return this.visible
  }

  isFocused(): boolean {
    return this.focused
  }

  isMinimized(): boolean {
    return this.minimized
  }

  blur(): void {
    this.focused = false
    this.emit('blur')
  }

  minimize(): void {
    this.minimized = true
    this.focused = false
    this.emit('minimize')
  }

  getBounds(): Rectangle {
    return { ...this.bounds }
  }

  getSize(): number[] {
    return [this.bounds.width, this.bounds.height]
  }
}

const AREA = { x: 0, y: 0, width: 1200, height: 900 }

function setup(initial: Settings): {
  controller: ReturnType<typeof createOverlayController>
  orb: FakeWindow
  popup: FakeWindow
  broadcast: ReturnType<typeof vi.fn>
  changeSettings(next: Settings): void
  setMainWindow(win: FakeWindow | null): void
  createdMain: FakeWindow
} {
  vi.clearAllMocks()
  let settings = initial
  let settingsListener: ((next: Settings) => void) | null = null
  let mainWindow: FakeWindow | null = null
  const orb = new FakeWindow(
    { x: 1052, y: 752, width: 240, height: 240 },
    false
  )
  const popup = new FakeWindow(
    { x: 736, y: 276, width: 400, height: 560 },
    false
  )
  const createdMain = new FakeWindow({ x: 0, y: 0, width: 1280, height: 800 })
  const broadcast = vi.fn()

  electronMocks.screen.getPrimaryDisplay.mockReturnValue({ workArea: AREA })
  electronMocks.screen.getDisplayMatching.mockReturnValue({ workArea: AREA })
  electronMocks.screen.getAllDisplays.mockReturnValue([{ workArea: AREA }])
  electronMocks.screen.getCursorScreenPoint.mockReturnValue({ x: 600, y: 500 })
  storeMocks.orb.read.mockReturnValue({ bounds: null, maximized: false })
  storeMocks.popup.read.mockReturnValue({ bounds: null, maximized: false })
  storeMocks.createWindowStateStore.mockImplementation(({ file }: { file: string }) =>
    file.includes('orb') ? storeMocks.orb : storeMocks.popup
  )
  windowFactoryMocks.createOrbWindow.mockReturnValue(orb as unknown as BrowserWindow)
  windowFactoryMocks.createPopupWindow.mockReturnValue(
    popup as unknown as BrowserWindow
  )

  const deps: OverlayControllerDeps = {
    getSettings: () => settings,
    onSettingsChanged: (listener) => {
      settingsListener = listener
      return () => undefined
    },
    broadcast,
    getMainWindow: () => mainWindow as unknown as BrowserWindow | null,
    createMainWindow: () => createdMain as unknown as BrowserWindow,
    preloadPath: '/preload.js',
    windowBackground: () => '#09101e',
    userDataPath: '/user-data'
  }

  return {
    controller: createOverlayController(deps),
    orb,
    popup,
    broadcast,
    changeSettings(next): void {
      settings = next
      settingsListener?.(next)
    },
    setMainWindow(win): void {
      mainWindow = win
    },
    createdMain
  }
}

function desktopSettings(courseId: string | null = 'course-a'): Settings {
  return {
    ...DEFAULT_SETTINGS,
    assistantMode: 'desktop',
    lastActiveCourseId: courseId
  }
}

describe('createOverlayController', () => {
  test('returns a stable conversation id per selected course before start', () => {
    const subject = setup(desktopSettings('course-a'))

    const first = subject.controller.getState().conversationId
    const repeated = subject.controller.getState().conversationId
    expect(first).toEqual(expect.any(String))
    expect(repeated).toBe(first)

    const other = subject.controller.setCourse('course-b').conversationId
    expect(other).toEqual(expect.any(String))
    expect(other).not.toBe(first)
    expect(subject.controller.setCourse('course-a').conversationId).toBe(first)
  })

  test('starts idempotently and destroys both overlay windows on stop', () => {
    const subject = setup(desktopSettings())

    subject.controller.start()
    subject.controller.start()
    expect(windowFactoryMocks.createOrbWindow).toHaveBeenCalledTimes(1)
    expect(windowFactoryMocks.createPopupWindow).toHaveBeenCalledTimes(1)
    expect(windowFactoryMocks.loadOverlayView.mock.calls).toEqual([
      [expect.anything(), 'orb'],
      [expect.anything(), 'popup']
    ])
    expect(subject.controller.isActive()).toBe(true)
    expect(subject.controller.getState().desktopVisible).toBe(true)
    expect(subject.orb.showInactive).toHaveBeenCalledOnce()

    expect(subject.controller.togglePopup(true)).toEqual({ open: true })
    expect(subject.popup.show).toHaveBeenCalledOnce()
    expect(subject.popup.focus).toHaveBeenCalledOnce()

    subject.controller.stop()
    expect(subject.orb.destroy).toHaveBeenCalledOnce()
    expect(subject.popup.destroy).toHaveBeenCalledOnce()
    expect(subject.controller.isActive()).toBe(false)
  })

  test('reuses one conversation per course and resets a local course override', () => {
    const subject = setup(desktopSettings())
    subject.controller.start()

    subject.controller.prompt('첫 질문')
    subject.controller.prompt('둘째 질문')
    const promptCalls = subject.broadcast.mock.calls.filter(
      ([channel]) => channel === 'overlay:prompt'
    )
    expect(promptCalls[0]?.[1].conversationId).toBe(
      promptCalls[1]?.[1].conversationId
    )

    subject.controller.setCourse('course-b')
    subject.controller.prompt('다른 과목')
    expect(promptCalls[0]?.[1].conversationId).not.toBe(
      subject.controller.getState().conversationId
    )

    subject.changeSettings({
      ...desktopSettings('course-c'),
      lastActiveCourseId: 'course-c'
    })
    expect(subject.controller.getState().courseId).toBe('course-c')
  })

  test('starts and stops when assistant mode flips through settings', () => {
    const subject = setup({ ...DEFAULT_SETTINGS, assistantMode: 'in-app' })
    subject.controller.start()
    expect(subject.controller.isActive()).toBe(false)

    subject.changeSettings(desktopSettings())
    expect(subject.controller.isActive()).toBe(true)
    expect(subject.controller.getState().mode).toBe('desktop')

    subject.changeSettings({ ...desktopSettings(), assistantMode: 'in-app' })
    expect(subject.controller.isActive()).toBe(false)
    expect(subject.controller.getState().mode).toBe('in-app')
  })

  test('hides the desktop orb while the visible main window is focused and restores it on blur', () => {
    const subject = setup(desktopSettings())
    const main = new FakeWindow(
      { x: 0, y: 0, width: 1280, height: 800 },
      true,
      true
    )
    subject.setMainWindow(main)

    subject.controller.start()
    expect(subject.controller.getState().desktopVisible).toBe(false)
    expect(subject.orb.showInactive).not.toHaveBeenCalled()

    main.blur()
    expect(subject.orb.showInactive).toHaveBeenCalledOnce()
    expect(subject.controller.getState().desktopVisible).toBe(true)

    main.focus()
    expect(subject.orb.hide).toHaveBeenCalledOnce()
    expect(subject.controller.getState().desktopVisible).toBe(false)
  })

  test('keeps an open desktop popup when the main window receives focus', () => {
    const subject = setup(desktopSettings())
    const main = new FakeWindow(
      { x: 0, y: 0, width: 1280, height: 800 },
      true,
      false
    )
    subject.setMainWindow(main)
    subject.controller.start()
    subject.controller.togglePopup(true)

    main.focus()

    expect(subject.popup.hide).not.toHaveBeenCalled()
    expect(subject.popup.isVisible()).toBe(true)
    expect(subject.controller.getState().popupOpen).toBe(true)
    expect(subject.controller.getState().desktopVisible).toBe(false)
  })

  test('switches the orb window between pass-through and interactive hit testing', () => {
    const subject = setup(desktopSettings())
    subject.controller.start()

    subject.controller.setOrbHitTest(true)
    subject.controller.setOrbHitTest(false)

    expect(subject.orb.setIgnoreMouseEvents.mock.calls).toEqual([
      [false],
      [true, { forward: true }]
    ])
  })

  test('conceals both overlay windows only until capture restoration', () => {
    const subject = setup(desktopSettings())
    subject.controller.start()

    const restore = subject.controller.concealForCapture()
    expect(subject.orb.setContentProtection).toHaveBeenLastCalledWith(true)
    expect(subject.popup.setContentProtection).toHaveBeenLastCalledWith(true)

    restore()
    expect(subject.orb.setContentProtection).toHaveBeenLastCalledWith(false)
    expect(subject.popup.setContentProtection).toHaveBeenLastCalledWith(false)
  })

  test('routes openInApp immediately or after a newly created window loads', () => {
    const subject = setup(desktopSettings())
    const existing = new FakeWindow({ x: 0, y: 0, width: 1280, height: 800 })
    subject.setMainWindow(existing)

    subject.controller.openInApp({
      courseId: 'course-a',
      conversationId: 'conversation-a'
    })
    expect(existing.show).toHaveBeenCalledOnce()
    expect(existing.focus).toHaveBeenCalledOnce()
    expect(existing.webContents.send).toHaveBeenCalledWith('ui:openChat', {
      courseId: 'course-a',
      conversationId: 'conversation-a'
    })

    subject.setMainWindow(null)
    subject.controller.openInApp({
      courseId: 'course-b',
      conversationId: 'conversation-b'
    })
    expect(subject.createdMain.webContents.send).not.toHaveBeenCalled()
    subject.createdMain.webContents.emit('did-finish-load')
    expect(subject.createdMain.webContents.send).toHaveBeenCalledWith(
      'ui:openChat',
      { courseId: 'course-b', conversationId: 'conversation-b' }
    )
  })
})
