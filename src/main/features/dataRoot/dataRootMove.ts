/**
 * Moves managed course folders out of the legacy `~/Documents/Bandal` root.
 *
 * iCloud "Desktop & Documents" (and OneDrive folder redirection) evicts files
 * there, so a course could fail to open offline. The move COPIES instead of
 * renaming: renaming out of an iCloud folder reads as a deletion to iCloud,
 * and the original folder stays untouched as the user's fallback.
 *
 * Order: copy + verify into `<to>.partial` → one DB transaction rewrites the
 * stored absolute paths, renames the staging folder into place and switches
 * the setting. A journal next to settings.json lets the next launch finish or
 * undo a move that a crash interrupted.
 */
import type { Database } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { constants, createReadStream, existsSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, cp, mkdir, open, readdir, readlink, stat, symlink } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

export interface DataRootMove {
  from: string
  to: string
  /** The setting still points at the legacy root, so new courses move too. */
  switchSetting: boolean
  folders: Array<{ from: string; to: string }>
}

export interface DataRootMoveDeps {
  journalPath: string
  setDataRoot(root: string): void
  progress?(doneBytes: number, totalBytes: number): void
  /** Waiting for iCloud to download one evicted file. */
  materializeTimeoutMs?: number
}

export class DataRootMoveError extends Error {
  constructor(readonly code: 'target-not-empty' | 'materialize-timeout' | 'verify-failed', message: string) { super(message) }
}

type Journal = DataRootMove & { state: 'copying' | 'switching' }

const inside = (root: string, path: string): boolean => path === root || path.startsWith(root + sep)
const rebase = (move: Pick<DataRootMove, 'from' | 'to'>, path: string): string => join(move.to, relative(move.from, path))
const tableExists = (db: Database, name: string): boolean => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))

export function planDataRootMove(db: Database, input: { legacyRoot: string; newRoot: string; currentDataRoot: string }): DataRootMove | null {
  const rows = db.prepare("SELECT folder_path FROM courses WHERE source = 'managed'").all() as Array<{ folder_path: string }>
  const folders = [...new Set(rows.map(row => row.folder_path).filter(path => path !== input.legacyRoot && inside(input.legacyRoot, path)))]
    .map(path => ({ from: path, to: rebase({ from: input.legacyRoot, to: input.newRoot }, path) }))
  const switchSetting = input.currentDataRoot === input.legacyRoot
  if (folders.length === 0 && !switchSetting) return null
  return { from: input.legacyRoot, to: input.newRoot, switchSetting, folders }
}

export async function moveDataRoot(db: Database, move: DataRootMove, deps: DataRootMoveDeps): Promise<void> {
  const staging = `${move.to}.partial`
  if (existsSync(move.to) && readdirSync(move.to).length > 0) {
    throw new DataRootMoveError('target-not-empty', `새 자료 위치에 이미 파일이 있어요: ${move.to}`)
  }
  rmSync(staging, { recursive: true, force: true })
  writeJournal(deps.journalPath, { ...move, state: 'copying' })
  try {
    const sources = move.folders.filter(folder => existsSync(folder.from))
    const files = (await Promise.all(sources.map(folder => listFiles(folder.from)))).flat()
    const total = files.reduce((sum, file) => sum + file.size, 0)
    let done = 0
    for (const folder of sources) await mkdir(rebase({ from: move.from, to: staging }, folder.from), { recursive: true })
    for (const file of files) {
      await copyVerified(file, rebase({ from: move.from, to: staging }, file.path), deps.materializeTimeoutMs ?? 120_000)
      done += file.size
      deps.progress?.(done, total)
    }
    writeJournal(deps.journalPath, { ...move, state: 'switching' })
    const moved = existsSync(staging)
    db.transaction(() => {
      rewritePaths(db, move)
      if (moved) {
        if (existsSync(move.to)) rmdirSync(move.to)
        renameSync(staging, move.to)
      }
      try { if (move.switchSetting) deps.setDataRoot(move.to) } catch (error) {
        if (moved) renameSync(move.to, staging)
        throw error
      }
    })()
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    rmSync(deps.journalPath, { force: true })
    throw error
  }
  rmSync(deps.journalPath, { force: true })
}

/** Finishes or undoes a move interrupted by a crash. Never touches the legacy root. */
export function recoverDataRootMove(db: Database, deps: { journalPath: string; currentDataRoot: string; setDataRoot(root: string): void }): void {
  if (!existsSync(deps.journalPath)) return
  let journal: Journal
  try { journal = JSON.parse(readFileSync(deps.journalPath, 'utf8')) as Journal } catch {
    rmSync(deps.journalPath, { force: true })
    return
  }
  const staging = `${journal.to}.partial`
  if (journal.state === 'switching') {
    const live = db.prepare('SELECT folder_path FROM courses').all() as Array<{ folder_path: string }>
    const committed = journal.folders.some(folder => live.some(row => row.folder_path === folder.to)) ||
      (journal.folders.length === 0 && deps.currentDataRoot === journal.to)
    if (committed) {
      if (journal.switchSetting && deps.currentDataRoot !== journal.to) deps.setDataRoot(journal.to)
    } else {
      // The transaction never committed, so `to` can only be our renamed staging copy.
      if (existsSync(journal.to) && !existsSync(staging) && journal.folders.length > 0) renameSync(journal.to, staging)
      if (deps.currentDataRoot === journal.to) deps.setDataRoot(journal.from)
    }
  }
  rmSync(staging, { recursive: true, force: true })
  rmSync(deps.journalPath, { force: true })
}

