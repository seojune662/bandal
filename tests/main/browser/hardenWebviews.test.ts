import { beforeEach, describe, expect, test, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn<() => Electron.BrowserWindow | null>(() => null),
  openExternal: vi.fn(async () => undefined),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  showMessageBoxSync: vi.fn(() => 0)
}))
const settingsMocks = vi.hoisted(() => ({
  keybindings: {} as Record<string, string | null>
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

vi.mock('../../../src/main/settingsStore', () => ({
  getSettings: () => ({ keybindings: settingsMocks.keybindings, browser: { popupBehavior: 'balanced' } })
}))

import {
  attachGuestInput,
  attachNavigationPolicies,
  forwardBrowserSwipe,
  popupWebPreferences
} from '../../../src/main/features/browser/hardenWebviews'
import { googleAccountRequestUrl, rememberGoogleAccountNavigation } from '../../../src/main/features/browser/googleAccountNavigation'

type Listener = (...args: any[]) => void

class FakeWebContents {
  constructor(readonly id = 701) {}
  readonly send = vi.fn()
  readonly focus = vi.fn()
  readonly sendInputEvent = vi.fn()
  readonly insertCSS = vi.fn(async () => 'page-input-style')
  readonly listeners = new Map<string, Listener[]>()
  windowOpenHandler: ((details: any) => any) | null = null

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  once(event: string, listener: Listener): this {
    return this.on(event, listener)
  }

  removeListener(event: string, listener: Listener): this {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter(candidate => candidate !== listener))
    return this
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
  beforeEach(() => {
    vi.clearAllMocks()
    settingsMocks.keybindings = {}
  })

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

  test('attaches input protection once and restores it for a replacement document', () => {
    const page = new FakeWebContents()
    const options = { openInTab: vi.fn() }
    attachNavigationPolicies(page as unknown as Electron.WebContents, options)
    attachNavigationPolicies(page as unknown as Electron.WebContents, options)
    expect(page.insertCSS).toHaveBeenCalledOnce()
    expect(page.insertCSS).toHaveBeenCalledWith(expect.any(String), { cssOrigin: 'user' })
    page.emit('dom-ready')
    expect(page.insertCSS).toHaveBeenCalledTimes(2)
  })

  test.each([
    { certificates: [] },
    { certificates: [{ subjectName: 'Student', issuerName: 'University' }] },
    { certificates: [
      { subjectName: 'Student', issuerName: 'University' },
      { subjectName: 'Other', issuerName: 'University' }
    ] }
  ])('settles a declined client certificate request for $certificates', async ({ certificates }) => {
    const page = new FakeWebContents()
    attachNavigationPolicies(page as unknown as Electron.WebContents, { openInTab: vi.fn() })
    const event = { preventDefault: vi.fn() }, callback = vi.fn()
    page.emit('select-client-certificate', event, page.getURL(), certificates, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith())
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  test('settles a failed client certificate dialog without asserting an identity', async () => {
    electronMocks.showMessageBox.mockRejectedValueOnce(new Error('Window closed'))
    const page = new FakeWebContents(), callback = vi.fn()
    attachNavigationPolicies(page as unknown as Electron.WebContents, { openInTab: vi.fn() })
    page.emit('select-client-certificate', { preventDefault: vi.fn() }, page.getURL(),
      [{ subjectName: 'Student', issuerName: 'University' }], callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith())
  })

  test('sends only the selected client certificate', async () => {
    electronMocks.showMessageBox.mockResolvedValueOnce({ response: 2 })
    const page = new FakeWebContents(), callback = vi.fn()
    attachNavigationPolicies(page as unknown as Electron.WebContents, { openInTab: vi.fn() })
    const certificates = [
      { subjectName: 'Student', issuerName: 'University' },
      { subjectName: 'Other', issuerName: 'University' }
    ]
    page.emit('select-client-certificate', { preventDefault: vi.fn() }, page.getURL(), certificates, callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledExactlyOnceWith(certificates[1]))
  })

  test('preserves a cross-site popup including its original POST request', () => {
    const webContents = new FakeWebContents()
    const openInTab = vi.fn()
    attachNavigationPolicies(webContents as unknown as Electron.WebContents, {
      openInTab
    })

    const result = webContents.windowOpenHandler?.({
      url: 'https://video.example.net/watch/42',
      disposition: 'foreground-tab',
      features: '',
      postBody: { data: [{ type: 'rawData', bytes: Buffer.from('state=test') }] }
    })

    expect(result.action).toBe('allow')
    expect(result.overrideBrowserWindowOptions.webPreferences.partition).toBe('persist:browsing')
    expect(openInTab).not.toHaveBeenCalled()
  })

  test('marks Google links, but not redirect/history replays, for native account handoff', () => {
    const page = new FakeWebContents(), session = {}
    page.getURL = () => 'https://www.google.com/?authuser=1'
    attachNavigationPolicies(page as unknown as Electron.WebContents, { openInTab: vi.fn() })
    const url = 'https://www.youtube.com/'
    const request = { url, method: 'GET', resourceType: 'mainFrame' }
    rememberGoogleAccountNavigation(session, page.getURL())
    page.emit('will-redirect', { preventDefault: vi.fn() }, url)
    expect(googleAccountRequestUrl(session, page, request)).toBe(url)
    page.emit('will-navigate', { preventDefault: vi.fn() }, url)
    expect(googleAccountRequestUrl(session, page, request)).toBe(`${url}?authuser=1`)
  })

  test('marks an adopted Google popup without replacing its original opener or request', () => {
    const parent = new FakeWebContents(), child = new FakeWebContents(), session = {}
    parent.getURL = () => 'https://www.google.com/?authuser=1'
    child.getURL = () => ''
    const createTab = vi.fn(() => {
      attachNavigationPolicies(child as unknown as Electron.WebContents, { openInTab: vi.fn() })
      return child as unknown as Electron.WebContents
    })
    attachNavigationPolicies(parent as unknown as Electron.WebContents, { openInTab: vi.fn(), createTab })
    const details = { url: 'https://www.youtube.com/', disposition: 'foreground-tab', features: '' }
    const result = parent.windowOpenHandler!(details)
    const options = { webContents: child }
    expect(result.action).toBe('allow')
    expect(result.createWindow(options)).toBe(child)
    expect(createTab).toHaveBeenCalledExactlyOnceWith(options, details)
    expect(child.insertCSS).toHaveBeenCalledOnce()
    child.emit('will-navigate', { preventDefault: vi.fn() }, details.url)
    rememberGoogleAccountNavigation(session, parent.getURL())
    expect(googleAccountRequestUrl(session, child, { url: details.url, method: 'GET', resourceType: 'mainFrame' }))
      .toBe('https://www.youtube.com/?authuser=1')
  })
})

describe('attachGuestInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.fromWebContents.mockReturnValue(null)
    settingsMocks.keybindings = {}
  })

  function input(guest: FakeWebContents, overrides: Record<string, unknown> = {}): ReturnType<typeof vi.fn> {
    const event = { preventDefault: vi.fn() }
    guest.emit('before-input-event', event, {
      type: 'keyDown', key: 't', code: 'KeyT', meta: true, control: false,
      alt: false, shift: false, isAutoRepeat: false, ...overrides
    })
    return event.preventDefault
  }

  test.each(['darwin', 'win32'] as const)('focuses the host before forwarding native T into its DOM input stream on %s', platform => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, platform)
    const modifiers = { meta: platform === 'darwin', control: platform !== 'darwin' }
    const prevented = input(guest, modifiers)
    expect(prevented).toHaveBeenCalledOnce()
    expect(host.focus).toHaveBeenCalledOnce()
    expect(host.sendInputEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'keyDown', keyCode: 'T', modifiers: [platform === 'darwin' ? 'meta' : 'control']
    })
    expect(prevented.mock.invocationCallOrder[0]).toBeLessThan(host.focus.mock.invocationCallOrder[0]!)
    expect(host.focus.mock.invocationCallOrder[0]).toBeLessThan(host.sendInputEvent.mock.invocationCallOrder[0]!)
    expect(host.send).not.toHaveBeenCalled()
    // Host keydowns must remain DOM-owned. Preventing them in main would
    // suppress every following keyup in Chromium, including the modifier.
    expect(host.listeners.get('before-input-event')).toBeUndefined()
    expect(input(host, modifiers)).not.toHaveBeenCalled()
    expect(input(host, { type: 'keyUp', key: platform === 'darwin' ? 'Meta' : 'Control', meta: false })).not.toHaveBeenCalled()
  })

  test('normalizes physical Korean T and consumes guest auto-repeat without forwarding it', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, 'darwin')
    input(guest, { key: 'ㅅ' })
    expect(input(guest, { key: 'ㅅ', isAutoRepeat: true })).toHaveBeenCalledOnce()
    expect(host.focus).toHaveBeenCalledOnce()
    expect(host.sendInputEvent).toHaveBeenCalledExactlyOnceWith({ type: 'keyDown', keyCode: 'T', modifiers: ['meta'] })
    expect(host.send).not.toHaveBeenCalled()
  })

  test('a remapped guest new-tab chord keeps legacy IPC and does not synthesize T', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, 'darwin')
    settingsMocks.keybindings = { 'new-tab': 'mod+alt+n' }
    expect(input(guest, { key: 'n', code: 'KeyN', alt: true })).toHaveBeenCalledOnce()
    expect(host.send).toHaveBeenCalledExactlyOnceWith('shortcut:passthrough', { action: 'new-tab', webContentsId: guest.id })
    expect(host.focus).not.toHaveBeenCalled()
    expect(host.sendInputEvent).not.toHaveBeenCalled()
  })

  test('does not cycle nonplatform modifiers or a reassigned T command', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, 'darwin')
    input(guest, { meta: false, control: true })
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', { action: 'new-tab', webContentsId: guest.id })
    settingsMocks.keybindings = { 'new-tab': 'mod+alt+n', 'new-ai-tab': 'mod+t' }
    input(guest)
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', { action: 'new-ai-tab', webContentsId: guest.id })
  })

  test('resolves the latest settings keymap for every guest keydown', () => {
    const host = new FakeWebContents()
    const guest = new FakeWebContents()
    attachGuestInput(
      host as unknown as Electron.WebContents,
      guest as unknown as Electron.WebContents
    )

    settingsMocks.keybindings = { 'new-tab': 'mod+alt+n' }
    const firstEvent = { preventDefault: vi.fn() }
    guest.emit('before-input-event', firstEvent, {
      type: 'keyDown',
      key: 'n',
      meta: true,
      control: false,
      alt: true,
      shift: false
    })
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', {
      action: 'new-tab',
      webContentsId: guest.id
    })

    settingsMocks.keybindings = { 'new-tab': 'mod+shift+k' }
    const staleEvent = { preventDefault: vi.fn() }
    guest.emit('before-input-event', staleEvent, {
      type: 'keyDown',
      key: 'n',
      meta: true,
      control: false,
      alt: true,
      shift: false
    })
    expect(staleEvent.preventDefault).not.toHaveBeenCalled()

    const nextEvent = { preventDefault: vi.fn() }
    guest.emit('before-input-event', nextEvent, {
      type: 'keyDown',
      key: 'k',
      meta: true,
      control: false,
      alt: false,
      shift: true
    })
    expect(nextEvent.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('forwardBrowserSwipe', () => {
  test('maps macOS horizontal swipes for the focused webview guest', () => {
    const host = {
      send: vi.fn(),
      isDestroyed: () => false
    } as unknown as Electron.WebContents
    const guest = {
      id: 702,
      getType: () => 'webview'
    } as unknown as Electron.WebContents

    forwardBrowserSwipe(host, guest, 'right', 'darwin')
    forwardBrowserSwipe(host, guest, 'left', 'darwin')

    expect(host.send).toHaveBeenNthCalledWith(1, 'shortcut:passthrough', {
      action: 'browser-back',
      webContentsId: 702
    })
    expect(host.send).toHaveBeenNthCalledWith(2, 'shortcut:passthrough', {
      action: 'browser-forward',
      webContentsId: 702
    })
  })

  test('ignores a focused host page and non-macOS swipes', () => {
    const host = {
      send: vi.fn(),
      isDestroyed: () => false
    } as unknown as Electron.WebContents
    const page = {
      id: 703,
      getType: () => 'window'
    } as unknown as Electron.WebContents

    forwardBrowserSwipe(host, page, 'right', 'darwin')
    forwardBrowserSwipe(host, page, 'left', 'win32')

    expect(host.send).not.toHaveBeenCalled()
  })
})


test('browser frames load the isolated gesture preload while keeping sandboxed page worlds', () => {
  const preferences = popupWebPreferences('fixture-browser-session')
  expect(preferences).toMatchObject({
    partition: 'fixture-browser-session',
    nodeIntegration: false,
    nodeIntegrationInSubFrames: true,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  })
  expect(preferences.preload).toBeUndefined()
})
