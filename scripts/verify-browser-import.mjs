import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

// Verify a packaged app/directory, or a development helper with --unsigned.
// Self-test uses a fixed metadata-only request; it never reads user profiles,
// requests Keychain permission, or calls CryptUnprotectData.
const args = process.argv.slice(2)
const unsigned = args.includes('--unsigned')
const targets = args.filter(arg => arg !== '--unsigned')
if (targets.length === 0) throw new Error('Usage: node scripts/verify-browser-import.mjs [--unsigned] <Bandal.app|win-unpacked|helper> [...]')
for (const input of targets) {
  const target = resolve(input)
  const macApp = target.endsWith('.app')
  const helper = macApp ? join(target, 'Contents/Resources/browser-import/bandal-browser-import')
    : statSync(target).isDirectory() ? join(target, 'resources/browser-import/bandal-browser-import.exe') : target
  if (!/^bandal-browser-import(?:\.exe)?$/.test(basename(helper))) throw new Error(`Unexpected browser import helper: ${helper}`)
  accessSync(helper, process.platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK)
  if (statSync(helper).size === 0) throw new Error(`Empty browser import helper: ${helper}`)
  let runnable = true
  if (process.platform === 'darwin' && !helper.endsWith('.exe')) {
    const architectures = execFileSync('lipo', ['-archs', helper], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\s+/)
    const host = process.arch === 'x64' ? 'x86_64' : process.arch
    runnable = architectures.includes(host)
    if (macApp) {
      const appArchitectures = execFileSync('lipo', ['-archs', join(target, 'Contents/MacOS/Bandal')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\s+/)
      if (!appArchitectures.every(arch => architectures.includes(arch))) throw new Error(`Browser import helper architecture does not match app: ${helper}`)
    }
    if (!unsigned) {
      if (!macApp) throw new Error('Signed helper verification requires its owning .app bundle.')
    }
  }
  if (macApp && !unsigned) {
    const teams = [target, helper].map(path => {
      execFileSync('codesign', ['--verify', '--strict', path], { stdio: 'pipe' })
      const result = spawnSync('codesign', ['-d', '--verbose=4', path], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`Cannot inspect browser import signature: ${path}`)
      return /TeamIdentifier=(\S+)/.exec(result.stderr)?.[1]
    })
    if (!teams[0] || teams[0] === 'not' || teams[0] !== teams[1]) throw new Error(`Browser import helper is not signed by the app team: ${helper}`)
  }
  if (runnable) {
    const result = JSON.parse(execFileSync(helper, [], { input: '{"operation":"self-test"}', encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }))
    if (result.protocol !== 1 || result.selfTest !== true || result.platform !== process.platform) throw new Error(`Invalid browser import helper self-test: ${helper}`)
    console.log(`Browser import helper self-test passed: ${helper}`)
  } else console.log(`Browser import helper architecture/signature verified; self-test requires matching host: ${helper}`)
}
