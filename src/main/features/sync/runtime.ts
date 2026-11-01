/**
 * Sync for the open profile (design 6.1–6.4): its binding in
 * `sync/state.json` (`provider`, and `root`: which root its base is from),
 * the engine while bound, and the steps the settings screen drives. Only the
 * active profile syncs; switching profiles relaunches.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncProviderKind, SyncView } from '../../../shared/types/sync'
import { googleClient } from '../google/oauth'
import type { ApplyContext, ApplyResult } from './apply'
import { forgetRoot, joinRoot, overwriteRoot, planConnect } from './connect'
import { createDriveProvider, DRIVE_TOKEN_FILE, type DriveProvider } from './drive'
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
  /** Another profile on this computer already bound to `root`, as "기본 프로필"; one root holds one profile (6.4). */
  boundElsewhere(root: string): string | null
  /** Makes a new profile whose sync state starts with `seed`, `files` beside it, then relaunches into it (6.2 "가져오기"). */
  newProfile(seed: Record<string, unknown>, files?: Record<string, Uint8Array>): Promise<{ ok: boolean; cancelled?: boolean }>
  /** Whether a window has focus and how long input has been idle: how often Google Drive is asked for changes. */
  activity?(): { focused: boolean; idleSeconds: number }
  /** Stand-ins for iCloud and Google Drive (tests); only these are offered. */
  providers?: { icloud?: SyncProvider; gdrive?: DriveProvider }
  machine?: () => Promise<string>
}

