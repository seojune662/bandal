import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserWindow, Rectangle } from 'electron'
import type { MiniPlayerDeps } from '../../../src/main/windows/miniPlayerController'

const electronMocks = vi.hoisted(() => ({
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 }
    }))
  }
}))

const windowFactoryMocks = vi.hoisted(() => ({
  createLocalPipWindow: vi.fn(),
  createWebPipWindow: vi.fn(),
  loadLocalPipView: vi.fn(),
  MINI_PLAYER_DEFAULT_SIZE: { width: 480, height: 270 },
  MINI_PLAYER_MIN_SIZE: { width: 240, height: 135 }
}))

const toolbarMocks = vi.hoisted(() => ({
  createMiniPlayerToolbar: vi.fn()
}))

const storeMocks = vi.hoisted(() => ({
  store: {
    read: vi.fn(() => ({ bounds: null, maximized: false })),
    track: vi.fn(),
    save: vi.fn()
  },
  createWindowStateStore: vi.fn()
}))

vi.mock('electron', () => ({ screen: electronMocks.screen }))
vi.mock('../../../src/main/windows/miniPlayerWindow', () => windowFactoryMocks)
vi.mock('../../../src/main/windows/miniPlayerToolbar', () => toolbarMocks)
vi.mock('../../../src/main/windows/windowBounds', () => ({
  createWindowStateStore: storeMocks.createWindowStateStore
}))

import { createMiniPlayerController } from '../../../src/main/windows/miniPlayerController'

type Listener = (...args: any[]) => void

class FakeWebContents {
  readonly send = vi.fn()
  readonly executeJavaScript = vi.fn((script: string) =>
    Promise.resolve(
      script.includes('video.currentTime : null') ? this.polledPosition : true
    )
  )
  private readonly listeners = new Map<
    string,
    Array<{ listener: Listener; once: boolean }>
  >()
  private destroyed = false
  polledPosition = 0

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { listener, once: false }
    ])
    return this
  }

  once(event: string, listener: Listener): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { listener, once: true }
    ])
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    const entries = [...(this.listeners.get(event) ?? [])]
    this.listeners.set(
      event,
      entries.filter((entry) => !entry.once)
    )
    for (const entry of entries) entry.listener(...args)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  markDestroyed(): void {
    this.destroyed = true
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents()
  readonly show = vi.fn()
  readonly showInactive = vi.fn()
  readonly setAspectRatio = vi.fn()
  readonly setPosition = vi.fn((x: number, y: number) => {
    this.bounds = { ...this.bounds, x, y }
  })
  readonly loadURL = vi.fn(async () => undefined)
  readonly close = vi.fn(() => this.attemptClose())
  readonly destroy = vi.fn(() => {
    this.destroyed = true
    this.webContents.markDestroyed()
  })
  private readonly listeners = new Map<
    string,
    Array<{ listener: Listener; once: boolean }>
  >()
  private destroyed = false
  private bounds: Rectangle = { x: 936, y: 606, width: 480, height: 270 }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { listener, once: false }
    ])
    return this
  }

  once(event: string, listener: Listener): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { listener, once: true }
    ])
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    const entries = [...(this.listeners.get(event) ?? [])]
    this.listeners.set(
      event,
      entries.filter((entry) => !entry.once)
    )
    for (const entry of entries) entry.listener(...args)
  }

  attemptClose(): { preventDefault: ReturnType<typeof vi.fn> } {
    let prevented = false
    const event = {
      preventDefault: vi.fn(() => {
        prevented = true
      })
    }
    this.emit('close', event)
    if (!prevented) {
      this.destroyed = true
      this.webContents.markDestroyed()
      this.emit('closed')
    }
    return event
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getBounds(): Rectangle {
    return { ...this.bounds }
  }
}

const LOCAL_SOURCE = {
  kind: 'local' as const,
  courseId: 'course-a',
  relPath: 'week 1/lecture.mp4',
  title: 'Lecture'
}
const WEB_SOURCE = {
  kind: 'web' as const,
  url: 'https://www.youtube.com/watch?v=video42',
  title: 'Web lecture'
}

function setup(localWindows: FakeWindow[] = [new FakeWindow()]): {
  controller: ReturnType<typeof createMiniPlayerController>
  broadcast: ReturnType<typeof vi.fn>
  toolbar: FakeWindow
} {
  const broadcast = vi.fn()
  const toolbar = new FakeWindow()
  const queue = [...localWindows]
  const nextWindow = (): BrowserWindow =>
    (queue.shift() ?? new FakeWindow()) as unknown as BrowserWindow

  windowFactoryMocks.createLocalPipWindow.mockImplementation(nextWindow)
  windowFactoryMocks.createWebPipWindow.mockImplementation(nextWindow)
  toolbarMocks.createMiniPlayerToolbar.mockReturnValue(
    toolbar as unknown as BrowserWindow
  )
  storeMocks.createWindowStateStore.mockReturnValue(storeMocks.store)

  const deps: MiniPlayerDeps = {
    preloadPath: '/preload.js',
    userDataPath: '/user-data',
    windowBackground: () => '#111827',
    broadcast,
    openInTab: vi.fn()
  }
  return {
    controller: createMiniPlayerController(deps),
    broadcast,
    toolbar
  }
}

