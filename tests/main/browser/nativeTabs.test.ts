import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ host: null as any, view: null as any, created: vi.fn(), appOn: vi.fn(), cleanProbe: false }))
vi.mock('electron', () => ({
  app: { on: mocks.appOn, quit: vi.fn() }, dialog: { showMessageBoxSync: vi.fn() },
  BrowserWindow: { fromWebContents: () => mocks.host },
  WebContentsView: class { constructor() { mocks.created(); return mocks.view } }
}))
vi.mock('../../../src/main/features/browser/profiles', () => ({
  prepareProfileSession: async () => {}, profilePartition: () => 'fixture-profile',
  registerGuestProfile: vi.fn(), forgetGuestProfile: vi.fn(), resetBrowserProfileQuit: vi.fn()
}))
vi.mock('../../../src/main/features/browser/hardenWebviews', () => ({ attachGuestInput: vi.fn(), attachNavigationPolicies: vi.fn(), popupWebPreferences: () => ({}) }))
vi.mock('../../../src/main/features/browser/swipeNavigation', () => ({ installSwipeNavigation: vi.fn() }))
vi.mock('../../../src/main/features/browser/popupLifecycle', () => ({ trackTabDownload: vi.fn() }))
vi.mock('../../../src/main/features/browser/pageClose', () => ({ closePage: vi.fn(async () => true) }))
vi.mock('../../../src/main/features/browser/authProbe', () => ({ isCleanBrowserAuthProbe: () => mocks.cleanProbe }))

const image = (url = 'data:image/png;base64,fixture') => ({ isEmpty: () => false, toDataURL: () => url })
class Page extends EventEmitter {
  id = 401
  session = {}
  mainFrame = {}
  capturePage = vi.fn(async (_rect?: unknown, _options?: unknown) => image())
  focus = vi.fn()
  close = vi.fn()
  loadURL = vi.fn()
  executeJavaScript = vi.fn(async () => 'script-result')
  getURL = () => 'about:blank'
  getTitle = () => 'Retained fixture'
  isLoadingMainFrame = () => false
  isDestroyed = () => false
  isFocused = () => false
  getZoomFactor = () => 1
  navigationHistory = { canGoBack: () => false, canGoForward: () => false }
  send = vi.fn()
}
class View {
  visible = false
  webContents = new Page()
  setVisible = vi.fn((visible: boolean) => { this.visible = visible })
  getVisible = () => this.visible
  setBounds = vi.fn()
}
class Host extends EventEmitter {
  webContents = new Page()
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  isDestroyed = () => false
  isVisible = () => true
  isMinimized = () => false
  getContentSize = () => [900, 700]
  close = vi.fn()
}
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.cleanProbe = false; mocks.view = new View(); mocks.host = new Host() })
const bounds = { x: 20, y: 40, width: 640, height: 420 }
async function fixture() {
  const native = await import('../../../src/main/features/browser/nativeTabs')
  native.registerBrowserHost(mocks.host)
  const event = { sender: mocks.host.webContents, senderFrame: mocks.host.webContents.mainFrame } as Electron.IpcMainInvokeEvent
  await native.createBrowserPage(event, { tabId: 'retained', courseId: 'source', isPrivate: false })
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null })
  mocks.view.setVisible.mockClear()
  return { native, event, page: mocks.view.webContents as Page, view: mocks.view as View }
}

test('native focus is forwarded only for a visible page', async () => {
  const { native, event, page } = await fixture()
  mocks.host.webContents.send.mockClear()
  page.emit('focus')
  expect(mocks.host.webContents.send).not.toHaveBeenCalled()
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  page.emit('focus')
  expect(mocks.host.webContents.send).toHaveBeenCalledWith('browser:page-event', expect.objectContaining({
    tabId: 'retained', name: 'focus', detail: { webContentsId: page.id }
  }))
})

test('a visible Google account change hands off to the next explicit YouTube navigation once', async () => {
  const { native, event, page } = await fixture()
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  page.emit('did-navigate', {}, 'https://www.google.com/?authuser=0', 200)
  page.emit('did-navigate-in-page', {}, 'https://www.google.com/?authuser=1', true)
  await native.browserPageAction(event, { tabId: 'retained', action: 'loadURL', args: ['https://www.youtube.com/'] })
  expect(page.loadURL).toHaveBeenLastCalledWith('https://www.youtube.com/?authuser=1')
  page.emit('did-navigate', {}, 'https://www.youtube.com/?authuser=1', 200)
  await native.browserPageAction(event, { tabId: 'retained', action: 'loadURL', args: ['https://www.youtube.com/'] })
  expect(page.loadURL).toHaveBeenLastCalledWith('https://www.youtube.com/')
})

