/**
 * Sync for the open profile (design 6.1–6.2, 6.4): its binding in
 * `sync/state.json`, the engine while bound, and the steps the settings
 * screen drives. Only the active profile syncs; switching profiles relaunches.
 */
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncView } from '../../../shared/types/sync'
import type { ApplyContext, ApplyResult } from './apply'
import { forgetRoot, joinRoot, overwriteRoot, planConnect } from './connect'
import { createSyncEngine, type SyncEngine } from './engine'
import { createICloudProvider, icloudRoot, type SyncProvider } from './icloud'
import { loadIdentity, machineFingerprint, patchState, readState, takeSeq } from './identity'
import type { Scan } from './localDocs'
import { merge } from './merge'
import { createPull, readMerged } from './pull'

export interface SyncRuntimeDeps extends Omit<ApplyContext, 'read'> {
  userDataPath: string
  appVersion: string
  scan(folder: string): Promise<Scan>
  /** An apply changed or removed courses: refresh the windows and release what was removed. */
  changed(result: ApplyResult): void
  /** The view changed: tell the windows. */
  onView(view: SyncView): void
  /** Another profile on this Mac already bound to iCloud, as "기본 프로필"; one root holds one profile (6.4). */
  boundElsewhere(): string | null
  /** Makes a new profile whose sync state starts with `seed`, then relaunches into it (6.2 "가져오기"). */
  newProfile(seed: Record<string, unknown>): Promise<{ ok: boolean; cancelled?: boolean }>
  provider?: SyncProvider
  machine?: () => Promise<string>
}

const run = promisify(execFile)
const MAX_NAME = 64

/** The Mac's name as System Settings shows it ("서준의 MacBook Air"); the host name if that cannot be read. */
async function computerName(): Promise<string> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('/usr/sbin/scutil', ['--get', 'ComputerName'])
      if (stdout.trim() !== '') return stdout.trim()
    }
  } catch {
    // Fall back below.
  }
  return hostname().replace(/\.local$/, '')
}