const NAME: Record<SyncProviderKind, string> = { icloud: 'iCloud', gdrive: 'Google Drive' }
const kindOf = (value: unknown): SyncProviderKind | null => (value === 'icloud' || value === 'gdrive' ? value : null)
/** The root a base is from. A profile bound before Google Drive existed was bound to iCloud. */
const rootOf = (state: Record<string, unknown>): string => (typeof state.root === 'string' ? state.root : 'icloud')

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
  const saved = readState(stateFile).root
  const providers = deps.providers ?? {
    ...(process.platform === 'darwin' ? { icloud: createICloudProvider({ root: icloudRoot(), tmpDir: join(deps.userDataPath, 'sync', 'tmp') }) } : {}),
    ...(googleClient().clientId ? {
      gdrive: createDriveProvider({
        dir: join(deps.userDataPath, 'sync'), root: typeof saved === 'string' && saved.startsWith('gdrive:') ? saved.slice('gdrive:'.length) : null,
        activity: deps.activity ?? (() => ({ focused: false, idleSeconds: Infinity }))
      })
    } : {})
  }
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
      available: { icloud: providers.icloud !== undefined, gdrive: providers.gdrive !== undefined },
      provider: kindOf(state.provider), account: providers.gdrive?.signedIn() ? providers.gdrive.account() ?? '' : null, state: engine?.state() ?? { state: 'off' },
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

  function start(kind: SyncProviderKind): void {
    engine = createSyncEngine({
      db, provider: providers[kind]!, pull, stateFile, machine, scan: deps.scan, changed: deps.changed,
      device: () => ({ name: deviceName(), platform: process.platform === 'win32' ? 'windows' : 'macos', app_version: deps.appVersion }),
      onState: publish,
      ...(deps.platform ? { platform: deps.platform } : {})
    })
    engine.start()
  }
  /**
   * Unbinds now and stops the engine; resolves once a running pass has
   * finished, so nothing is written after. Google Drive's token goes too.
   */
  async function disconnect(): Promise<void> {
    const old = engine, kind = kindOf(readState(stateFile).provider)
    engine = null
    patchState(stateFile, { provider: null })
    const done = (async () => {
      await old?.stop()
      // Nothing exports while unbound: keep no outbox. A later connect compares everything with the base again.
      db.prepare('UPDATE sync_runtime SET enabled = 0').run()
      if (kind === 'gdrive') await providers.gdrive?.signOut()
    })()
    stopping = done
    try {
      await done
    } finally {
      if (stopping === done) stopping = null
      publish()
    }
  }

  /**
   * A root as it is now, merged, with `key`, which root it is (`icloud`,
   * `gdrive:<folder id>`). An empty root merges to nothing; so does Google
   * Drive without a Bandal folder, which `make` makes (connecting, not looking).
   */
  async function readRoot(kind: SyncProviderKind, make: boolean) {
    const provider = providers[kind]!
    const status = await provider.status()
    if (status !== 'ready') return { status } as const
    const empty = { status: 'merged' as const, merged: merge([{ kind: 'root', path: 'bandal.json', format: 2 }]), clock: 0 }
    let key = 'icloud'
    if (kind === 'gdrive') {
      const folder = await providers.gdrive!.findRoot(make)
      if (folder === null) return { ...empty, key: null, root: { entries: [], read: async () => new Uint8Array() } }
      key = `gdrive:${folder}`
    }
    const root = await provider.list()
    if (root.entries.length === 0) return { ...empty, key, root }
    const read = await readMerged(root)
    if (read.status === 'blocked') return { status: read.blocked === 'update-required' ? 'update-required' as const : 'error' as const, message: `bandal.json: ${read.blocked}` }
    if (read.status === 'incomplete') return { status: 'waiting' as const }
    return { status: 'merged' as const, key, root, merged: read.merged, clock: read.clock }
  }

  async function prepare(kind: SyncProviderKind): Promise<ConnectPrepare> {
    if (!providers[kind]) return { status: 'unavailable' }
    // Never while a pass may still run: looking for a Drive folder must not move a provider in use.
    await stopping
    if (engine) return { status: 'error', message: '이미 동기화에 연결돼 있어요.' }
    const read = await readRoot(kind, false)
    if (read.status === 'error') return { status: 'error', message: read.message }
    if (read.status !== 'merged') return { status: read.status }
    // A base from another root (the other provider, or a root made anew) says nothing about this one.
    return { status: 'ready', plan: await planConnect(db, read.merged, deps.scan, read.key === rootOf(readState(stateFile))) }
  }

  /**
   * Binds this profile and starts the engine; for `choose`, merges or
   * overwrites first. `expect` is the plan the user saw: if the root changed
   * since, nothing happens and the user is asked again. Throws a message to show.
   */
  async function connect(kind: SyncProviderKind, mode: ConnectMode, pairs: readonly { local: string; remote: string }[], expect?: ConnectPlan['kind']): Promise<void> {
    await stopping
    if (busy) throw new Error('동기화 연결을 이미 진행하고 있어요.')
    if (engine) throw new Error('이미 동기화에 연결돼 있어요.')
    if (!providers[kind]) throw new Error(`이 기기에서는 ${NAME[kind]} 동기화를 쓸 수 없어요.`)
    busy = true
    try {
      const read = await readRoot(kind, true)
      if (read.status !== 'merged' || read.key === null) {
        throw new Error(read.status === 'error' ? read.message : read.status === 'needs-auth' ? '먼저 Google 계정을 연결해 주세요.' : `지금은 ${NAME[kind]}에 연결할 수 없어요. 상태를 확인한 뒤 다시 시도해 주세요.`)
      }
      const other = deps.boundElsewhere(read.key)
      if (other !== null) throw new Error(`이 저장소는 ${other}과 연결돼 있어요. 그 프로필에서 연결을 해제한 뒤 다시 시도해 주세요.`)
      if (mode === 'import') {
        // The new profile starts bound and empty: its first pass brings everything there. Nothing here changes.
        // Google Drive's token goes with it, still encrypted, so it needs no second sign-in.
        const token = join(deps.userDataPath, 'sync', DRIVE_TOKEN_FILE)
        const made = await deps.newProfile({ provider: kind, root: read.key }, kind === 'gdrive' && existsSync(token) ? { [DRIVE_TOKEN_FILE]: readFileSync(token) } : {})
        if (!made.ok && made.cancelled !== true) throw new Error('새 프로필을 만들지 못했어요. 지금 자료는 그대로예요.')
        return
      }
      const plan = await planConnect(db, read.merged, deps.scan, read.key === rootOf(readState(stateFile)))
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
          await overwriteRoot(read.merged, read.clock, identity.device_id, () => takeSeq(stateFile, identity, paths), (path, bytes) => providers[kind]!.write(path, bytes))
        }
      } catch (error) {
        // Half a merge would look like an earlier sync next time: start clean instead.
        forgetRoot(db)
        throw error
      }
      patchState(stateFile, { provider: kind, root: read.key })
      start(kind)
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

  /** Google sign-in for sync: before connecting, or again when the token stopped working. */
  async function signIn(): Promise<void> {
    if (!providers.gdrive) throw new Error('이 기기에서는 Google Drive 동기화를 쓸 수 없어요.')
    await providers.gdrive.signIn()
    publish()
    void engine?.syncNow()
  }

  const boundTo = kindOf(readState(stateFile).provider)
  if (boundTo !== null && providers[boundTo]) start(boundTo)
  else db.prepare('UPDATE sync_runtime SET enabled = 0').run()

  return {
    view,
    prepare,
    connect,
    disconnect,
    signIn,
    /** This profile stops being the active one (a new profile was made): unbind it, so the next one can connect. An unbound profile is left untouched. */
    release: () => {
      if (readState(stateFile).provider) void disconnect()
    },
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

/** Another profile on this computer bound to `root`, named for the user, or null (design 6.4). Profiles have no names of their own. */
export function profileBoundElsewhere(baseRoot: string, current: string, root: string): string | null {
  let ids: string[] = []
  try {
    ids = readdirSync(join(baseRoot, 'profiles'))
  } catch {
    // No other profile was ever made.
  }
  for (const dir of [baseRoot, ...ids.map(id => join(baseRoot, 'profiles', id))]) {
    const state = readState(join(dir, 'sync', 'state.json'))
    if (resolve(dir) === resolve(current) || kindOf(state.provider) === null || rootOf(state) !== root) continue
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