/** Claude Code keys `--resume` by the session's cwd; copy (never move) the old project folders. */
export async function copyClaudeProjects(folders: DataRootMove['folders'], claudeDir: string): Promise<number> {
  const encode = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')
  let copied = 0
  for (const folder of folders) {
    const source = join(claudeDir, 'projects', encode(folder.from)), target = join(claudeDir, 'projects', encode(folder.to))
    if (!existsSync(source) || existsSync(target)) continue
    await cp(source, target, { recursive: true, errorOnExist: false, force: false })
    copied += 1
  }
  return copied
}

function rewritePaths(db: Database, move: DataRootMove): void {
  const moved = (path: unknown): path is string => typeof path === 'string' && inside(move.from, path) && path !== move.from
  for (const row of db.prepare("SELECT id, folder_path FROM courses WHERE source = 'managed'").all() as Array<{ id: string; folder_path: string }>) {
    if (moved(row.folder_path)) db.prepare('UPDATE courses SET folder_path = ? WHERE id = ?').run(rebase(move, row.folder_path), row.id)
  }
  for (const table of ['material_tree_snapshots', 'material_added_baselines']) {
    if (!tableExists(db, table)) continue
    for (const row of db.prepare(`SELECT rowid, folder FROM ${table}`).all() as Array<{ rowid: number; folder: string }>) {
      if (moved(row.folder)) db.prepare(`UPDATE ${table} SET folder = ? WHERE rowid = ?`).run(rebase(move, row.folder), row.rowid)
    }
  }
  if (!tableExists(db, 'agent_sessions')) return
  const rewrite = (value: unknown): unknown => moved(value) ? rebase(move, value)
    : Array.isArray(value) ? value.map(rewrite)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]))
    : value
  for (const row of db.prepare('SELECT id, launch_config_json FROM agent_sessions WHERE launch_config_json IS NOT NULL').all() as Array<{ id: string; launch_config_json: string }>) {
    let config: unknown
    try { config = JSON.parse(row.launch_config_json) } catch { continue }
    const next = JSON.stringify(rewrite(config))
    if (next !== JSON.stringify(config)) db.prepare('UPDATE agent_sessions SET launch_config_json = ? WHERE id = ?').run(next, row.id)
  }
}

interface SourceEntry { path: string; size: number; kind: 'file' | 'symlink' | 'dir' }

async function listFiles(root: string): Promise<SourceEntry[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const result: SourceEntry[] = []
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name)
    if (entry.isSymbolicLink()) result.push({ path, size: 0, kind: 'symlink' })
    else if (entry.isDirectory()) result.push({ path, size: 0, kind: 'dir' })
    else if (entry.isFile()) result.push({ path, size: (await stat(path)).size, kind: 'file' })
  }
  // Directories first so empty folders survive and files always have a parent.
  return result.sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1))
}

async function copyVerified(entry: SourceEntry, target: string, timeoutMs: number): Promise<void> {
  if (entry.kind === 'dir') { await mkdir(target, { recursive: true }); return }
  await mkdir(dirname(target), { recursive: true })
  if (entry.kind === 'symlink') { await symlink(await readlink(entry.path), target); return }
  await materialize(entry.path, timeoutMs)
  await copyFile(entry.path, target, constants.COPYFILE_FICLONE)
  if ((await stat(target)).size !== entry.size || await sha256(entry.path) !== await sha256(target)) {
    throw new DataRootMoveError('verify-failed', `복사한 파일이 원본과 달라요: ${entry.path}`)
  }
}

/** An evicted iCloud file reports blocks=0. Reading it makes macOS download it (measured in a signed build). */
async function materialize(path: string, timeoutMs: number): Promise<void> {
  const info = await stat(path)
  if (process.platform !== 'darwin' || info.size === 0 || info.blocks > 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DataRootMoveError('materialize-timeout', `iCloud에서 파일을 내려받지 못했어요: ${path}`)), timeoutMs) })
  const read = (async () => { const handle = await open(path, 'r'); try { await handle.read(Buffer.alloc(1), 0, 1, 0) } finally { await handle.close() } })()
  try { await Promise.race([read, timeout]) } finally { clearTimeout(timer) }
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

function writeJournal(path: string, journal: Journal): void {
  writeFileSync(path, JSON.stringify(journal), { mode: 0o600 })
}