test('hidden pages and subframes cannot replace the selected Google account', async () => {
  const { native, event, page } = await fixture()
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  page.emit('did-navigate', {}, 'https://www.google.com/?authuser=1', 200)
  page.emit('did-navigate-in-page', {}, 'https://www.google.com/?authuser=0', false)
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null })
  page.emit('did-navigate', {}, 'https://www.google.com/?authuser=0', 200)
  await native.browserPageAction(event, { tabId: 'retained', action: 'loadURL', args: ['https://www.youtube.com/'] })
  expect(page.loadURL).toHaveBeenLastCalledWith('https://www.youtube.com/?authuser=1')
})

test('the clean auth probe never adds account navigation hints', async () => {
  const { native, event, page } = await fixture()
  mocks.cleanProbe = true
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  page.emit('did-navigate', {}, 'https://www.google.com/?authuser=1', 200)
  await native.browserPageAction(event, { tabId: 'retained', action: 'loadURL', args: ['https://www.youtube.com/'] })
  expect(page.loadURL).toHaveBeenLastCalledWith('https://www.youtube.com/')
})

test('the clean authentication probe rejects page scripts while preserving ordinary navigation', async () => {
  const { native, event, page } = await fixture()
  mocks.cleanProbe = true
  await expect(native.browserPageAction(event, { tabId: 'retained', action: 'executeJavaScript', args: ['document.title'] }))
    .rejects.toThrow('Page scripts are disabled')
  expect(page.executeJavaScript).not.toHaveBeenCalled()
  await native.browserPageAction(event, { tabId: 'retained', action: 'loadURL', args: ['https://accounts.google.com/'] })
  expect(page.loadURL).toHaveBeenCalledWith('https://accounts.google.com/')
  mocks.cleanProbe = false
  expect(await native.browserPageAction(event, { tabId: 'retained', action: 'executeJavaScript', args: ['document.title'] })).toBe('script-result')
})

test('mouse presses select a visible native pane even when OS focus does not change', async () => {
  const { native, event, page } = await fixture()
  const mouseEvent = { preventDefault: vi.fn() }
  mocks.host.webContents.send.mockClear()
  page.emit('before-mouse-event', mouseEvent, { type: 'mouseDown', button: 'left', x: 20, y: 40 })
  expect(mocks.host.webContents.send).not.toHaveBeenCalled()
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  page.emit('before-mouse-event', mouseEvent, { type: 'mouseMove', x: 20, y: 40 })
  expect(mocks.host.webContents.send).not.toHaveBeenCalled()
  page.emit('before-mouse-event', mouseEvent, { type: 'mouseDown', button: 'left', x: 20, y: 40 })
  expect(mocks.host.webContents.send).toHaveBeenCalledWith('browser:page-event', expect.objectContaining({
    tabId: 'retained', name: 'focus', detail: { webContentsId: page.id }
  }))
  expect(mouseEvent.preventDefault).not.toHaveBeenCalled()
})

test('an already hidden destination captures a preview without showing, focusing, recreating or navigating its native page', async () => {
  const { native, event, page, view } = await fixture()
  expect(view.getVisible()).toBe(false)
  expect(await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })).toEqual({ snapshot: 'data:image/png;base64,fixture' })
  expect(page.capturePage).toHaveBeenCalledExactlyOnceWith(undefined, { stayHidden: true })
  expect(view.setVisible.mock.calls.every(([visible]) => visible === false)).toBe(true)
  expect(page.focus).not.toHaveBeenCalled()
  expect(page.loadURL).not.toHaveBeenCalled()
  expect(page.close).not.toHaveBeenCalled()
  expect(mocks.created).toHaveBeenCalledOnce()
  expect(view.webContents).toBe(page)
})

test('hidden requests reuse one capture and showing the real page invalidates its prior preview', async () => {
  const { native, event, page, view } = await fixture()
  let finish!: (value: ReturnType<typeof image>) => void
  page.capturePage.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const first = native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  const second = native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  expect(page.capturePage).toHaveBeenCalledOnce()
  finish(image()); expect(await first).toEqual(await second)
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  expect(page.capturePage).toHaveBeenCalledOnce()
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  expect(view.getVisible()).toBe(true)
  native.setBrowserHostOccluded(event, true)
  expect(view.getVisible()).toBe(false)
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  expect(page.capturePage).toHaveBeenCalledTimes(2)
})

