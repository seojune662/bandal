import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, symlinkSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertProbeCapablePackage, prepareProbe, probeEnvironment, waitForProbeRuntime } from './browser-auth-probe.mjs'

test('copies the packaged app and keeps resumable sessions separate from the source', () => {
  const temporaryDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'bandal-probe-launcher-test-')))
  try {
    const appPath = join(temporaryDirectory, 'Original.app')
    mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(appPath, 'Contents', 'MacOS', 'Bandal'), 'packaged executable')
    mkdirSync(join(appPath, 'Contents', 'Resources'))
    writeFileSync(join(appPath, 'Contents', 'Resources', 'app.asar'), 'bandal-manual-auth-probe/v1')
    const product = prepareProbe({ appPath, mode: 'product', temporaryDirectory, platform: 'darwin' })
    const clean = prepareProbe({ appPath, mode: 'clean', temporaryDirectory, platform: 'darwin' })
    assert.notEqual(product.root, clean.root)
    assert.notEqual(product.executablePath, join(appPath, 'Contents', 'MacOS', 'Bandal'))
    assert.equal(readFileSync(product.executablePath, 'utf8'), 'packaged executable')
    assert.equal(existsSync(join(appPath, 'user-data')), false)
    writeFileSync(join(product.userDataDir, 'session-fixture'), 'preserved')
    const resumed = prepareProbe({ resume: product.root, mode: 'product', platform: 'darwin' })
    assert.equal(readFileSync(join(resumed.userDataDir, 'session-fixture'), 'utf8'), 'preserved')
    assert.throws(() => prepareProbe({ resume: product.root, mode: 'clean' }), /matching authentication probe/)
    assert.throws(() => prepareProbe({ appPath, resume: product.root, mode: 'product' }), /without --app/)
  } finally { rmSync(temporaryDirectory, { recursive: true, force: true }) }
})

test('removes inherited automation, renderer, existing-profile, and weakened-test environment overrides', () => {
  const marker = { mode: 'clean', root: '/probe', userDataDir: '/probe/user-data', dataRoot: '/probe/data' }
  const env = probeEnvironment({ PATH: '/bin', BANDAL_USER_DATA_DIR: '/installed', BANDAL_DISABLE_SAFE_STORAGE: '1',
    ELECTRON_ENABLE_LOGGING: '1', ELECTRON_RUN_AS_NODE: '1', ELECTRON_RENDERER_URL: 'http://localhost', NODE_OPTIONS: '--inspect',
    NODE_PATH: '/extra', V8_FLAGS: '--expose-gc' }, marker, 'launch-id')
  assert.deepEqual(env, { PATH: '/bin', BANDAL_BROWSER_AUTH_PROBE: 'clean', BANDAL_BROWSER_AUTH_PROBE_ROOT: '/probe',
    BANDAL_USER_DATA_DIR: '/probe/user-data', BANDAL_DATA_ROOT: '/probe/data', BANDAL_BROWSER_AUTH_PROBE_LAUNCH_ID: 'launch-id' })
})

test('preserves macOS framework symlink text when copying the signed bundle', { skip: process.platform === 'win32' }, () => {
  const temporaryDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'bandal-probe-symlink-test-')))
  try {
    const appPath = join(temporaryDirectory, 'Original.app')
    mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(appPath, 'Contents', 'Resources'))
    writeFileSync(join(appPath, 'Contents', 'MacOS', 'Bandal'), 'executable')
    writeFileSync(join(appPath, 'Contents', 'Resources', 'app.asar'), 'bandal-manual-auth-probe/v1')
    const framework = join(appPath, 'Contents', 'Frameworks', 'Test.framework')
    mkdirSync(join(framework, 'Versions', 'A'), { recursive: true })
    symlinkSync('A', join(framework, 'Versions', 'Current'))
    const marker = prepareProbe({ appPath, mode: 'clean', temporaryDirectory, platform: 'darwin' })
    const copiedFramework = join(marker.root, 'application', 'Bandal Auth Probe.app', 'Contents', 'Frameworks', 'Test.framework')
    assert.equal(readlinkSync(join(copiedFramework, 'Versions', 'Current')), 'A')
  } finally { rmSync(temporaryDirectory, { recursive: true, force: true }) }
})

test('refuses older packages before launch and finds a capability marker across read boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-probe-capability-test-'))
  try {
    const executable = join(root, 'Contents', 'MacOS', 'Bandal')
    const resources = join(root, 'Contents', 'Resources')
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'app.asar'), 'old release without probe mode')
    assert.throws(() => assertProbeCapablePackage(executable, 'darwin'), /no isolated authentication probe support/)
    writeFileSync(join(resources, 'app.asar'), `${'x'.repeat(65530)}bandal-manual-auth-probe/v1`)
    assert.doesNotThrow(() => assertProbeCapablePackage(executable, 'darwin'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('startup handshake rejects old sessions and accepts only this process and launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bandal-probe-handshake-test-'))
  try {
    const expected = { root, mode: 'clean', launchId: 'current', pid: 123 }
    const metadata = { protocol: 'bandal-manual-auth-probe/v1', mode: 'clean', launchId: 'old', pid: 123, packaged: true }
    writeFileSync(join(root, 'runtime.json'), JSON.stringify(metadata))
    await assert.rejects(waitForProbeRuntime(expected, { timeoutMs: 5 }), /did not confirm/)
    metadata.launchId = 'current'
    metadata.pid = 999
    writeFileSync(join(root, 'runtime.json'), JSON.stringify(metadata))
    await assert.rejects(waitForProbeRuntime(expected, { timeoutMs: 5 }), /did not confirm/)
    metadata.pid = 123
    writeFileSync(join(root, 'runtime.json'), JSON.stringify(metadata))
    assert.equal((await waitForProbeRuntime(expected, { timeoutMs: 50 })).pid, 123)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
