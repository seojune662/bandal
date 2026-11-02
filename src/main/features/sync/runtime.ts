/**
 * Sync for the open profile (design 6.1–6.4): its binding in
 * `sync/state.json` (`provider`, and `root`: which root its base is from),
 * the engine while bound, and the steps the settings screen drives. Only the
 * active profile syncs; switching profiles relaunches.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncProviderKind, SyncView } from '../../../shared/types/sync'
import { googleClient } from '../google/oauth'
import type { ApplyContext, ApplyResult } from './apply'
import { forgetRoot, joinRoot, overwriteRoot, planConnect } from './connect'
import { createDriveProvider, DRIVE_TOKEN_FILE, type DriveProvider } from './drive'
import { createSyncEngine, type SyncEngine } from './engine'
import { parseFile, placeholderTarget, type ParsedFile } from './format'
import { createICloudProvider, icloudRoot, type SyncProvider } from './icloud'
import { loadIdentity, machineFingerprint, patchState, readState, takeSeq } from './identity'
import type { Scan } from './localDocs'
import { merge } from './merge'
import { createPull, readMerged, type RootSnapshot } from './pull'

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
  /** `<logs>/sync.log`: a line for each connect that failed or waits, with what was looked at (spec v2.6). */
  logFile?: string
}

const NAME: Record<SyncProviderKind, string> = { icloud: 'iCloud', gdrive: 'Google Drive' }
const kindOf = (value: unknown): SyncProviderKind | null => (value === 'icloud' || value === 'gdrive' ? value : null)
/** The root a base is from. A profile bound before Google Drive existed was bound to iCloud. */
const rootOf = (state: Record<string, unknown>): string => (typeof state.root === 'string' ? state.root : 'icloud')

const run = promisify(execFile)
const MAX_NAME = 64
/** A first upload whose device was seen within this long still runs (spec v2.6). */
const FIRST_UPLOAD_SEEN_MS = 60 * 60_000
/** Until the marking device's file has a `last_seen`, a mark started within this long still runs. */
const FIRST_UPLOAD_START_MS = 5 * 60_000
/** sync.log starts over past this size. */
const MAX_LOG = 1 << 20
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A first-upload mark (spec v2.6): the marking device and `started`, with the name and `last_seen` of its device file when there is one. */
export interface FirstUploadMark {
  device: string
  started: number | null
  name: string | null
  last_seen: number | null
  /** The device file is listed but cannot be read yet: whether the upload still runs cannot be told. */
  pending?: true
}

/**
 * Another device's first upload into this root, by name, and whether it stopped (spec v2.6): `last_seen` more than an
 * hour away from now either way (a clock far ahead would hold everyone back). Before the device file or its `last_seen`
 * is there, `started` stands in for 5 minutes; without either, the upload stopped.
 */
export function firstUpload(mark: FirstUploadMark | null, own: string | null, now = Date.now()): { device: string; stopped: boolean } | null {
  if (mark === null || mark.device === own) return null
  const [at, within] = mark.last_seen === null ? [mark.started, FIRST_UPLOAD_START_MS] : [mark.last_seen, FIRST_UPLOAD_SEEN_MS]
  return { device: (mark.name?.trim() || mark.device.slice(0, 8)).slice(0, MAX_NAME), stopped: at === null || Math.abs(now - at) > within }
}

/**
 * The mark from `bandal.json` and the marking device's file alone, so another device's upload shows before the
 * rest of a root still arriving is readable. `unreadable`: `bandal.json` is listed but cannot be read yet (an
 * iCloud placeholder, a failed download). Null without a mark, or when `bandal.json` is missing or broken: the full read says why.
 */
