import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, openSync, writeSync, writeFileSync, unlinkSync, fsyncSync, closeSync, renameSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import type { RuntimeSyncState, RuntimeSyncConflict } from '../../../shared/types/subscription'
import { join, dirname } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { readSupabaseConfig } from '../account/config'

interface Dependencies {
  db: Database
  userDataPath: string
  getClient(): SupabaseClient | null
  changed(courseIds: string[]): void
  canAccess?(): boolean
  profileBusy?(): boolean
}
let runtime: IPadCompanion | undefined
const AUTO_ID = 'ipad-companion-auto'

/** This menu is available without granting renderer/webview access to tokens. */
export function iPadCompanionMenu(): MenuItemConstructorOptions {
  const run = (action: (service: IPadCompanion) => Promise<void>): void => {
    if (!runtime) return
    void action(runtime).catch(error => dialog.showMessageBox({ type: 'error', title: 'iPad 연결',
      message: error instanceof Error ? error.message : '작업을 완료하지 못했습니다.' }))
  }
  return { label: 'iPad', submenu: [
    { label: 'iPad로 자료 내보내기…', click: () => run(service => service.exportPack()) },
    { label: 'iPad 자료 가져오기…', click: () => run(service => service.importPack()) },
    { type: 'separator' },
    { id: AUTO_ID, label: '계정으로 자동 동기화', type: 'checkbox', checked: runtime?.enabled ?? false,
      click: item => run(service => service.setEnabled(item.checked)) },
    { label: '지금 동기화', click: () => run(service => service.synchronize()) },
    { id: 'ipad-companion-billing', label: '구독 관리…', click: () => {
      void shell.openExternal('https://bandal.io/billing').catch(() => dialog.showMessageBox({ type: 'error', title: '구독 관리',
        message: '브라우저를 열지 못했습니다. https://bandal.io/billing 에서 구독을 관리해 주세요.' }))
    } },
    { label: '동기화 상태', click: () => {
      void dialog.showMessageBox({ title: 'iPad 연결', message: runtime?.status ?? '준비 중입니다.' })
    } }
  ] }
}

export function installIPadCompanion(deps: Dependencies): IPadCompanion {
  runtime?.dispose()
  runtime = new IPadCompanion(deps)
  return runtime
}

export class IPadCompanion {
  enabled = false
  status = '자동 동기화 꺼짐'
  private child: ChildProcess | null = null
  private busy = false
  private activeWork: Promise<void> | null = null
  private cancellationFile: string | null = null
  private generation = 0
  private readonly directory: string
  private readonly timer: ReturnType<typeof setInterval>
  private userID: string | null = null
  private boundUserID: string | null = null
  private localDirty = true
  private debounce: ReturnType<typeof setTimeout> | null = null
  private running = false
  private suspended = false
  private failures = 0
  private retryTime = 0
  private cursor = 0
  private report: RuntimeSyncState = { phase: 'idle', enabled: false, pending: 0, conflicts: 0 }
  private hasCompleted = false
  private geometryCache = new Map<string, string>()
  private readonly onForeground = (): void => { if (this.enabled) { this.retryTime = 0; void this.synchronize().catch(() => {}) } }
  state(): RuntimeSyncState {
    const hasPending = this.deps.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pdf_pending_mutations'").get()
    const pending = hasPending ? (this.deps.db.prepare('SELECT count(*) AS count FROM pdf_pending_mutations WHERE resolved_at IS NULL').get() as { count: number }).count : 0
    return { ...this.report, conflicts: Math.max(this.report.conflicts, pending), enabled: this.enabled, message: this.status }
  }
  async conflicts(): Promise<RuntimeSyncConflict[]> {
    const reports = await this.perform('conflicts', this.exchangeFor(this.boundUserID))
    const last = reports.find(value => Array.isArray(value.conflicts))
    const count = (last?.status as {conflicts?:number} | undefined)?.conflicts
    if (typeof count === 'number') this.report.conflicts = count
    return (last?.conflicts ?? []) as RuntimeSyncConflict[]
  }
  async resolveConflict(id: string, choice: 'local' | 'remote'): Promise<RuntimeSyncState> {
    if (!/^(?:[0-9a-f]{64}|[0-9a-f-]{36}|pending-ink:[0-9a-f-]{36})$/i.test(id) || !['local', 'remote'].includes(choice)) throw new Error('Invalid conflict choice')
    await this.perform('resolve-conflict', this.exchangeFor(this.boundUserID), ['--conflict-id', id, '--choice', choice])
    this.refresh(); this.localChanged()
    await this.conflicts()
    return this.state()
  }
  localChanged(): void {
    this.localDirty = true
    if (this.debounce) clearTimeout(this.debounce)
    if (this.enabled) this.debounce = setTimeout(() => { this.debounce = null; void this.synchronize().catch(() => {}) }, 2000)
  }