export function createSyncRuntime(deps: SyncRuntimeDeps) {
  const { db } = deps
  const stateFile = join(deps.userDataPath, 'sync', 'state.json')
  const available = process.platform === 'darwin' || deps.provider !== undefined
  const provider = deps.provider ?? createICloudProvider({ root: icloudRoot(), tmpDir: join(deps.userDataPath, 'sync', 'tmp') })
  const machine = deps.machine ?? machineFingerprint
  const pull = createPull({ db, courses: deps.courses, materials: deps.materials, ...(deps.platform ? { platform: deps.platform } : {}) })
  let fallbackName = hostname().replace(/\.local$/, '')
  void computerName().then(name => {
    fallbackName = name
  })
  let engine: SyncEngine | null = null, busy = false, stopping: Promise<void> | null = null

  const deviceName = (): string => {
    const name = readState(stateFile).device_name
    return typeof name === 'string' && name.trim() !== '' ? name : fallbackName
  }
  const view = (): SyncView => {
    const state = readState(stateFile), id = typeof state.device_id === 'string' ? state.device_id : null
    const pending = (db.prepare('SELECT COUNT(*) AS n FROM (SELECT DISTINCT kind, id FROM sync_outbox)').get() as { n: number }).n
    return {
      available, provider: state.provider === 'icloud' ? 'icloud' : null, state: engine?.state() ?? { state: 'off' },
      device: { id, name: deviceName() },
      devices: (engine?.devices() ?? []).map(device => ({ ...device, self: device.id === id })).sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name)),
      pending
    }
  }
  const publish = (): void => {
    try {
      deps.onView(view())
    } catch {
      // The database closed under a pass that is still finishing (quitting): no window is left to tell.
    }
  }

  function start(): void {
    engine = createSyncEngine({
      db, provider, pull, stateFile, machine, scan: deps.scan, changed: deps.changed,
      device: () => ({ name: deviceName(), platform: process.platform === 'win32' ? 'windows' : 'macos', app_version: deps.appVersion }),
      onState: publish,
      ...(deps.platform ? { platform: deps.platform } : {})
    })
    engine.start()
  }
  /** Unbinds now and stops the engine; resolves once a running pass has finished, so nothing is written after. */
  async function disconnect(): Promise<void> {
    const old = engine
    engine = null
    patchState(stateFile, { provider: null })
    const done = (async () => {
      await old?.stop()
      // Nothing exports while unbound: keep no outbox. A later connect compares everything with the base again.
      db.prepare('UPDATE sync_runtime SET enabled = 0').run()
    })()
    stopping = done
    try {
      await done
    } finally {
      if (stopping === done) stopping = null
      publish()
    }
  }

  /** The root as it is now, merged; an empty root merges to nothing. */
  async function readRoot() {
    const status = await provider.status()
    if (status !== 'ready') return { status } as const
    const root = await provider.list()
    if (root.entries.length === 0) return { status: 'merged' as const, root, merged: merge([{ kind: 'root', path: 'bandal.json', format: 2 }]), clock: 0 }
    const read = await readMerged(root)
    if (read.status === 'blocked') return { status: read.blocked === 'update-required' ? 'update-required' as const : 'error' as const, message: `bandal.json: ${read.blocked}` }
    if (read.status === 'incomplete') return { status: 'waiting' as const }
    return { status: 'merged' as const, root, merged: read.merged, clock: read.clock }
  }

  async function prepare(): Promise<ConnectPrepare> {
    if (!available) return { status: 'unavailable' }
    const read = await readRoot()
    if (read.status === 'error') return { status: 'error', message: read.message }
    if (read.status !== 'merged') return { status: read.status }
    return { status: 'ready', plan: await planConnect(db, read.merged, deps.scan) }
  }

  /**
   * Binds this profile and starts the engine; for `choose`, merges or
   * overwrites first. `expect` is the plan the user saw: if the root changed
   * since, nothing happens and the user is asked again. Throws a message to show.
   */
  async function connect(mode: ConnectMode, pairs: readonly { local: string; remote: string }[], expect?: ConnectPlan['kind']): Promise<void> {
    await stopping
    if (busy) throw new Error('동기화 연결을 이미 진행하고 있어요.')
    if (engine) throw new Error('이미 동기화에 연결돼 있어요.')
    const other = deps.boundElsewhere()
    if (other !== null) throw new Error(`이 저장소는 ${other}과 연결돼 있어요. 그 프로필에서 연결을 해제한 뒤 다시 시도해 주세요.`)
    busy = true
    try {
      if (mode === 'import') {
        // The new profile starts bound and empty: its first pass brings everything there. Nothing here changes.
        const made = await deps.newProfile({ provider: 'icloud' })
        if (!made.ok && made.cancelled !== true) throw new Error('새 프로필을 만들지 못했어요. 지금 자료는 그대로예요.')
        return
      }
      const read = await readRoot()
      if (read.status !== 'merged') throw new Error(read.status === 'error' ? read.message : '지금은 iCloud에 연결할 수 없어요. 상태를 확인한 뒤 다시 시도해 주세요.')
      const plan = await planConnect(db, read.merged, deps.scan)
      if (expect !== undefined && plan.kind !== expect) throw new Error('그사이 iCloud나 이 기기의 자료가 바뀌었어요. 다시 확인해 주세요.')
      // A base from another root would make this profile look already synced: compare everything as new.
      if (plan.kind !== 'resume') forgetRoot(db)
      try {
        if (plan.kind === 'choose' && mode === 'merge') {
          // Only pairs the plan offered, each course at most once.
          const offered = new Set(plan.pairs.map(pair => `${pair.local}\0${pair.remote}`)), locals = new Set<string>(), remotes = new Set<string>()
          const chosen = pairs.filter(pair => {
            if (!offered.has(`${pair.local}\0${pair.remote}`) || locals.has(pair.local) || remotes.has(pair.remote)) return false
            locals.add(pair.local)
            remotes.add(pair.remote)
            return true
          })
          await joinRoot(db, read.merged, chosen, deps.scan)
        }
        if (plan.kind === 'choose' && mode === 'overwrite') {
          const identity = loadIdentity(stateFile, await machine())
          const paths = new Set(read.root.entries.map(entry => entry.path))
          await overwriteRoot(read.merged, read.clock, identity.device_id, () => takeSeq(stateFile, identity, paths), (path, bytes) => provider.write(path, bytes))
        }
      } catch (error) {
        // Half a merge would look like an earlier sync next time: start clean instead.
        forgetRoot(db)
        throw error
      }
      patchState(stateFile, { provider: 'icloud' })
      start()
    } finally {
      busy = false
      publish()
    }
  }

  function rename(name: string): void {
    const trimmed = name.normalize('NFC').trim()
    if (trimmed === '' || trimmed.length > MAX_NAME || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) throw new Error('기기 이름은 1~64자로, 제어 문자 없이 써 주세요.')
    patchState(stateFile, { device_name: trimmed })
    engine?.deviceChanged()
    publish()
  }

  if (available && readState(stateFile).provider === 'icloud') start()
  else db.prepare('UPDATE sync_runtime SET enabled = 0').run()

  return {
    view,
    prepare,
    connect,
    disconnect,
    /** This profile stops being the active one (a new profile was made): unbind it, so the next one can connect. */
    release: () => void disconnect(),
    syncNow: async () => {
      await engine?.syncNow()
      publish()
    },
    rename,
    /** This profile syncs now: its synced PDFs only take end-page appends. */
    bound: () => engine !== null,
    pause: async () => engine?.pause(),
    resume: () => engine?.resume(),
    stop: () => engine?.stop()
  }
}

export type SyncRuntime = ReturnType<typeof createSyncRuntime>

/** Another profile on this Mac bound to iCloud, named for the user, or null (design 6.4). Profiles have no names of their own. */
export function profileBoundElsewhere(baseRoot: string, current: string): string | null {
  let ids: string[] = []
  try {
    ids = readdirSync(join(baseRoot, 'profiles'))
  } catch {
    // No other profile was ever made.
  }
  for (const dir of [baseRoot, ...ids.map(id => join(baseRoot, 'profiles', id))]) {
    if (resolve(dir) === resolve(current) || readState(join(dir, 'sync', 'state.json')).provider !== 'icloud') continue
    if (dir === baseRoot) return '기본 프로필'
    try {
      const created = (JSON.parse(readFileSync(join(dir, 'isolated-profile.json'), 'utf8')) as { createdAt?: unknown }).createdAt
      if (typeof created === 'string') return `${created.slice(0, 10)}에 만든 프로필`
    } catch {
      // Unreadable: named generically below.
    }
    return '다른 프로필'
  }
  return null
}
