import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browserAuthProbeArguments, getBrowserAuthProbeMode, initializeBrowserAuthProbe, isCleanBrowserAuthProbe, validateBrowserAuthProbe } from '../../../src/main/features/browser/authProbe'

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
  expect(getBrowserAuthProbeMode()).toBeNull()
  expect(browserAuthProbeArguments()).toEqual([])
})

test.each(['clean', 'product'] as const)('accepts only a marked copied app and publishes the %s mode', mode => {
  env.BANDAL_BROWSER_AUTH_PROBE = mode
  marker.mode = mode
  writeMarker()
  expect(initializeBrowserAuthProbe(env, installed, executablePath)).toMatchObject({ mode, root })
  expect(browserAuthProbeArguments()).toEqual([`--bandal-browser-auth-probe=${mode}`])
  expect(isCleanBrowserAuthProbe()).toBe(mode === 'clean')
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
