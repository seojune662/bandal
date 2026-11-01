/**
 * What the engine takes from a provider (design 2.3) until providers exist: a
 * listing of every file under the root and a reader. Metadata and note files
 * are read and kept by version; a PDF or asset counts as present by its name
 * and is read, and checked against that name, only when a document needs it.
 */
import type { Database } from 'better-sqlite3'
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
  /**
   * `errors` are files the spec rejects whole; every device ignores them alike.
   * `merged` and `clock` (the largest t in the root) are what an export right after needs.
   */
  | ({ status: 'applied'; errors: string[]; merged: MergedState; clock: number } & ApplyResult)

export type Cache = Map<string, { version: string; bytes: Uint8Array }>

/** A root parsed and merged, without applying it; `cache` keeps files by version between calls. */
export async function readMerged(root: RootSnapshot, cache: Cache = new Map()): Promise<
  | Exclude<PullResult, { status: 'applied' }>
  | { status: 'merged'; errors: string[]; merged: MergedState; clock: number }
> {
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
        // Once one read fails the pass applies nothing: the rest wait without a read, so a pass (and a backup's pause) never sits through every timeout.
        if (pending.length > 0) {
          pending.push(path)
          continue
        }
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
  let clock = 0
  for (const file of read.parsed) {
    if (file.kind === 'log') for (const event of file.events) clock = Math.max(clock, event.t)
    else if (file.kind === 'ink') for (const object of file.objects) clock = Math.max(clock, object.t)
  }
  return { status: 'merged', errors: read.errors, merged, clock }
}

/**
 * A merged root with this profile's course ids: a course merged at initial
 * connect keeps its local id, and its remote id is read as that one here.
 */
export function localize(merged: MergedState, db: Database): MergedState {
  const aliases = new Map((db.prepare("SELECT remote_id, local_id FROM sync_alias WHERE kind = 'course'").all() as { remote_id: string; local_id: string }[])
    .map(row => [row.remote_id, row.local_id]))
  if (aliases.size === 0) return merged
  const local = (id: string): string => aliases.get(id) ?? id
  for (const entity of merged.docs.values()) {
    const course = entity.fields.get('course_id')
    if (typeof course?.value === 'string' && aliases.has(course.value)) entity.fields.set('course_id', { ...course, value: local(course.value) })
  }
  return {
    ...merged,
    courses: new Map([...merged.courses].map(([id, entity]) => [local(id), entity])),
    conflictCopies: merged.conflictCopies.map(copy => ({ ...copy, course_id: local(copy.course_id) }))
  }
}

/** One pull at a time: a second call waits for the first. */
export function createPull(ctx: Omit<ApplyContext, 'read'>): (root: RootSnapshot) => Promise<PullResult> {
  // ponytail: every metadata and note file stays in memory by version; spill to disk if roots grow past tens of MB.
  const cache: Cache = new Map()
  let running: Promise<unknown> = Promise.resolve()
  const pull = async (root: RootSnapshot): Promise<PullResult> => {
    const read = await readMerged(root, cache)
    if (read.status !== 'merged') return read
    const merged = localize(read.merged, ctx.db)
    return { status: 'applied', errors: read.errors, merged, clock: read.clock, ...await applyMerged(merged, { ...ctx, read: path => root.read(path) }) }
  }
  return root => {
    const next = running.then(() => pull(root), () => pull(root))
    running = next
    return next
  }
}
