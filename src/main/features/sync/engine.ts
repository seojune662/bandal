/**
 * The sync loop of one profile (design 2.7). A pass pulls the root and
 * applies it, then exports what the outbox names. Passes run on a change
 * under the root, once the outbox has been still for 1.5 s, and every few
 * minutes; one at a time, backing off after a failure. Nothing here ever
 * blocks a local edit.
 */
import type { Database } from 'better-sqlite3'
import type { SyncDevice, SyncState } from '../../../shared/types/sync'
import type { ApplyResult } from './apply'
import { createExportSession, exportChanges } from './export'
import type { SyncProvider } from './icloud'
import { loadIdentity, takeSeq, type SyncIdentity } from './identity'
import type { Scan } from './localDocs'
import type { PullResult, RootSnapshot } from './pull'

export type { SyncDevice, SyncState }

const TIMING = {
  /** The outbox must stay still this long before an export (spec "1.5초 idle"). */
  idleMs: 1_500,
  hintMs: 1_000,
  /** Course folders are compared again this often, for edits made outside the app. */
  rescanMs: 5 * 60_000,
  waitingMs: 30_000,
  retryMs: 5_000,
  maxRetryMs: 15 * 60_000,
  deviceMs: 60 * 60_000
}

export interface SyncEngineDeps {
  db: Database
  provider: SyncProvider
  pull(root: RootSnapshot): Promise<PullResult>
  /** `<profile>/sync/state.json`: device id, seq and the machine it was made on. */
  stateFile: string
  machine(): Promise<string>
  /** This device's `devices/<id>.json`, less `last_seen`; read at each write, so a rename shows up. */
  device(): { name: string; platform: string; app_version: string }
  scan(folder: string): Promise<Scan>
  /** An apply changed or removed courses: refresh the windows and release what was removed. */
  changed(result: ApplyResult): void
  onState?(state: SyncState): void
  timing?: Partial<typeof TIMING>
  platform?: NodeJS.Platform
}

export interface SyncEngine {
  start(): void
  /** The device files of the last root this engine read. */
  devices(): SyncDevice[]
  /** This device's file is written again on the next pass (a new name). */
  deviceChanged(): void
  /** Runs a pass now, after any running one; resolves when it is done. */
  syncNow(): Promise<void>
  /** No pass starts until resume; resolves once a running one has finished (backups). */
  pause(): Promise<void>
  resume(): void
  /** No pass starts again; resolves once a running one has finished (it never exports after this). */
  stop(): Promise<void>
  state(): SyncState
}

const MANAGED = "c.source = 'managed' AND c.workspace_kind = 'course'"
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Everything that may differ from the base, for the export to compare: at
 * start (changes made while sync was off, and the first upload) and every few
 * minutes after (edits made outside the app, and edits an apply had to leave
 * because they were not exported yet).
 */
