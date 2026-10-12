import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserAuthProbeIdentity, BrowserAuthProbeMode } from '../../../src/main/features/browser/authProbe'

const electronMocks = vi.hoisted(() => ({ fromPartition: vi.fn(), getName: vi.fn(() => 'Bandal') }))
vi.mock('electron', () => ({
  app: { getName: electronMocks.getName, on: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null), getFocusedWindow: vi.fn(() => null) },
  dialog: { showMessageBox: vi.fn(), showMessageBoxSync: vi.fn() },
  session: { fromPartition: electronMocks.fromPartition },
  shell: { openExternal: vi.fn() }
}))
vi.mock('../../../src/main/settingsStore', () => ({
  getSettings: () => ({ browser: { popupBehavior: 'balanced', trackingProtection: 'balanced', doNotTrack: true } })
}))
vi.mock('../../../src/main/features/browser/swipeNavigation', () => ({ installGestureSession: vi.fn(), navigateBySwipe: vi.fn() }))
vi.mock('../../../src/main/features/browser/displayMedia', () => ({ installDisplayMediaHandler: vi.fn() }))

import { hardenBrowsingSession } from '../../../src/main/features/browser/hardenWebviews'
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
}

test.each(['product', 'clean'] as const)('%s instrumentation with validated native identity never overrides the session UA', mode => {
  probe(mode, 'native')
  harden()
  expect(getBrowserAuthProbeIdentity()).toBe('native')
  expect(browsingSession.setUserAgent).not.toHaveBeenCalled()
  expect(browsingSession.getUserAgent).not.toHaveBeenCalled()
  expect(electronMocks.getName).not.toHaveBeenCalled()
  expectSecurityHandlers()
})

test.each(['product', 'clean'] as const)('%s instrumentation retains existing product UA behavior for explicit and legacy identity', mode => {
  probe(mode, 'product')
  harden()
  expect(browsingSession.setUserAgent).toHaveBeenCalledExactlyOnceWith('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36')
  expectSecurityHandlers()
  // A fresh legacy launcher marker has no identity setting at all.
  rmSync(join(directory, 'probe'), { recursive: true, force: true })
  probe(mode)
  browsingSession.setUserAgent.mockClear()
  harden()
  expect(browsingSession.setUserAgent).toHaveBeenCalledExactlyOnceWith('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36')
})

test('a native identity environment flag without a validated probe cannot change the ordinary app UA', () => {
  initializeBrowserAuthProbe({ BANDAL_BROWSER_AUTH_PROBE_IDENTITY: 'native' }, directory, '')
  harden()
  expect(getBrowserAuthProbeIdentity()).toBeNull()
  expect(browsingSession.setUserAgent).toHaveBeenCalledExactlyOnceWith('Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36')
  expectSecurityHandlers()
})
