import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildShareExtension(arch = process.arch) {
  if (process.platform !== 'darwin') return
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported share extension architecture: ${arch}`)
  const team = process.env.APPLE_TEAM_ID
  if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid APPLE_TEAM_ID')
  // Team-prefixed macOS groups work with notarized Developer ID apps without
  // a provisioning profile. LOCAL is only for unsigned development builds.
  const group = `${team || 'LOCAL'}.com.bandal.shared`
  const output = resolve(root, 'resources/native/share-extension', arch)
  const bundle = resolve(output, 'BandalShare.appex/Contents')
  mkdirSync(resolve(bundle, 'MacOS'), { recursive: true })
  mkdirSync(resolve(bundle, 'Resources'), { recursive: true })
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
  writeFileSync(resolve(bundle, 'Info.plist'), readFileSync(resolve(root, 'native/share-extension/Info.plist'), 'utf8').replaceAll('VERSION', version).replaceAll('APP_GROUP', group))
  copyFileSync(resolve(root, 'resources/icon.icns'), resolve(bundle, 'Resources/icon.icns'))
  const target = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx12.0`
  execFileSync('xcrun', ['swiftc', '-O', '-target', target, '-application-extension', '-parse-as-library', '-emit-executable', '-module-name', 'BandalShare', '-framework', 'AppKit', '-framework', 'UniformTypeIdentifiers', '-Xlinker', '-e', '-Xlinker', '_NSExtensionMain', resolve(root, 'native/share-extension/ShareViewController.swift'), '-o', resolve(bundle, 'MacOS/BandalShare')], { stdio: 'inherit' })
  execFileSync('xcrun', ['swiftc', '-O', '-target', target, resolve(root, 'native/share-extension/container.swift'), '-o', resolve(output, 'bandal-share-inbox')], { stdio: 'inherit' })
  writeFileSync(resolve(output, 'config.json'), JSON.stringify({ appGroup: group }))
  const groupXML = `<key>com.apple.security.application-groups</key><array><string>${group}</string></array>`
  const main = readFileSync(resolve(root, 'resources/entitlements.mac.plist'), 'utf8').replace('  </dict>', `    ${groupXML}\n  </dict>`)
  writeFileSync(resolve(root, 'resources/native/share-extension/entitlements.main.plist'), main)
  writeFileSync(resolve(output, 'entitlements.extension.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.files.user-selected.read-only</key><true/>${groupXML}</dict></plist>`)
  // Ad-hoc signatures permit local structural verification; release signing
  // replaces these with the existing Developer ID identity before notarizing.
  execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', resolve(output, 'entitlements.extension.plist'), resolve(output, 'BandalShare.appex')], { stdio: 'inherit' })
}
export default async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildShareExtension(context.arch === 3 ? 'arm64' : 'x64')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildShareExtension(process.argv[2])