describe('createMiniPlayerController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeMocks.store.read.mockReturnValue({ bounds: null, maximized: false })
  })

  afterEach(() => vi.useRealTimers())

  test('blocks incidental closes but lets close() pass', () => {
    const window = new FakeWindow()
    const subject = setup([window])
    subject.controller.open({
      source: LOCAL_SOURCE,
      positionSec: 12,
      playbackRate: 1.25
    })

    const incidental = window.attemptClose()
    expect(incidental.preventDefault).toHaveBeenCalledOnce()
    expect(subject.controller.isAlive()).toBe(true)

    subject.controller.close()
    expect(window.close).toHaveBeenCalledOnce()
    expect(subject.controller.getState()).toEqual({
      open: false,
      source: null,
      positionSec: 0,
      playbackRate: 1
    })
  })

  test('replaces an existing player with a newly created variant', () => {
    const first = new FakeWindow()
    const second = new FakeWindow()
    const subject = setup([first, second])

    subject.controller.open({
      source: LOCAL_SOURCE,
      positionSec: 3,
      playbackRate: 1
    })
    subject.controller.open({
      source: WEB_SOURCE,
      positionSec: 40,
      playbackRate: 1.5
    })

    expect(first.close).toHaveBeenCalledOnce()
    expect(windowFactoryMocks.createWebPipWindow).toHaveBeenCalledOnce()
    expect(subject.controller.getState()).toMatchObject({
      open: true,
      source: WEB_SOURCE,
      positionSec: 40,
      playbackRate: 1.5
    })
  })

  test('restores local playback with the last renderer report and allows close', () => {
    const window = new FakeWindow()
    const subject = setup([window])
    subject.controller.open({
      source: LOCAL_SOURCE,
      positionSec: 10,
      playbackRate: 1
    })
    subject.controller.report({
      positionSec: 81.5,
      playbackRate: 1.75,
      paused: false,
      aspect: 4 / 3
    })

    subject.controller.restore()

    expect(subject.broadcast).toHaveBeenCalledWith('ui:openMaterial', {
      courseId: 'course-a',
      relPath: 'week 1/lecture.mp4',
      positionSec: 81.5,
      playbackRate: 1.75
    })
    expect(window.setAspectRatio).toHaveBeenLastCalledWith(4 / 3)
    expect(window.close).toHaveBeenCalledOnce()
  })

  test('uses the latest web poll for restore and appends a YouTube t query', async () => {
    vi.useFakeTimers()
    const window = new FakeWindow()
    window.webContents.polledPosition = 92.25
    const subject = setup([window])
    subject.controller.open({
      source: WEB_SOURCE,
      positionSec: 31.9,
      playbackRate: 1.25,
      paused: false
    })

    expect(window.loadURL).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=video42&t=31'
    )
    window.webContents.emit('did-finish-load')
    await vi.advanceTimersByTimeAsync(3_000)
    subject.controller.restore()

    expect(subject.broadcast).toHaveBeenCalledWith('ui:openUrl', {
      url: WEB_SOURCE.url,
      positionSec: 92.25,
      playbackRate: 1.25
    })
    expect(subject.toolbar.destroy).toHaveBeenCalledOnce()
  })

  test('sends local seek after load and markQuitting allows native close', () => {
    const window = new FakeWindow()
    const subject = setup([window])
    subject.controller.open({
      source: LOCAL_SOURCE,
      positionSec: 18,
      playbackRate: 2,
      paused: true
    })

    window.webContents.emit('did-finish-load')
    expect(subject.broadcast).toHaveBeenCalledWith('pip:seek', {
      positionSec: 18,
      playbackRate: 2,
      play: false
    })

    subject.controller.markQuitting()
    const closeEvent = window.attemptClose()
    expect(closeEvent.preventDefault).not.toHaveBeenCalled()
    expect(subject.controller.isAlive()).toBe(false)
  })

  test('moves the active player by the toolbar drag delta', () => {
    const window = new FakeWindow()
    const subject = setup([window])
    subject.controller.open({
      source: WEB_SOURCE,
      positionSec: 0,
      playbackRate: 1
    })

    subject.controller.moveBy(12.4, -8.6)

    expect(window.setPosition).toHaveBeenCalledWith(948, 597)
  })
})