test.each(['empty', 'reject', 'throw'] as const)('a %s capture returns null once and the next hidden request can retry', async failure => {
  const { native, event, page, view } = await fixture()
  if (failure === 'empty') page.capturePage.mockResolvedValueOnce({ isEmpty: () => true, toDataURL: () => '' })
  else if (failure === 'reject') page.capturePage.mockRejectedValueOnce(new Error('capture interrupted'))
  else page.capturePage.mockImplementationOnce(() => { throw new Error('capture unavailable') })
  expect(await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })).toEqual({ snapshot: null })
  expect(page.capturePage).toHaveBeenCalledOnce()
  expect(await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })).toEqual({ snapshot: 'data:image/png;base64,fixture' })
  expect(page.capturePage).toHaveBeenCalledTimes(2)
  expect(view.getVisible()).toBe(false)
})

test('a late failed capture cannot erase the newer preview after visibility changes', async () => {
  const { native, event, page } = await fixture()
  let old!: (value: ReturnType<typeof image>) => void, fresh!: (value: ReturnType<typeof image>) => void
  page.capturePage.mockReturnValueOnce(new Promise(resolve => { old = resolve })).mockReturnValueOnce(new Promise(resolve => { fresh = resolve }))
  const previous = native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  const current = native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })
  old({ isEmpty: () => true, toDataURL: () => '' }); await previous
  fresh(image('data:image/png;base64,new')); await current
  expect(await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })).toEqual({ snapshot: 'data:image/png;base64,new' })
  expect(page.capturePage).toHaveBeenCalledTimes(2)
})


test('host occlusion skips unused hidden pages; only their explicit preview request captures them', async () => {
  const { native, event, page, view } = await fixture()
  native.setBrowserHostOccluded(event, true)
  expect(view.getVisible()).toBe(false)
  expect(page.capturePage).not.toHaveBeenCalled()
  expect(await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null, preview: true })).toEqual({ snapshot: 'data:image/png;base64,fixture' })
  expect(page.capturePage).toHaveBeenCalledExactlyOnceWith(undefined, { stayHidden: true })
  native.setBrowserHostOccluded(event, true)
  expect(page.capturePage).toHaveBeenCalledOnce()
})

test('switching an adopted login popup permits recreating its tab in the chosen profile', async () => {
  const { native, event } = await fixture()
  const { attachNavigationPolicies } = await import('../../../src/main/features/browser/hardenWebviews')
  const { closePage } = await import('../../../src/main/features/browser/pageClose')
  const popup = new View()
  popup.webContents.id = 402
  mocks.view = popup
  const policy = vi.mocked(attachNavigationPolicies).mock.calls[0]![1]
  policy.createTab!({}, { url: 'https://accounts.google.com/signin', disposition: 'foreground-tab' } as Electron.HandlerDetails)
  const request = mocks.host.webContents.send.mock.calls.find((call: unknown[]) => call[0] === 'browser:open-url')![1]
  vi.mocked(closePage).mockImplementationOnce(async contents => { (contents as unknown as Page).emit('destroyed'); return true })
  expect(await native.prepareProfileSwitch(event, request.tabId)).toEqual({ allowed: true })
  expect(mocks.host.webContents.send.mock.calls.some((call: unknown[]) => call[0] === 'browser:close-tab')).toBe(false)
  const replacement = new View()
  replacement.webContents.id = 403
  mocks.view = replacement
  expect(await native.createBrowserPage(event, { tabId: request.tabId, courseId: null, isPrivate: false, profileId: 'personal' })).toMatchObject({ state: { id: 403 }, adopted: false })
})


test('swipes require both the native page and its host window to remain visible', async () => {
  const { native, event, page } = await fixture()
  const { installSwipeNavigation } = await import('../../../src/main/features/browser/swipeNavigation')
  const [target, available] = vi.mocked(installSwipeNavigation).mock.calls[0]!
  expect(target).toBe(page)
  expect(available()).toBe(false)
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds })
  expect(available()).toBe(true)
  const host = mocks.host as Host
  host.isMinimized = () => true
  expect(available()).toBe(false)
  host.isMinimized = () => false
  host.isVisible = () => false
  expect(available()).toBe(false)
  host.isVisible = () => true
  expect(available()).toBe(true)
  host.isDestroyed = () => true
  expect(available()).toBe(false)
  host.isDestroyed = () => false
  await native.setBrowserPageBounds(event, { tabId: 'retained', bounds: null })
  expect(available()).toBe(false)
})
