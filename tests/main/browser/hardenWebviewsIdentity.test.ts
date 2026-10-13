import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserAuthProbeIdentity, BrowserAuthProbeMode } from '../../../src/main/features/browser/authProbe'

const electronMocks = vi.hoisted(() => ({ fromPartition: vi.fn(), getName: vi.fn(() => 'Bandal') }))
const settings = vi.hoisted(() => ({ browser: { popupBehavior: 'balanced', trackingProtection: 'balanced', doNotTrack: true } }))
vi.mock('electron', () => ({
  app: { getName: electronMocks.getName, on: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null), getFocusedWindow: vi.fn(() => null) },
  dialog: { showMessageBox: vi.fn(), showMessageBoxSync: vi.fn() },
  session: { fromPartition: electronMocks.fromPartition },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../../../src/main/settingsStore', () => ({
  getSettings: () => settings
}))
vi.mock('../../../src/main/features/browser/swipeNavigation', () => ({ installGestureSession: vi.fn(), navigateBySwipe: vi.fn() }))
vi.mock('../../../src/main/features/browser/displayMedia', () => ({ installDisplayMediaHandler: vi.fn() }))

import { forgetProfilePermissions, hardenBrowsingSession } from '../../../src/main/features/browser/hardenWebviews'
import { prepareGoogleAccountSiteNavigation, rememberGoogleAccountNavigation } from '../../../src/main/features/browser/googleAccountNavigation'
import { getBrowserAuthProbeIdentity, initializeBrowserAuthProbe } from '../../../src/main/features/browser/authProbe'

const userAgent = 'Mozilla/5.0 Bandal/0.80.0 Chrome/150.0.0.0 Electron/43.4.1 Safari/537.36'
const sessionFixture = () => ({
  getUserAgent: vi.fn(() => userAgent),
  setUserAgent: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
  setDevicePermissionHandler: vi.fn(),
  webRequest: { onBeforeRequest: vi.fn(), onBeforeSendHeaders: vi.fn() }
})
let directory: string
let browsingSession: ReturnType<typeof sessionFixture>
let partition = 0

beforeEach(() => {
  vi.clearAllMocks()
  settings.browser.trackingProtection = 'balanced'
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'bandal-native-identity-test-')))
  initializeBrowserAuthProbe({}, '', '')
  browsingSession = sessionFixture()
  electronMocks.fromPartition.mockReturnValue(browsingSession)
})
afterEach(() => {
  initializeBrowserAuthProbe({}, '', '')
  rmSync(directory, { recursive: true, force: true })
})

function probe(mode: BrowserAuthProbeMode, identity?: BrowserAuthProbeIdentity): void {
  const root = join(directory, 'probe')
  const installed = join(directory, 'installed')
  const userDataDir = join(root, 'user-data'), dataRoot = join(root, 'data')
  for (const path of [installed, userDataDir, dataRoot, join(root, 'application')]) mkdirSync(path, { recursive: true })
  const executablePath = join(root, 'application', 'Bandal')
  writeFileSync(executablePath, 'fixture')
  writeFileSync(join(root, 'probe.json'), JSON.stringify({
    version: 1, purpose: 'bandal-browser-auth-probe', mode,
    ...(identity ? { identity } : {}), root, userDataDir, dataRoot, executablePath
  }))
  initializeBrowserAuthProbe({
    BANDAL_BROWSER_AUTH_PROBE: mode,
    ...(identity ? { BANDAL_BROWSER_AUTH_PROBE_IDENTITY: identity } : {}),
    BANDAL_BROWSER_AUTH_PROBE_ROOT: root,
    BANDAL_BROWSER_AUTH_PROBE_LAUNCH_ID: '11111111-2222-4333-8444-555555555555',
    BANDAL_USER_DATA_DIR: userDataDir, BANDAL_DATA_ROOT: dataRoot
  }, installed, executablePath)
}
const harden = () => hardenBrowsingSession(`persist:identity-regression-${++partition}`)

