import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

// electron-builder intentionally skips Contents/PlugIns. Sign the extension
// with its sandbox entitlements before the usual inside-out Electron signing.
export default async function sign(options) {
  if (!options.identity) throw new Error('A Developer ID identity is required for signed builds')
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { signAsync } = appBuilderRequire('@electron/osx-sign')
  const extension = join(options.app, 'Contents/PlugIns/BandalShare.appex')
  const arch = execFileSync('/usr/bin/lipo', ['-archs', join(extension, 'Contents/MacOS/BandalShare')], { encoding: 'utf8' }).trim() === 'arm64' ? 'arm64' : 'x64'
  const entitlements = resolve('resources/native/share-extension', arch, 'entitlements.extension.plist')
  const args = ['--force', '--sign', options.identity, '--timestamp', '--options', 'runtime', '--entitlements', entitlements]
  if (options.keychain) args.push('--keychain', options.keychain)
  execFileSync('/usr/bin/codesign', [...args, extension], { stdio: 'inherit' })
  const originalOptions = options.optionsForFile
  await signAsync({ ...options, optionsForFile: file => {
    const original = originalOptions?.(file) ?? {}
    // The small Foundation helper must carry the same App Group entitlement
    // as the host when it resolves the shared container on the host's behalf.
    return file.endsWith('/share/bandal-share-inbox') ? { ...original, entitlements: resolve('resources/native/share-extension/entitlements.main.plist') } : original
  } })
}
