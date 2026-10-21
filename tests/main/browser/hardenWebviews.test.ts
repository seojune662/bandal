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
  readonly id = 701
  readonly send = vi.fn()
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

  test.each(['darwin', 'win32'] as const)('cycles each distinct T press and commits only on modifier release on %s', platform => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, platform)
    const modifiers = { meta: platform === 'darwin', control: platform !== 'darwin' }
    expect(input(guest, modifiers)).toHaveBeenCalledOnce()
    input(guest, { ...modifiers, isAutoRepeat: true })
    expect(host.send).toHaveBeenCalledExactlyOnceWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'advance', webContentsId: guest.id
    })
    input(guest, { ...modifiers, type: 'keyUp' })
    expect(host.send).toHaveBeenCalledTimes(1)
    input(guest, modifiers)
    expect(host.send).toHaveBeenCalledTimes(2)
    input(guest, { type: 'keyUp', key: platform === 'darwin' ? 'Meta' : 'Control', code: platform === 'darwin' ? 'MetaLeft' : 'ControlLeft', meta: false, control: false })
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'commit', webContentsId: guest.id
    })
    input(guest, { type: 'keyUp', key: 'Meta', meta: false })
    expect(host.send).toHaveBeenCalledTimes(3)
  })

  test('accepts the physical T key with a Korean layout and follows focus to the host renderer', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents()
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, 'darwin')
    input(guest, { key: 'ㅅ' })
    guest.emit('blur')
    expect(host.send).toHaveBeenCalledExactlyOnceWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'advance', webContentsId: guest.id
    })
    input(host, { type: 'keyUp', key: 'Meta', code: 'MetaLeft', meta: false })
    // The host renderer handles its own release. Do not queue a duplicate
    // commit that could accidentally confirm the following key sequence.
    expect(host.send).toHaveBeenCalledTimes(1)
    input(guest, { type: 'keyUp', key: 'Meta', meta: false })
    guest.emit('destroyed')
    expect(host.send).toHaveBeenCalledTimes(1)
  })

  test('Escape and actual window blur cancel without creating a tab on later release', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents(), owner = new FakeWebContents()
    electronMocks.fromWebContents.mockReturnValue(owner as unknown as Electron.BrowserWindow)
    attachGuestInput(host as unknown as Electron.WebContents, guest as unknown as Electron.WebContents, undefined, 'darwin')
    input(guest)
    expect(input(guest, { key: 'Escape', code: 'Escape' })).toHaveBeenCalledOnce()
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'cancel', webContentsId: guest.id
    })
    input(guest, { type: 'keyUp', key: 'Meta', meta: false })
    expect(host.send).toHaveBeenCalledTimes(2)
    input(guest)
    owner.emit('blur')
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'cancel', webContentsId: guest.id
    })
    input(host, { type: 'keyUp', key: 'Meta', meta: false })
    expect(host.send).toHaveBeenCalledTimes(4)
    host.emit('destroyed')
    expect(owner.listeners.get('blur')).toHaveLength(0)
  })

  test('uses one host observer across native pages and cancels when the initiating page closes', () => {
    const host = new FakeWebContents(), guest = new FakeWebContents(), other = new FakeWebContents()
    for (const page of [guest, other]) attachGuestInput(host as unknown as Electron.WebContents, page as unknown as Electron.WebContents, undefined, 'darwin')
    expect(host.listeners.get('before-input-event')).toHaveLength(1)
    input(guest)
    other.emit('destroyed')
    expect(host.send).toHaveBeenCalledTimes(1)
    guest.emit('destroyed')
    expect(host.send).toHaveBeenLastCalledWith('shortcut:passthrough', {
      action: 'new-tab', newTabCycle: 'cancel', webContentsId: guest.id
    })
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
