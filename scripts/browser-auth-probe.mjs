#!/usr/bin/env node
/** Launch a copied packaged app for human-only authentication comparison. */
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const purpose = 'bandal-browser-auth-probe'
const protocol = 'bandal-manual-auth-probe/v1'
const nativeIdentityCapability = 'bandal-manual-auth-probe/native-identity/v1'

function validateIdentity(identity) {
  if (identity !== 'product' && identity !== 'native') throw new Error('--identity must be product or native.')
}

/** Refuse old releases before they can run their normal protocol/updater startup. */
export function assertProbeCapablePackage(executablePath, platform = process.platform, identity = 'product') {
  validateIdentity(identity)
  const resources = platform === 'darwin' ? join(dirname(executablePath), '..', 'Resources') : join(dirname(executablePath), 'resources')
  const archive = join(resources, 'app.asar')
  if (!existsSync(archive)) throw new Error('The packaged app.asar was not found; select a published probe-capable build.')
  const file = openSync(archive, 'r')
  const buffer = Buffer.alloc(64 * 1024)
  const missing = new Set(identity === 'native' ? [protocol, nativeIdentityCapability] : [protocol])
  const overlap = Math.max(...[...missing].map(value => value.length))
  let previous = Buffer.alloc(0)
  try {
    while (true) {
      const count = readSync(file, buffer)
      if (!count) break
      const chunk = Buffer.concat([previous, buffer.subarray(0, count)])
      for (const capability of missing) if (chunk.includes(capability)) missing.delete(capability)
      if (missing.size === 0) return
      previous = Buffer.from(chunk.subarray(-overlap))
    }
  } finally { closeSync(file) }
  if (!missing.has(protocol)) throw new Error('This app build has no native identity probe support. Use a release containing this feature.')
  throw new Error('This app build has no isolated authentication probe support. Use a release containing this feature.')
}

export function probeEnvironment(source, marker, launchId = randomUUID()) {
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    value !== undefined && !/^(BANDAL_|ELECTRON_)/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'V8_FLAGS'].includes(key.toUpperCase())))
  return { ...env, BANDAL_BROWSER_AUTH_PROBE: marker.mode, BANDAL_BROWSER_AUTH_PROBE_ROOT: marker.root,
    BANDAL_USER_DATA_DIR: marker.userDataDir, BANDAL_DATA_ROOT: marker.dataRoot, BANDAL_BROWSER_AUTH_PROBE_LAUNCH_ID: launchId,
    BANDAL_BROWSER_AUTH_PROBE_IDENTITY: marker.identity === undefined ? 'product' : marker.identity }
}

export async function waitForProbeRuntime({ root, mode, identity = 'product', launchId, pid }, { timeoutMs = 20_000, hasExited = () => false } = {}) {
  validateIdentity(identity)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const metadata = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8'))
      const runtimeIdentity = metadata.identity === undefined ? 'product' : metadata.identity
      if (metadata.protocol === protocol && metadata.mode === mode && runtimeIdentity === identity && metadata.launchId === launchId && metadata.pid === pid && metadata.packaged === true) return metadata
    } catch { /* The app writes this once its runtime is ready; never inspect page content. */ }
    if (hasExited()) break
    await delay(Math.min(100, Math.max(1, deadline - Date.now())))
  }
  throw new Error('The copied app did not confirm this isolated probe launch. It may already be running or the build may be incompatible.')
}

