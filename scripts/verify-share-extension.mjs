import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function run(command, args, input) { return execFileSync(command, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function plist(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])) }
function entitlements(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], run('/usr/bin/codesign', ['-d', '--entitlements', ':-', file]))) }
function team(file) {
  const result = spawnSync('/usr/bin/codesign', ['-dvv', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Cannot inspect share signature: ${file}`)
  return /^TeamIdentifier=(.+)$/m.exec(result.stderr)?.[1]
}
const apps = process.argv.slice(2)
if (!apps.length) throw new Error('Usage: node scripts/verify-share-extension.mjs <Bandal.app> [...]')
for (const path of apps) {
  const app = resolve(path)
  const extension = join(app, 'Contents/PlugIns/BandalShare.appex')
  const appInfo = plist(join(app, 'Contents/Info.plist'))
  const extensionInfo = plist(join(extension, 'Contents/Info.plist'))
  const binary = join(extension, 'Contents/MacOS/BandalShare')
  const helper = join(app, 'Contents/Resources/share/bandal-share-inbox')
  const group = JSON.parse(readFileSync(join(app, 'Contents/Resources/share/config.json'), 'utf8')).appGroup
  assert.equal(extensionInfo.CFBundleIdentifier, 'com.bandal.app.share')
  assert.equal(extensionInfo.CFBundleShortVersionString, appInfo.CFBundleShortVersionString)
  assert.equal(extensionInfo.CFBundleVersion, appInfo.CFBundleVersion)
  assert.equal(extensionInfo.CFBundlePackageType, 'XPC!')
  assert.equal(extensionInfo.NSExtension.NSExtensionPointIdentifier, 'com.apple.share-services')
  assert.equal(extensionInfo.NSExtension.NSExtensionPrincipalClass, 'ShareViewController')
  assert.equal(extensionInfo.BandalShareAppGroup, group)
  const rule = extensionInfo.NSExtension.NSExtensionAttributes.NSExtensionActivationRule
  assert.equal(rule.NSExtensionActivationSupportsText, true)
  for (const name of ['File', 'Image', 'Movie', 'WebURL']) assert.equal(rule[`NSExtensionActivationSupports${name}WithMaxCount`], 100)
  const arch = run('/usr/bin/lipo', ['-archs', join(app, 'Contents/MacOS', appInfo.CFBundleExecutable)])
  assert.equal(run('/usr/bin/lipo', ['-archs', binary]), arch)
  assert.equal(run('/usr/bin/lipo', ['-archs', helper]), arch)
  for (const signed of [extension, helper, app]) run('/usr/bin/codesign', ['--verify', '--strict', signed])
  const owner = team(app)
  assert.ok(owner && owner !== 'not set', 'App must be Developer ID signed')
  assert.equal(team(extension), owner)
  assert.equal(team(helper), owner)
  assert.equal(group, `${owner}.com.bandal.shared`)
  assert.equal(entitlements(extension)['com.apple.security.app-sandbox'], true)
  for (const signed of [extension, helper, app]) assert.deepEqual(entitlements(signed)['com.apple.security.application-groups'], [group])
  // Does not open a user's App Group container or read their shared files.
  if (arch === (process.arch === 'x64' ? 'x86_64' : process.arch)) assert.equal(run(helper, ['--self-test']), 'bandal-share-inbox:ok')
  // Ask LaunchServices to discover this app, then verify the real system
  // extension registry recognizes it. Do not change the user's enable/disable
  // preference or invoke a share sheet with their personal data.
  run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app])
  run('/usr/bin/pluginkit', ['-a', extension])
  let registered = false
  for (let attempt = 0; attempt < 20; attempt++) {
    const listing = run('/usr/bin/pluginkit', ['-m', '-A', '-D', '-vv', '-i', 'com.bandal.app.share'])
    if (listing.includes(extension)) { registered = true; break }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(registered, 'macOS did not register the Bandal share extension')
  console.log(`[share-extension] verified ${path}: ${arch}, ${appInfo.CFBundleShortVersionString}, ${owner}`)
}