  constructor(private readonly deps: Dependencies) {
    this.directory = join(deps.userDataPath, 'ipad-companion')
    try {
      const preferences = JSON.parse(readFileSync(join(this.directory, 'preferences.json'), 'utf8'))
      this.boundUserID = typeof preferences.boundUserID === 'string' ? preferences.boundUserID : null
      this.enabled = preferences.enabled === true && this.boundUserID !== null
    } catch { /* First launch; no automatic upload without an explicit account binding. */ }
    try {
      const saved = JSON.parse(readFileSync(join(this.directory, 'status.json'), 'utf8'))
      if (this.boundUserID && saved.userID === this.boundUserID && saved.report) {
        this.report = { ...saved.report, phase: 'idle', retryAt: null }
        this.cursor = Number.isSafeInteger(saved.cursor) && saved.cursor >= 0 ? saved.cursor : 0
        this.hasCompleted = true
      }
    } catch { /* Status is informative; source queues remain authoritative. */ }
    this.timer = setInterval(() => {
      if (this.enabled && !this.busy && (this.report.phase !== 'waiting' || Date.now() >= this.retryTime)) void this.synchronize().catch(error => {
        this.status = error instanceof Error ? error.message : '동기화 대기 중'
      })
    }, 15_000)
    this.timer.unref()
    app.on('browser-window-focus', this.onForeground)
    const menu = Menu.getApplicationMenu()?.getMenuItemById(AUTO_ID)
    if (menu) menu.checked = this.enabled
  }

