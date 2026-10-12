import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSER_AUTH_PROBE_NATIVE_IDENTITY_CAPABILITY, browserAuthProbeArguments, getBrowserAuthProbeIdentity, getBrowserAuthProbeMode, initializeBrowserAuthProbe, isCleanBrowserAuthProbe, validateBrowserAuthProbe } from '../../../src/main/features/browser/authProbe'

let root: string, installed: string, executablePath: string, env: NodeJS.ProcessEnv
let marker: Record<string, unknown>
const writeMarker = (): void => writeFileSync(join(root, 'probe.json'), JSON.stringify(marker))
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bandal-auth-probe-test-')))
  installed = join(root, 'installed-profile')
  mkdirSync(installed)
  const probeRoot = join(root, 'probe')
  mkdirSync(probeRoot)
  root = probeRoot
  mkdirSync(join(root, 'user-data'))
  mkdirSync(join(root, 'data'))
  mkdirSync(join(root, 'application'))
  executablePath = join(root, 'application', 'Bandal')
  writeFileSync(executablePath, 'fixture')
  env = { BANDAL_BROWSER_AUTH_PROBE: 'clean', BANDAL_BROWSER_AUTH_PROBE_ROOT: root,
    BANDAL_USER_DATA_DIR: join(root, 'user-data'), BANDAL_DATA_ROOT: join(root, 'data'),
    BANDAL_BROWSER_AUTH_PROBE_LAUNCH_ID: '11111111-2222-4333-8444-555555555555' }
  marker = { version: 1, purpose: 'bandal-browser-auth-probe', mode: 'clean', root,
    userDataDir: env.BANDAL_USER_DATA_DIR, dataRoot: env.BANDAL_DATA_ROOT, executablePath }
  writeMarker()
})
afterEach(() => {
  initializeBrowserAuthProbe({}, '', '')
  rmSync(join(root, '..'), { recursive: true, force: true })
})

test('normal startup ignores old test-data overrides and has no probe capabilities', () => {
  expect(validateBrowserAuthProbe({ BANDAL_USER_DATA_DIR: installed }, installed, executablePath)).toBeNull()
  expect(initializeBrowserAuthProbe({ BANDAL_BROWSER_AUTH_PROBE_IDENTITY: 'native' }, installed, executablePath)).toBeNull()
  expect(getBrowserAuthProbeMode()).toBeNull()
  expect(getBrowserAuthProbeIdentity()).toBeNull()
  expect(browserAuthProbeArguments()).toEqual([])
})

test.each(['clean', 'product'] as const)('accepts only a marked copied app and publishes the %s mode', mode => {
  env.BANDAL_BROWSER_AUTH_PROBE = mode
  marker.mode = mode
  writeMarker()
  expect(initializeBrowserAuthProbe(env, installed, executablePath)).toMatchObject({ mode, root })
  expect(getBrowserAuthProbeIdentity()).toBe('product')
  expect(browserAuthProbeArguments()).toEqual([`--bandal-browser-auth-probe=${mode}`])
  expect(isCleanBrowserAuthProbe()).toBe(mode === 'clean')
})

test.each([
  ['product', 'product'], ['product', 'native'], ['clean', 'product'], ['clean', 'native']
] as const)('accepts a matching %s instrumentation / %s identity marker independently', (mode, identity) => {
  env.BANDAL_BROWSER_AUTH_PROBE = mode
  env.BANDAL_BROWSER_AUTH_PROBE_IDENTITY = identity
  marker.mode = mode
  marker.identity = identity
  writeMarker()
  expect(initializeBrowserAuthProbe(env, installed, executablePath)).toMatchObject({ mode, identity, root })
  expect(getBrowserAuthProbeMode()).toBe(mode)
  expect(getBrowserAuthProbeIdentity()).toBe(identity)
  expect(isCleanBrowserAuthProbe()).toBe(mode === 'clean')
  expect(browserAuthProbeArguments()).toEqual([`--bandal-browser-auth-probe=${mode}`])
  expect(BROWSER_AUTH_PROBE_NATIVE_IDENTITY_CAPABILITY).toBe('bandal-manual-auth-probe/native-identity/v1')
})

test('legacy identity omissions mean product only, never native', () => {
  expect(validateBrowserAuthProbe(env, installed, executablePath)?.identity).toBe('product')
  expect(validateBrowserAuthProbe({ ...env, BANDAL_BROWSER_AUTH_PROBE_IDENTITY: 'product' }, installed, executablePath)?.identity).toBe('product')
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_BROWSER_AUTH_PROBE_IDENTITY: 'native' }, installed, executablePath)).toThrow(/marker/)
  marker.identity = 'native'
  writeMarker()
  expect(() => validateBrowserAuthProbe(env, installed, executablePath)).toThrow(/marker/)
})

test.each(['', 'chrome', 'Native', 'unknown'])('refuses unknown identity %s in either environment or marker', identity => {
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_BROWSER_AUTH_PROBE_IDENTITY: identity }, installed, executablePath)).toThrow(/identity/)
  marker.identity = identity
  writeMarker()
  expect(() => validateBrowserAuthProbe(env, installed, executablePath)).toThrow(/marker/)
})

test.each([['product', 'native'], ['native', 'product']] as const)('refuses environment identity %s against marker identity %s', (identity, markerIdentity) => {
  marker.identity = markerIdentity
  writeMarker()
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_BROWSER_AUTH_PROBE_IDENTITY: identity }, installed, executablePath)).toThrow(/marker/)
  expect(getBrowserAuthProbeIdentity()).toBeNull()
})

test('refuses a mode flag alone, relative data paths, or another mode marker', () => {
  expect(() => validateBrowserAuthProbe({ BANDAL_BROWSER_AUTH_PROBE: 'clean' }, installed, executablePath)).toThrow()
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_USER_DATA_DIR: './user-data' }, installed, executablePath)).toThrow()
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_BROWSER_AUTH_PROBE: 'product' }, installed, executablePath)).toThrow()
})

test('refuses existing installed data and a different executable before opening a profile', () => {
  expect(() => validateBrowserAuthProbe({ ...env, BANDAL_USER_DATA_DIR: installed }, installed, executablePath)).toThrow()
  expect(() => validateBrowserAuthProbe(env, root, executablePath)).toThrow()
  const external = join(installed, 'Bandal')
  writeFileSync(external, 'fixture')
  expect(() => validateBrowserAuthProbe(env, installed, external)).toThrow()
})

test('a forged marker cannot redirect user-data through a symlink', () => {
  rmSync(join(root, 'user-data'), { recursive: true })
  symlinkSync(installed, join(root, 'user-data'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => validateBrowserAuthProbe(env, installed, executablePath)).toThrow()
})

test('resuming cannot silently override the isolated material directory through saved settings', () => {
  writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ dataRoot: installed }))
  expect(() => validateBrowserAuthProbe(env, installed, executablePath)).toThrow(/isolated data directory/)
  writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ dataRoot: join(root, 'data') }))
  expect(validateBrowserAuthProbe(env, installed, executablePath)?.dataRoot).toBe(join(root, 'data'))
})

test.each(['--remote-debugging-port=9222', '--remote-debugging-pipe', '--inspect=9229', '--no-sandbox', '--disable-web-security', '--ignore-certificate-errors', '--user-agent=Chrome'])('refuses an invalid comparison launched with %s', flag => {
  expect(() => validateBrowserAuthProbe(env, installed, executablePath, [executablePath, flag])).toThrow(/without automation/)
})