async function readMark(root: RootSnapshot): Promise<FirstUploadMark | null | 'unreadable'> {
  const listed = (path: string): 'file' | 'placeholder' | null =>
    root.entries.some(entry => entry.path === path) ? 'file' : root.entries.some(entry => placeholderTarget(entry.path) === path) ? 'placeholder' : null
  const read = async (path: string): Promise<ParsedFile | null | 'unreadable'> => {
    let bytes: Uint8Array
    try {
      bytes = await root.read(path)
    } catch {
      return 'unreadable'
    }
    try {
      return parseFile({ path, bytes })
    } catch {
      return null
    }
  }
  if (listed('bandal.json') !== 'file') return null
  const file = await read('bandal.json')
  if (file === 'unreadable') return 'unreadable'
  if (file?.kind !== 'root' || file.initial_upload === undefined) return null
  const path = `devices/${file.initial_upload}.json`, there = listed(path), mark = { device: file.initial_upload, started: file.started ?? null }
  const device = there === 'file' ? await read(path) : null
  if (there === 'placeholder' || device === 'unreadable') return { ...mark, name: null, last_seen: null, pending: true }
  return { ...mark, name: device?.kind === 'device' ? device.name : null, last_seen: device?.kind === 'device' ? device.last_seen : null }
}

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
  /** The root the last connect step listed, for the log. */
  let looked: { key: string | null; entries: number; bandal_json: boolean; initial_upload: string | null } | null = null
  /** Whether the last connect step asked Google Drive for its folders: only then does its lookup belong in the log. */
  let lookedUp = false

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

  /** This profile's device id if it has one; never makes one, as an unbound profile keeps no sync state. */
  const ownDevice = async (): Promise<string | null> => {
    const { device_id, machine: madeOn } = readState(stateFile)
    return typeof device_id === 'string' && madeOn === await machine() ? device_id : null
  }
  /** One line for a connect that failed or waits: what was looked at, for a person reading the log (spec v2.6). */
  function log(step: 'prepare' | 'connect', kind: SyncProviderKind, outcome: string): void {
    if (!deps.logFile) return
    try {
      mkdirSync(dirname(deps.logFile), { recursive: true })
      // ponytail: no rotation, a connect rarely fails; past 1 MiB the log starts over.
      if (existsSync(deps.logFile) && statSync(deps.logFile).size > MAX_LOG) writeFileSync(deps.logFile, '')
      const candidates = kind === 'gdrive' && lookedUp ? providers.gdrive?.lookup() ?? null : undefined
      // An error can carry a path: the home folder (the account name) stays out.
      const line = { at: new Date().toISOString(), step, provider: kind, outcome: outcome.replaceAll(homedir(), '~'), root: looked, ...(candidates !== undefined ? { candidates } : {}) }
      appendFileSync(deps.logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 })
    } catch {
      // A log that cannot be written never stops a connect.
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
    looked = null
    lookedUp = false
    const status = await provider.status()
    if (status !== 'ready') return { status } as const
    const empty = { status: 'merged' as const, merged: merge([{ kind: 'root', path: 'bandal.json', format: 2 }]), clock: 0 }
    let key = 'icloud'
    if (kind === 'gdrive') {
      lookedUp = true
      const folder = await providers.gdrive!.findRoot(make)
      if (folder === null) return { ...empty, key: null, root: { entries: [], read: async () => new Uint8Array() }, started: null }
      key = `gdrive:${folder}`
    }
    const root = await provider.list()
    looked = { key, entries: root.entries.length, bandal_json: root.entries.some(entry => entry.path === 'bandal.json'), initial_upload: null }
    if (root.entries.length === 0) return { ...empty, key, root, started: null }
    // Another device's first upload (spec v2.6) is decided before a full read, which waits for every file.
    const mark = await readMark(root)
    if (mark === 'unreadable') return { status: 'waiting' as const }
    looked.initial_upload = mark?.device ?? null
    const own = await ownDevice()
    // The marking device's file is still arriving: whether its upload runs cannot be told yet.
    if (mark?.pending && mark.device !== own) return { status: 'waiting' as const }
    const started = firstUpload(mark, own)
    if (started && !started.stopped) return { status: 'uploading' as const, device: started.device }
    const read = await readMerged(root)
    if (read.status === 'blocked') return { status: read.blocked === 'update-required' ? 'update-required' as const : 'error' as const, message: `bandal.json: ${read.blocked}` }
    if (read.status === 'incomplete') return { status: 'waiting' as const }
    return { status: 'merged' as const, key, root, merged: read.merged, clock: read.clock, started }
  }

  async function prepare(kind: SyncProviderKind): Promise<ConnectPrepare> {
    if (!providers[kind]) return { status: 'unavailable' }
    // Never while a pass may still run: looking for a Drive folder must not move a provider in use.
    await stopping
    if (engine) return { status: 'error', message: '이미 동기화에 연결돼 있어요.' }
    let read: Awaited<ReturnType<typeof readRoot>>
    try {
      read = await readRoot(kind, false)
    } catch (error) {
      log('prepare', kind, `error: ${messageOf(error)}`)
      throw error
    }
    if (read.status === 'error') {
      log('prepare', kind, `error: ${read.message}`)
      return { status: 'error', message: read.message }
    }
    if (read.status === 'uploading') {
      log('prepare', kind, `uploading: ${read.device}`)
      return { status: 'uploading', device: read.device }
    }
    if (read.status !== 'merged') {
      log('prepare', kind, read.status)
      return { status: read.status }
    }
    // A base from another root (the other provider, or a root made anew) says nothing about this one.
    const plan = await planConnect(db, read.merged, deps.scan, read.key === rootOf(readState(stateFile)))
    return { status: 'ready', plan: read.started ? { ...plan, interrupted: read.started.device } : plan }
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
        throw new Error(read.status === 'error' ? read.message
          : read.status === 'uploading' ? `다른 기기(${read.device})가 아직 올리고 있어요. 다 올린 뒤 다시 연결해 주세요.`
            : read.status === 'needs-auth' ? '먼저 Google 계정을 연결해 주세요.' : `지금은 ${NAME[kind]}에 연결할 수 없어요. 상태를 확인한 뒤 다시 시도해 주세요.`)
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
      if (read.started && plan.kind === 'choose' && mode === 'overwrite') {
        throw new Error(`다른 기기(${read.started.device})가 처음 올리다 멈춘 클라우드라 덮어쓸 수 없어요. 합치기나 가져오기를 골라 주세요.`)
      }
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
      // Finding no folder and making one is how two devices end up apart: that is logged too.
      if (kind === 'gdrive' && providers.gdrive?.lookup()?.made) log('connect', kind, 'made a new root folder')
    } catch (error) {
      log('connect', kind, `error: ${messageOf(error)}`)
      throw error
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