function enqueue(db: Database): void {
  db.transaction(() => {
    db.prepare(`INSERT INTO sync_outbox (kind, id) SELECT 'docs', c.id FROM courses c WHERE c.deleted_at IS NULL AND ${MANAGED}`).run()
    db.prepare(`INSERT INTO sync_outbox (kind, id) SELECT 'course', c.id FROM courses c WHERE ${MANAGED}`).run()
    db.prepare(`INSERT INTO sync_outbox (kind, id) SELECT 'course', entity_id FROM sync_meta
      WHERE kind = 'course' AND field = 'deleted' AND value_json = 'false' AND entity_id NOT IN (SELECT id FROM courses)`).run()
    db.prepare(`INSERT INTO sync_outbox (kind, id) SELECT 'ink', d.id FROM pdf_drawings d JOIN courses c ON c.id = d.course_id AND ${MANAGED}
      LEFT JOIN sync_ink s ON s.id = d.id WHERE s.id IS NULL OR s.updated_at IS NOT d.updated_at`).run()
    db.prepare("INSERT INTO sync_outbox (kind, id) SELECT 'ink', id FROM sync_ink WHERE updated_at IS NOT NULL AND id NOT IN (SELECT id FROM pdf_drawings)").run()
  })()
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const timing = { ...TIMING, ...deps.timing }
  const session = createExportSession()
  let identity: SyncIdentity | null = null
  let current: SyncState = { state: 'off' }
  let running: Promise<void> | null = null, queued: Promise<void> | null = null, queuedFor: 'poke' | 'ask' = 'poke', stopped = true, paused = false
  let failures = 0, rescanAt = 0, deviceAt = 0, lastSeq: number | null = null, kickedSeq: number | null = null
  let timer: NodeJS.Timeout | undefined, hintTimer: NodeJS.Timeout | undefined, ticker: NodeJS.Timeout | undefined
  let unwatch: (() => void) | null = null, devices: SyncDevice[] = []

  const set = (next: SyncState): void => {
    // A pass still finishing after stop() must not bring the state back.
    if (stopped && next.state !== 'off') return
    current = next
    deps.onState?.(next)
  }
  /** The next pass when nothing else asks for one sooner: periodic, waiting or backing off. */
  const schedule = (ms: number): void => {
    clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(() => void run('ask'), ms)
    timer.unref()
  }
  /** A hint or a still outbox. After a failure only the backoff timer runs a pass, or a failing write would loop. */
  const poke = (): void => void run('poke')
  /** A change under the root, settled for a moment. */
  const hint = (): void => {
    clearTimeout(hintTimer)
    if (stopped) return
    hintTimer = setTimeout(poke, timing.hintMs)
    hintTimer.unref()
  }

  async function pass(): Promise<void> {
    const { db, provider } = deps
    const status = await provider.status()
    if (status !== 'ready') {
      unwatch?.()
      unwatch = null
      set({ state: status })
      return schedule(timing.waitingMs)
    }
    if (stopped) return
    unwatch ??= provider.watch(hint)
    set({ state: 'syncing' })
    identity ??= loadIdentity(deps.stateFile, await deps.machine())
    let root = await provider.list()
    if (stopped) return
    if (root.entries.length === 0) {
      // An empty root: this device starts it, and everything here goes up (spec 초기 연결).
      await provider.write('bandal.json', Buffer.from('{"format":2}'))
      root = await provider.list()
    }
    if (Date.now() >= rescanAt) {
      enqueue(db)
      rescanAt = Date.now() + timing.rescanMs
    }
    if (stopped) return
    const pulled = await deps.pull(root)
    if (pulled.status === 'blocked') {
      set(pulled.blocked === 'update-required' ? { state: 'update-required' } : { state: 'error', message: `bandal.json: ${pulled.blocked}` })
      return schedule(timing.waitingMs)
    }
    if (pulled.status === 'incomplete') {
      set({ state: 'waiting', pending: pulled.pending.length })
      return schedule(timing.waitingMs)
    }
    devices = [...pulled.merged.devices].map(([id, device]) => ({ id, ...device }))
    if (pulled.changed.length > 0 || pulled.removed.length > 0 || pulled.markup.length > 0) deps.changed(pulled)
    // Stopped while applying (disconnected): what was applied stays, but nothing more goes to the root.
    if (stopped) return
    const paths = new Set(root.entries.map(entry => entry.path)), own = identity
    const exported = await exportChanges({
      db, device: own.device_id, takeSeq: () => takeSeq(deps.stateFile, own, paths),
      root: { paths, merged: pulled.merged, clock: pulled.clock },
      write: (path, bytes) => provider.write(path, bytes), scan: deps.scan, ...(deps.platform ? { platform: deps.platform } : {})
    }, session)
    // Something could not go up (an upload cut off, a file that would not read): it is tried again, and the state says so.
    if (exported.held.length > 0) throw new Error(exported.held[0]!.reason)
    if (Date.now() - deviceAt >= timing.deviceMs) {
      const now = Date.now()
      await provider.write(`devices/${own.device_id}.json`, Buffer.from(JSON.stringify({ ...deps.device(), last_seen: now })))
      deviceAt = now
    }
    set({ state: 'synced', at: Date.now() })
    schedule(Math.max(0, rescanAt - Date.now()))
  }

  async function once(): Promise<void> {
    try {
      await pass()
      failures = 0
    } catch (error) {
      failures += 1
      set({ state: 'error', message: message(error) })
      // Jittered, so devices that failed together (a Drive outage) do not all retry together.
      schedule(Math.min(timing.maxRetryMs, timing.retryMs * 2 ** (failures - 1)) * (0.5 + Math.random() / 2))
    }
  }

  /**
   * One pass at a time; every call during a pass shares the one pass queued
   * after it. A pass only pokes asked for does not run while failing.
   */
  function run(reason: 'poke' | 'ask' = 'ask'): Promise<void> {
    if (stopped || paused || (reason === 'poke' && failures > 0)) return Promise.resolve()
    if (queued) {
      if (reason === 'ask') queuedFor = 'ask'
      return queued
    }
    if (running) {
      queuedFor = reason
      queued = running.then(() => {
        queued = null
        return run(queuedFor)
      })
      return queued
    }
    running = once().finally(() => {
      running = null
    })
    return running
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      deps.db.prepare('UPDATE sync_runtime SET enabled = 1').run()
      ticker = setInterval(() => {
        const seq = (deps.db.prepare('SELECT MAX(seq) AS seq FROM sync_outbox').get() as { seq: number | null }).seq
        if (seq !== null && seq === lastSeq && seq !== kickedSeq && failures === 0) {
          kickedSeq = seq
          poke()
        }
        lastSeq = seq
      }, timing.idleMs)
      ticker.unref()
      void run()
    },
    syncNow: () => run('ask'),
    devices: () => devices,
    deviceChanged() {
      deviceAt = 0
      void run('ask')
    },
    async pause() {
      paused = true
      await (queued ?? running)
    },
    resume() {
      paused = false
      void run()
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      clearTimeout(hintTimer)
      clearInterval(ticker)
      unwatch?.()
      unwatch = null
      set({ state: 'off' })
      await (queued ?? running)
    },
    state: () => current
  }
}
