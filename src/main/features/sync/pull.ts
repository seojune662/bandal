/**
 * What the engine takes from a provider (design 2.3) until providers exist: a
 * listing of every file under the root and a reader. Metadata and note files
 * are read and kept by version; a PDF or asset counts as present by its name
 * and is read, and checked against that name, only when a document needs it.
 */
import { contentRef, isSpecPath, placeholderTarget, readRoot, type ParsedFile, type RemoteFile } from './format'
import { applyMerged, type ApplyContext, type ApplyResult } from './apply'
import { merge, type MergedState } from './merge'

export interface RootEntry {
  /** Root-relative, `/`-separated. */
  path: string
  /** Changes whenever the bytes do: iCloud `${mtimeMs}:${size}`, Drive md5Checksum. */
  version: string
}

export interface RootSnapshot {
  entries: readonly RootEntry[]
  read(path: string): Promise<Uint8Array>
}

export type PullResult =
  | { status: 'blocked'; blocked: NonNullable<MergedState['blocked']> }
  /** Some files could not be read yet (offline, still downloading): nothing was applied. */
  | { status: 'incomplete'; pending: string[] }
  /** `errors` are files the spec rejects whole; every device ignores them alike. */
  | ({ status: 'applied'; errors: string[] } & ApplyResult)

/** One pull at a time: a second call waits for the first. */
export function createPull(ctx: Omit<ApplyContext, 'read'>): (root: RootSnapshot) => Promise<PullResult> {
  // ponytail: every metadata and note file stays in memory by version; spill to disk if roots grow past tens of MB.
  const cache = new Map<string, { version: string; bytes: Uint8Array }>()
  let running: Promise<unknown> = Promise.resolve()
  const pull = async (root: RootSnapshot): Promise<PullResult> => {
    const files: RemoteFile[] = [], content: ParsedFile[] = [], pending: string[] = [], listed = new Set<string>()
    for (const { path, version } of root.entries) {
      // An iCloud placeholder of a PDF or asset is in the root all the same; reading it downloads it.
      const target = placeholderTarget(path), ref = contentRef(target ?? path)
      if (ref) content.push(ref)
      else if (target !== null) files.push({ path, bytes: new Uint8Array() })
      else if (isSpecPath(path)) {
        listed.add(path)
        let cached = cache.get(path)
        if (cached?.version !== version) {
          try {
            cached = { version, bytes: await root.read(path) }
            cache.set(path, cached)
          } catch {
            pending.push(path)
            continue
          }
        }
        files.push({ path, bytes: cached.bytes })
      }
    }
    for (const path of cache.keys()) if (!listed.has(path)) cache.delete(path)
    const read = readRoot(files)
    // A partial root merges to an older state; derived results such as conflict copies would come and go.
    if (pending.length > 0 || read.pending.length > 0) return { status: 'incomplete', pending: [...pending, ...read.pending].sort() }
    const merged = merge([...read.parsed, ...content])
    if (merged.blocked !== null) return { status: 'blocked', blocked: merged.blocked }
    return { status: 'applied', errors: read.errors, ...await applyMerged(merged, { ...ctx, read: path => root.read(path) }) }
  }
  return root => {
    const next = running.then(() => pull(root), () => pull(root))
    running = next
    return next
  }
}
