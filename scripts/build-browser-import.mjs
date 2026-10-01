import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildBrowserImport(arch = process.arch) {
  if (!['darwin', 'win32'].includes(process.platform)) return
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported browser import architecture: ${arch}`)
  const output = resolve(root, 'resources/native/browser-import', arch)
  mkdirSync(output, { recursive: true })
  if (process.platform === 'darwin') {
    execFileSync('xcrun', ['swiftc', '-O', '-module-cache-path', join(tmpdir(), 'bandal-browser-import-swift-cache'), '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx12.0`, '-framework', 'Security', resolve(root, 'native/browser-import/main.swift'), '-o', resolve(output, 'bandal-browser-import')], { stdio: 'inherit' })
  } else {
    const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/reference:System.Security.dll', '/reference:System.Web.Extensions.dll', `/out:${join(output, 'bandal-browser-import.exe')}`, resolve(root, 'native/browser-import/Program.cs')], { stdio: 'inherit' })
  }
}
export default async function beforePack(context) {
  if (context.electronPlatformName === process.platform) buildBrowserImport(context.arch === 3 ? 'arm64' : 'x64')
  else if (['darwin', 'win32'].includes(context.electronPlatformName)) throw new Error('Browser import helpers must be built on their target operating system.')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildBrowserImport(process.argv[2])