function expectInheritedIdentity(): void {
  expect(browsingSession.setUserAgent).not.toHaveBeenCalled()
  expect(browsingSession.getUserAgent).not.toHaveBeenCalled()
  expect(electronMocks.getName).not.toHaveBeenCalled()
}

function expectSecurityHandlers(): void {
  expect(browsingSession.setPermissionRequestHandler).toHaveBeenCalledOnce()
  expect(browsingSession.setPermissionCheckHandler).toHaveBeenCalledOnce()
  expect(browsingSession.setDevicePermissionHandler).toHaveBeenCalledOnce()
  const permission = browsingSession.setPermissionRequestHandler.mock.calls[0]![0]
  const answer = vi.fn()
  permission(null, 'usb', answer, {})
  expect(answer).toHaveBeenCalledExactlyOnceWith(false)
  const check = browsingSession.setPermissionCheckHandler.mock.calls[0]![0]
  expect(check(null, 'storage-access', 'https://accounts.google.com')).toBe(true)
  expect(check(null, 'usb', 'https://accounts.google.com')).toBe(false)
  expect(browsingSession.setDevicePermissionHandler.mock.calls[0]![0]()).toBe(false)
  const beforeRequest = browsingSession.webRequest.onBeforeRequest.mock.calls[0]![1]
  const result = vi.fn()
  beforeRequest({ url: 'file:///private/fixture', resourceType: 'mainFrame', referrer: '' }, result)
  expect(result).toHaveBeenCalledExactlyOnceWith({ cancel: true })
  const beforeHeaders = browsingSession.webRequest.onBeforeSendHeaders.mock.calls[0]![1]
  const headers = vi.fn()
  beforeHeaders({ requestHeaders: { Accept: 'text/html' } }, headers)
  expect(headers).toHaveBeenCalledExactlyOnceWith({ requestHeaders: { Accept: 'text/html', DNT: '1', 'Sec-GPC': '1' } })
  // Authentication and ordinary navigation keep both inherited identity surfaces;
  // neither a provider-specific UA nor stripped Client Hints may be introduced.
  for (const url of ['https://accounts.google.com/', 'https://portal.yonsei.ac.kr/']) {
    const identityHeaders = { 'User-Agent': userAgent, 'sec-ch-ua': '"Chromium";v="150"', 'sec-ch-ua-platform': '"macOS"' }
    headers.mockClear()
    beforeHeaders({ url, requestHeaders: identityHeaders }, headers)
    expect(headers).toHaveBeenCalledExactlyOnceWith({ requestHeaders: { ...identityHeaders, DNT: '1', 'Sec-GPC': '1' } })
  }
}

for (const mode of ['product', 'clean'] as const) {
  test.each(['product', 'native', undefined] as const)(`${mode} instrumentation with %s identity does not override the boot identity`, identity => {
    probe(mode, identity)
    harden()
    expect(getBrowserAuthProbeIdentity()).toBe(identity ?? 'product')
    expectInheritedIdentity()
    expectSecurityHandlers()
  })
}

test.each(['persist:browsing', 'persist:bandal-profile-identity', 'bandal-private', 'bandal-profile-identity-private'])(
  'ordinary app partition %s inherits the boot identity and preserves security', partitionName => {
    forgetProfilePermissions([partitionName])
    hardenBrowsingSession(partitionName)
    expect(electronMocks.fromPartition).toHaveBeenCalledExactlyOnceWith(partitionName)
    expectInheritedIdentity()
    expectSecurityHandlers()
    // A reused partition must retain the same unmodified session.
    hardenBrowsingSession(partitionName)
    expect(electronMocks.fromPartition).toHaveBeenCalledOnce()
    expectInheritedIdentity()
    forgetProfilePermissions([partitionName])
  }
)