  dispose(): void { clearInterval(this.timer); if (this.debounce) clearTimeout(this.debounce); app.off('browser-window-focus', this.onForeground); this.cancel() }
  pause(): void { this.suspended = true; this.cancel(); this.report = { ...this.report, phase: 'paused', blockedReason: 'authentication_required' }; this.status = '로그인 후 동기화를 계속합니다.' }
  async pauseAndDrain(): Promise<void> {
    this.pause()
    const work = this.activeWork
    if (!work) return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('동기화 종료를 기다리고 있습니다. 잠시 후 백업을 다시 시도해 주세요.')), 10_000)
      void work.then(() => { clearTimeout(timeout); resolve() })
    })
  }
  resume(): void { this.suspended = false; this.retryTime = 0; this.localChanged() }
  private cancel(): void {
    this.generation += 1
    // Terminating Python can orphan its active Node projector, especially on
    // Windows. Let it finish the current atomic operation, then stop at the
    // next bridge boundary; the backup waits for the entire operation to exit.
    if (this.cancellationFile) {
      try { writeFileSync(this.cancellationFile, 'cancelled', { mode: 0o600 }) }
      catch { /* Drain still waits for natural completion; it never assumes cancellation succeeded. */ }
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) await this.session()
    this.enabled = enabled
    this.suspended = false
    if (!enabled) this.cancel()
    this.savePreferences()
    this.status = enabled ? '자동 동기화 대기 중' : '자동 동기화 꺼짐'
    if (enabled) await this.synchronize(true)
  }

  private savePreferences(): void {
    mkdirSync(this.directory, { recursive: true })
    const target = join(this.directory, 'preferences.json')
    const temporary = `${target}.partial`
    const descriptor = openSync(temporary, 'w', 0o600)
    try { writeSync(descriptor, JSON.stringify({ enabled: this.enabled, boundUserID: this.boundUserID })); fsyncSync(descriptor) }
    finally { closeSync(descriptor) }
    renameSync(temporary, target)
  }

  private async session(): Promise<{ userID: string; token: string }> {
    const client = this.deps.getClient()
    if (!client) throw new Error('설정에서 반달 계정에 로그인해 주세요.')
    const { data, error } = await client.auth.getSession()
    if (error || !data.session) throw new Error('설정에서 반달 계정에 로그인해 주세요.')
    if (this.boundUserID !== null && this.boundUserID !== data.session.user.id) {
      this.cancel()
      throw new Error('이 데스크톱 자료는 다른 반달 계정에 연결되어 있습니다. 기존 계정으로 로그인하거나 별도 데스크톱 프로필을 사용해 주세요.')
    }
    if (this.boundUserID === null) {
      this.boundUserID = data.session.user.id
      try { this.savePreferences() } catch (error) { this.boundUserID = null; throw error }
    }
    if (this.userID !== null && this.userID !== data.session.user.id) this.cancel()
    this.userID = data.session.user.id
    return { userID: data.session.user.id, token: data.session.access_token }
  }

  private exchangeFor(userID: string | null): string {
    return join(this.directory, userID ?? 'offline')
  }

  async exportPack(): Promise<void> {
    const result = await dialog.showSaveDialog({ title: 'iPad로 자료 내보내기', defaultPath: '반달 자료.bandalpack',
      filters: [{ name: '반달 자료', extensions: ['bandalpack'] }] })
    if (result.canceled || !result.filePath) return
    await this.perform('export', this.exchangeFor(null), ['--pack', result.filePath])
    this.status = '자료 패키지를 저장했습니다.'
  }

  async importPack(): Promise<void> {
    if (this.deps.canAccess?.() === false) throw new Error('먼저 원래 반달 계정에 로그인해 주세요.')
    const result = await dialog.showOpenDialog({ title: 'iPad 자료 가져오기', properties: ['openFile'],
      filters: [{ name: '반달 자료', extensions: ['bandalpack'] }] })
    const file = result.filePaths[0]
    if (result.canceled || !file) return
    const exchange = this.exchangeFor(null)
    // Capture local baselines first; the importer refuses intervening edits.
    await this.perform('export', exchange)
    await this.perform('import', exchange, ['--pack', file])
    this.refresh(); this.status = 'iPad 자료를 가져왔습니다. 충돌 사본과 원본 백업은 기기에 보관됩니다.'
  }

  async synchronize(force = false): Promise<void> {
    if (!this.enabled) throw new Error('계정 화면에서 모든 과목 동기화에 먼저 동의해 주세요.')
    if (this.suspended && !force) return
    if (force) this.suspended = false
    if (this.busy || this.running || (!force && this.report.phase === 'waiting' && Date.now() < this.retryTime)) return
    this.running = true
    const expected = this.generation
    try {
      const session = await this.session()
      if (expected !== this.generation || this.suspended) return
      const config = readSupabaseConfig()
      if (!config) throw new Error('동기화 서버가 구성되지 않았습니다.')
      if (!this.localDirty && !force && this.hasCompleted) {
        const probe = await this.deps.getClient()!.rpc('bandal_pull', { p_after: this.cursor, p_limit: 1 })
        if (expected !== this.generation || this.suspended) return
        if (probe.error) throw new Error('원격 변경을 확인하지 못했습니다.')
        if (!probe.data?.records?.length && (this.report.writeAllowed === true || Date.now() < this.retryTime)) return
      }
      this.status = '기기 간 자료 동기화 중…'
      this.report = { ...this.report, phase: 'syncing' }
      this.localDirty = false
      const reports = await this.perform('cycle', this.exchangeFor(session.userID), [], {
        BANDAL_SUPABASE_URL: config.url, BANDAL_SUPABASE_KEY: config.publishableKey,
        BANDAL_USER_ID: session.userID, BANDAL_ACCESS_TOKEN: session.token
      })
      if (expected !== this.generation) return
      const completed = reports.find(value => value.status && value.sync) ?? {}
      const summary = (completed.status ?? {}) as Record<string, unknown>
      const result = (completed.sync ?? {}) as Record<string, unknown>
      this.cursor = typeof result.cursor === 'number' ? result.cursor : this.cursor
      const access = (summary.access ?? result.access ?? {}) as Record<string, unknown>
      const blocked = typeof access.reason === 'string' ? access.reason : access.writeAllowed === false ? 'subscription_required' : null
      this.retryTime = blocked ? Date.now() + 300_000 : 0
      this.failures = 0
      this.report = { phase: blocked ? 'paused' : 'idle', enabled: this.enabled,
        pending: Number(summary.pending ?? 0), conflicts: Number(summary.conflicts ?? 0),
        writeAllowed: !blocked, blockedReason: blocked,
        storageUsedBytes: Number(access.storageUsedBytes ?? 0), storageLimitBytes: Number(access.storageLimitBytes ?? 0),
        retryAt: this.retryTime ? new Date(this.retryTime).toISOString() : null, lastSyncedAt: new Date().toISOString() }
      this.hasCompleted = true
      try {
        await writeFile(join(this.directory, 'status.json'), JSON.stringify({ userID: session.userID, cursor: this.cursor, report: this.report }), { mode: 0o600 })
      } catch { /* Failure to cache display status never discards durable queues. */ }
      this.refresh(); this.status = blocked ? String(access.message ?? result.accessWarning ?? '업로드가 중단되었습니다. 로컬 변경은 보관되며 기존 자료는 내려받을 수 있습니다.') : `동기화 완료 · ${new Date().toLocaleTimeString()}`
    } catch (error) {
      if (expected === this.generation) {
        this.localDirty = true
        const delay = Math.min(300_000, 5000 * 2 ** Math.min(this.failures++, 6))
        this.retryTime = Date.now() + delay + Math.floor(Math.random() * Math.min(1000, delay / 5))
        this.status = error instanceof Error ? error.message : '동기화가 중단되었습니다. 대기 중인 변경은 보관됩니다.'
        this.report = { ...this.report, phase: 'waiting', error: this.status, retryAt: new Date(this.retryTime).toISOString() }
      }
      throw error
    } finally { this.running = false }
  }

  private refresh(): void {
    const ids = this.deps.db.prepare('SELECT id FROM courses WHERE deleted_at IS NULL').all() as { id: string }[]
    this.deps.changed(ids.map(row => row.id))
  }

  private async prepareGeometry(exchange: string): Promise<void> {
    await mkdir(exchange, { recursive: true })
    const courses = this.deps.db.prepare('SELECT folder_path FROM courses WHERE deleted_at IS NULL').all() as { folder_path: string }[]
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) { await visit(path); continue }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
        const info = await stat(path)
        const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`
        if (this.geometryCache.get(path) === stamp) continue
        const bytes = await readFile(path)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const target = join(exchange, `geometry-${hash}.json`)
        if (existsSync(target)) { this.geometryCache.set(path, stamp); continue }
        const pdf = await PDFDocument.load(bytes)
        const geometry = pdf.getPages().map(page => {
          const box = page.getCropBox()
          return { cropX: box.x, cropY: box.y, width: box.width, height: box.height,
            rotation: ((page.getRotation().angle % 360) + 360) % 360 }
        })
        await writeFile(target, JSON.stringify(geometry))
        this.geometryCache.set(path, stamp)
      }
    }
    for (const course of courses) await visit(course.folder_path)
  }

  private async perform(command: string, exchange: string, extra: string[] = [], environment: NodeJS.ProcessEnv = {}): Promise<Array<Record<string, unknown>>> {
    if (this.deps.profileBusy?.()) throw new Error('자료 백업 중입니다. 잠시 후 다시 시도해 주세요.')
    if (command !== 'export' && this.deps.canAccess?.() === false) throw new Error('먼저 원래 반달 계정에 로그인해 주세요.')
    if (this.busy) throw new Error('이전 자료 작업이 완료될 때까지 기다려 주세요.')
    this.busy = true
    const generation = this.generation
    let settled!: () => void
    const work = new Promise<void>(resolve => { settled = resolve })
    this.activeWork = work
    let cancellationFile: string | null = null
    try {
      if (['export', 'cycle', 'watch'].includes(command)) await this.prepareGeometry(exchange)
      if (generation !== this.generation) throw new Error('자료 작업이 중단되었습니다. 기기 자료와 대기 중인 변경은 보관됩니다.')
      const developmentDirectories = [join(app.getAppPath(), 'resources', 'ipad-bridge'), join(__dirname, '../../resources/ipad-bridge')] as const
      const projectorDirectory = app.isPackaged ? join(process.resourcesPath, 'ipad-bridge')
        : developmentDirectories.find(directory => existsSync(join(directory, 'projector-host.cjs')) && existsSync(join(directory, 'backend.js'))) ?? developmentDirectories[0]
      const moduleRoot = app.isPackaged ? app.getAppPath() : dirname(dirname(projectorDirectory))
      const projector = join(projectorDirectory, 'projector-host.cjs')
      const projectionBackend = join(projectorDirectory, 'backend.js')
      if (!existsSync(projector) || !existsSync(projectionBackend)) throw new Error('공통 동기화 변환기가 없습니다. 앱 설치 파일을 확인해 주세요.')
      const helper = process.env['BANDAL_IPAD_BRIDGE'] ?? join(projectorDirectory, 'bridge.py')
      const bundledExecutable = join(process.resourcesPath, 'ipad-bridge', process.platform === 'win32' ? 'bandal-ipad-bridge.exe' : 'bandal-ipad-bridge')
      const executable = process.env['BANDAL_IPAD_BRIDGE_EXECUTABLE'] ?? (app.isPackaged ? bundledExecutable : undefined)
      if (executable && !existsSync(executable)) throw new Error('번들 iPad 동기화 도우미가 없습니다. 앱 설치 파일을 확인해 주세요.')
      if (!executable && !existsSync(helper)) throw new Error('iPad 동기화 도우미를 찾을 수 없습니다.')
      const args = [command, '--desktop-db', join(this.deps.userDataPath, 'bandal.db'),
        '--exchange', exchange, '--course-root', join(this.deps.userDataPath, 'iPad Courses'), ...extra]
      mkdirSync(exchange, { recursive: true })
      cancellationFile = join(exchange, `cancel-${randomUUID()}.flag`)
      this.cancellationFile = cancellationFile
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const child = spawn(executable ?? process.env['BANDAL_PYTHON'] ?? (process.platform === 'win32' ? 'python' : 'python3'),
          executable ? args : [helper, ...args], { windowsHide: true, env: { ...process.env, ...environment,
            BANDAL_DESKTOP_PROJECTOR: projector,
            BANDAL_DESKTOP_RUNTIME: process.execPath,
            BANDAL_DESKTOP_MODULE_ROOT: moduleRoot,
            BANDAL_CANCEL_FILE: cancellationFile!,
            BANDAL_DESKTOP_BACKEND: projectionBackend } })
        this.child = child
        let detail = ''
        // A multibyte character can span pipe chunks. Decode the stream, not
        // individual Buffers, to preserve Korean paths and conflict summaries.
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => { detail = (detail + chunk).slice(-2000) })
        // Parse bounded machine status; never log payloads or credentials.
        let output = ''
        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => { output = (output + chunk).slice(-262144) })
        child.once('error', () => {
          if (!child.pid) {
            if (this.child === child) this.child = null
            reject(new Error('동기화 도우미를 실행할 수 없습니다. 앱 설치 파일을 확인해 주세요.'))
          }
        })
        // exit can precede the final pipe data; close also waits for stdio.
        child.once('close', code => {
          if (this.child === child) this.child = null
          const reports: Array<Record<string, unknown>> = []
          for (const line of output.split('\n')) { try { const value = JSON.parse(line); if (value && typeof value === 'object') reports.push(value) } catch { /* helper diagnostics */ } }
          const completedPull = reports.some(value => value.sync && (value.status as { access?: { writeAllowed?: boolean } } | undefined)?.access?.writeAllowed === false)
          if (code === 0 || (code === 1 && completedPull)) resolve(reports)
          else reject(new Error(detail.trim() || '동기화가 중단되었습니다. 기기 자료와 대기 중인 변경은 보관됩니다.'))
        })
      })
    } finally {
      this.busy = false
      if (this.cancellationFile === cancellationFile) this.cancellationFile = null
      if (cancellationFile) { try { unlinkSync(cancellationFile) } catch { /* A completed operation needs no marker. */ } }
      if (this.activeWork === work) this.activeWork = null
      settled()
    }
  }
}
