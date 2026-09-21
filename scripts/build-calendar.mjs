import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function buildCalendar(arch = process.arch) {
  if (process.platform !== 'darwin') return
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported calendar architecture: ${arch}`)
  const output = resolve(root, 'resources/native/calendar', arch)
  mkdirSync(output, { recursive: true })
  execFileSync('xcrun', ['swiftc', '-O', '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx12.0`,
    '-framework', 'EventKit', '-framework', 'AppKit', resolve(root, 'native/calendar/main.swift'),
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', resolve(root, 'native/calendar/Info.plist'),
    '-o', resolve(output, 'bandal-calendar')], { stdio: 'inherit' })
}
export default async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildCalendar(context.arch === 3 ? 'arm64' : 'x64')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCalendar(process.argv[2])