test('a native identity environment flag without a validated probe cannot change the ordinary app UA', () => {
  initializeBrowserAuthProbe({ BANDAL_BROWSER_AUTH_PROBE_IDENTITY: 'native' }, directory, '')
  harden()
  expect(getBrowserAuthProbeIdentity()).toBeNull()
  expectInheritedIdentity()
  expectSecurityHandlers()
})

test('limits native request interception to local files, known trackers, and YouTube viewing pages', () => {
  harden()
  const [filter, beforeRequest] = browsingSession.webRequest.onBeforeRequest.mock.calls[0]!
  expect(filter.urls).toContain('file://*/*')
  expect(filter.urls).toContain('*://*.doubleclick.net/*')
  expect(filter.urls).toContain('*://*.doubleclick.net./*')
  expect(filter.urls).toContain('*://*.adsrvr.org/*')
  expect(filter.urls).not.toContain('<all_urls>')
  expect(filter.urls).not.toContain('*://*/*')
  expect(filter.urls).not.toContain('http://*/*')
  expect(filter.urls).not.toContain('https://*/*')
  expect(filter.urls).toContain('https://www.youtube.com/')
  expect(filter.urls).toContain('https://www.youtube.com/?*')
  expect(filter.urls).not.toContain('https://www.youtube.com/*')

  const result = vi.fn()
  beforeRequest({ url: 'https://ad.doubleclick.net/track', resourceType: 'script', referrer: 'https://www.youtube.com/' }, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: true })
  beforeRequest({ url: 'https://doubleclick.net/', resourceType: 'mainFrame', referrer: 'https://example.com/' }, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: false })
  beforeRequest({ url: 'https://doubleclick.net/script.js', resourceType: 'script', referrer: 'https://doubleclick.net/' }, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: false })

  const extraTracker = { url: 'https://pixel.adsrvr.org/track', resourceType: 'image', referrer: 'https://www.youtube.com/' }
  beforeRequest(extraTracker, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: false })
  settings.browser.trackingProtection = 'strict'
  beforeRequest(extraTracker, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: true })
  settings.browser.trackingProtection = 'off'
  beforeRequest(extraTracker, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: false })
  beforeRequest({ url: 'file:///private/fixture', resourceType: 'image', referrer: 'https://www.youtube.com/' }, result)
  expect(result).toHaveBeenLastCalledWith({ cancel: true })
  expect(browsingSession.webRequest.onBeforeRequest).toHaveBeenCalledOnce()
})

test('a marked original native YouTube request is redirected once before network loading', () => {
  harden()
  const page = {}, source = 'https://www.google.com/?authuser=1', url = 'https://www.youtube.com/'
  rememberGoogleAccountNavigation(browsingSession, source)
  prepareGoogleAccountSiteNavigation(page, source, url)
  const callback = vi.fn(), beforeRequest = browsingSession.webRequest.onBeforeRequest.mock.calls[0]![1]
  beforeRequest({ url, method: 'GET', resourceType: 'mainFrame', referrer: source, webContents: page }, callback)
  expect(callback).toHaveBeenLastCalledWith({ redirectURL: 'https://www.youtube.com/?authuser=1' })
  beforeRequest({ url, method: 'GET', resourceType: 'mainFrame', referrer: source, webContents: page }, callback)
  expect(callback).toHaveBeenLastCalledWith({ cancel: false })
})

test('clean auth probes do not add native account-navigation interception', () => {
  probe('clean')
  harden()
  const [filter, beforeRequest] = browsingSession.webRequest.onBeforeRequest.mock.calls[0]!
  expect(filter.urls).not.toContain('https://www.youtube.com/')
  const page = {}, source = 'https://www.google.com/?authuser=1', url = 'https://www.youtube.com/'
  rememberGoogleAccountNavigation(browsingSession, source)
  prepareGoogleAccountSiteNavigation(page, source, url)
  const callback = vi.fn()
  beforeRequest({ url, method: 'GET', resourceType: 'mainFrame', referrer: source, webContents: page }, callback)
  expect(callback).toHaveBeenCalledWith({ cancel: false })
})