export function prepareProbe({ appPath, mode, identity = 'product', resume, temporaryDirectory = tmpdir(), platform = process.platform }) {
  if (mode !== 'product' && mode !== 'clean') throw new Error('--mode must be product or clean.')
  validateIdentity(identity)
  if (resume) {
    if (appPath) throw new Error('Use --resume without --app to reopen the same copied application.')
    const root = realpathSync(resolve(resume))
    const marker = JSON.parse(readFileSync(join(root, 'probe.json'), 'utf8'))
    const markerIdentity = marker.identity === undefined ? 'product' : marker.identity
    if (marker.version !== 1 || marker.purpose !== purpose || marker.mode !== mode || markerIdentity !== identity || marker.root !== root ||
      marker.userDataDir !== join(root, 'user-data') || marker.dataRoot !== join(root, 'data') ||
      typeof marker.executablePath !== 'string' || !marker.executablePath.startsWith(`${join(root, 'application')}/`) &&
        !marker.executablePath.startsWith(`${join(root, 'application')}\\`)) {
      throw new Error('The requested directory is not a matching authentication probe.')
    }
    if (realpathSync(marker.userDataDir) !== marker.userDataDir || realpathSync(marker.dataRoot) !== marker.dataRoot ||
      realpathSync(marker.executablePath) !== marker.executablePath) throw new Error('Probe paths must not be redirected.')
    assertProbeCapablePackage(marker.executablePath, platform, identity)
    return marker
  }
  if (!appPath) throw new Error('--app must point to the packaged Bandal.app or unpacked Bandal.exe.')
  const source = realpathSync(resolve(appPath))
  let sourceDirectory, executableRelative, copyName
  if (platform === 'darwin' && source.endsWith('.app') && statSync(source).isDirectory()) {
    sourceDirectory = source
    executableRelative = join('Contents', 'MacOS', 'Bandal')
    copyName = 'Bandal Auth Probe.app'
  } else if (platform === 'win32' && basename(source).toLowerCase() === 'bandal.exe' && statSync(source).isFile()) {
    sourceDirectory = dirname(source)
    executableRelative = basename(source)
    copyName = 'Bandal Auth Probe'
  } else throw new Error('Expected a packaged Bandal.app on macOS or an unpacked Bandal.exe on Windows.')
  if (!existsSync(join(sourceDirectory, executableRelative))) throw new Error('The packaged Bandal executable was not found.')
  assertProbeCapablePackage(join(sourceDirectory, executableRelative), platform, identity)
  const root = realpathSync(mkdtempSync(join(temporaryDirectory, `bandal-auth-probe-${mode}${identity === 'native' ? '-native' : ''}-`)))
  const userDataDir = join(root, 'user-data')
  const dataRoot = join(root, 'data')
  mkdirSync(userDataDir, { mode: 0o700 })
  mkdirSync(dataRoot, { mode: 0o700 })
  const copy = join(root, 'application', copyName)
  mkdirSync(dirname(copy))
  cpSync(sourceDirectory, copy, { recursive: true, dereference: false, verbatimSymlinks: true })
  const executablePath = realpathSync(join(copy, executableRelative))
  const marker = { version: 1, purpose, mode, identity, root, userDataDir, dataRoot, executablePath, createdAt: new Date().toISOString() }
  writeFileSync(join(root, 'probe.json'), JSON.stringify(marker, null, 2), { mode: 0o600 })
  // Both comparisons start from the same empty app configuration; no account is seeded.
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ dataRoot,
    onboarding: { flowVersion: 2, closedAt: new Date().toISOString(), lastCompletedStep: 3 },
    tutorial: { seenVersion: 1, activeCourseId: null }
  }, null, 2), { mode: 0o600 })
  return marker
}

async function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/browser-auth-probe.mjs --app <Bandal.app|Bandal.exe> --mode <product|clean> [--identity <product|native>]\n' +
      'Resume: node scripts/browser-auth-probe.mjs --resume <probe-directory> --mode <product|clean> [--identity <product|native>]\n' +
      'Identity defaults to product. Native preserves the runtime user agent without setting an override.\n' +
      'The launcher copies the packaged application, creates separate data, and never automates Google login.')
    return
  }
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--app': 'appPath', '--mode': 'mode', '--identity': 'identity', '--resume': 'resume' }[argv[i]]
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--') || options[key] !== undefined) throw new Error('Invalid arguments. Use --help.')
    options[key] = argv[i + 1]
  }
  const marker = prepareProbe(options)
  const identity = marker.identity === undefined ? 'product' : marker.identity
  console.log(`Authentication comparison: ${marker.mode}; identity: ${identity}\nIsolated app and data: ${marker.root}\n` +
    'Enter credentials only in the visible Google page. Login success is not inferred by this launcher.\n' +
    'Keep this directory private: the browser stores any manually created login session here.\n' +
    `Reopen with: node scripts/browser-auth-probe.mjs --resume "${marker.root}" --mode ${marker.mode} --identity ${identity}`)
  // No debugging endpoint, automation channel, page script, or captured app log.
  const env = probeEnvironment(process.env, marker)
  rmSync(join(marker.root, 'runtime.json'), { force: true })
  const child = spawn(marker.executablePath, [], { env, stdio: 'ignore' })
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', error => reject(new Error(`Probe could not start (${error.code ?? 'launch error'}).`)))
    child.once('exit', (code, signal) => {
      console.log(`Probe closed (${signal ?? code ?? 'unknown'}). Manual authentication results remain unverified.`)
      if (code) process.exitCode = code
      resolveExit()
    })
  })
  void exited.catch(() => {})
  try {
    await Promise.race([waitForProbeRuntime({ root: marker.root, mode: marker.mode, identity,
      launchId: env.BANDAL_BROWSER_AUTH_PROBE_LAUNCH_ID, pid: child.pid }, {
      hasExited: () => child.pid === undefined || child.exitCode !== null || child.signalCode !== null
    }), exited.then(() => { throw new Error('The copied app exited before confirming probe startup.') })])
    console.log('Isolated runtime confirmed. Complete the manual checklist in docs/browser-auth-probe.md.')
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    throw error
  }
  await exited
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
