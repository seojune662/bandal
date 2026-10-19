import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildPhotoPicker(arch = process.arch) {
  if (process.platform !== 'darwin') return
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported photo picker architecture: ${arch}`)
  const output = resolve(root, 'resources/native/photo-picker', arch)
  mkdirSync(output, { recursive: true })
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx12.0`,
    '-framework', 'PhotosUI', '-framework', 'AppKit', '-framework', 'UniformTypeIdentifiers',
    resolve(root, 'native/photo-picker/main.swift'),
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', resolve(root, 'native/photo-picker/Info.plist'), '-o', resolve(output, 'bandal-photo-picker')], { stdio: 'inherit' })
}
export default async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildPhotoPicker(context.arch === 3 ? 'arm64' : 'x64')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPhotoPicker(process.argv[2])
