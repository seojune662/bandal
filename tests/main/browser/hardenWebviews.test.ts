import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  openExternal: vi.fn(async () => undefined),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  showMessageBoxSync: vi.fn(() => 0)
}))

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'Bandal'),
    on: vi.fn()
  },
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
    getFocusedWindow: vi.fn(() => null)
  },
  dialog: {
    showMessageBox: electronMocks.showMessageBox,
    showMessageBoxSync: electronMocks.showMessageBoxSync
  },
  session: {
    fromPartition: vi.fn()
  },
  shell: {
    openExternal: electronMocks.openExternal
  }
}))

import { attachNavigationPolicies } from '../../../src/main/features/browser/hardenWebviews'

type Listener = (...args: any[]) => void

class FakeWebContents {
  readonly id = 701
  readonly send = vi.fn()
  readonly listeners = new Map<string, Listener[]>()
  windowOpenHandler: ((details: any) => any) | null = null

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  once(event: string, listener: Listener): this {
    return this.on(event, listener)
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  setWindowOpenHandler(handler: (details: any) => any): void {
    this.windowOpenHandler = handler
  }

  getURL(): string {
    return 'https://portal.example.com/course'
  }

  isDestroyed(): boolean {
    return false
  }
}

describe('attachNavigationPolicies', () => {
  beforeEach(() => vi.clearAllMocks())

  test('guards navigation on a standalone WebContents', () => {
    const webContents = new FakeWebContents()
    attachNavigationPolicies(webContents as unknown as Electron.WebContents, {
      openInTab: vi.fn()
    })

    const allowed = { preventDefault: vi.fn() }
    webContents.emit('will-navigate', allowed, 'https://example.com/lesson')
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    const denied = { preventDefault: vi.fn() }
    webContents.emit('will-redirect', denied, 'file:///Users/student/private')
    expect(denied.preventDefault).toHaveBeenCalledOnce()
  })

  test('denies a cross-site popup and forwards it through openInTab', () => {
    const webContents = new FakeWebContents()
    const openInTab = vi.fn()
    attachNavigationPolicies(webContents as unknown as Electron.WebContents, {
      openInTab
    })

    const result = webContents.windowOpenHandler?.({
      url: 'https://video.example.net/watch/42',
      disposition: 'foreground-tab',
      features: ''
    })

    expect(result).toEqual({ action: 'deny' })
    expect(openInTab).toHaveBeenCalledWith('https://video.example.net/watch/42')
  })
})
