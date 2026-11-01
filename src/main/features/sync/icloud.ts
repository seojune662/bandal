/**
 * iCloud Drive on macOS through the plain file system (design 2.4). The root
 * is the `iCloud.app.bandal` container's Documents folder, which the iPad app
 * creates; this app has no iCloud entitlement and never creates it. macOS
 * uploads whatever lands in it and downloads a file when it is read.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, watch } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { isSpecPath, placeholderTarget } from './format'
import type { RootSnapshot } from './pull'

export type ProviderStatus = 'ready' | 'needs-ipad' | 'unavailable' | 'needs-auth'

/** What the engine needs from a cloud root (design 2.3). */
export interface SyncProvider {
  /** `needs-ipad`: the container is not here yet. `unavailable`: iCloud Drive is off. `needs-auth`: Google Drive wants a sign-in. */
  status(): Promise<ProviderStatus>
  list(): Promise<RootSnapshot>
  /** Atomic, and only ever this device's own files or content-named ones. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** Calls back on any change under the root; returns the unsubscribe. */
  watch(onChange: () => void): () => void
}

/** `~/Library/Mobile Documents/iCloud~app~bandal/Documents`. */
export const icloudRoot = (home = homedir()): string => join(home, 'Library', 'Mobile Documents', 'iCloud~app~bandal', 'Documents')

/** A read past this waits for the next pass: the file is still downloading, or the Mac is offline. */
const READ_TIMEOUT_MS = 60_000

export function createICloudProvider(options: { root: string; tmpDir: string; readTimeoutMs?: number }): SyncProvider {
  const { root, tmpDir } = options
  const inside = (path: string): string => {
    if (!isSpecPath(placeholderTarget(path) ?? path)) throw new Error(`${path} is not a sync path`)
    return join(root, ...path.split('/'))
  }
  const read = async (path: string): Promise<Uint8Array> =>
    readFile(inside(path), { signal: AbortSignal.timeout(options.readTimeoutMs ?? READ_TIMEOUT_MS) })
  const requested = new Set<string>()

  return {
    async status() {
      // Mobile Documents/com~apple~CloudDocs exists exactly while iCloud Drive is on.
      if (!existsSync(join(dirname(dirname(root)), 'com~apple~CloudDocs'))) return 'unavailable'
      return existsSync(root) ? 'ready' : 'needs-ipad'
    },
    async list() {
      const entries = []
      for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const abs = join(entry.parentPath, entry.name), path = relative(root, abs).split(sep).join('/')
        const target = placeholderTarget(path)
        if (!isSpecPath(target ?? path)) continue
        if (target !== null && !requested.has(path)) {
          requested.add(path)
          // macOS 12–13 show an evicted file as `.name.icloud` and download it only on request; 14 and later keep the name and download on read.
          execFile('/usr/bin/brctl', ['download', join(root, ...target.split('/'))], () => {})
        }
        // A file iCloud has not downloaded (dataless) keeps its size and mtime, so the version holds across downloads.
        const info = await stat(abs)
        entries.push({ path, version: `${Math.round(info.mtimeMs)}:${info.size}` })
      }
      return { entries, read }
    },
    async write(path, bytes) {
      const target = inside(path)
      // Never make the container: if it went away since the status check, iCloud Drive is off or the iPad removed it.
      if (!existsSync(root)) throw new Error('the iCloud folder is gone')
      // The temporary file stays outside the root, so iCloud never uploads a half-written one (spec 원칙).
      await mkdir(tmpDir, { recursive: true })
      const temporary = join(tmpDir, `${randomUUID()}.tmp`)
      try {
        const file = await open(temporary, 'wx')
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        await mkdir(dirname(target), { recursive: true })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    watch(onChange) {
      const watcher = watch(root, { recursive: true }, () => onChange())
      // The root went away (iCloud Drive turned off): the engine's next status check says so.
      watcher.on('error', () => onChange())
      return () => watcher.close()
    }
  }
}
