import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, realpath, lstat, writeFile } from 'node:fs/promises'
import { join, dirname, basename, relative, isAbsolute, sep } from 'node:path'
import type { Database } from 'better-sqlite3'
import { writeFileAtomic } from '../../lib/atomicWrite'

const POINTER = 'active-profile.json'
export function resolveActiveProfile(base: string): string {
  const pointer = join(base, POINTER)
  if (!existsSync(pointer)) return base
  const data = JSON.parse(readFileSync(pointer, 'utf8')) as { id: string }
  if (!/^[0-9a-f-]{36}$/.test(data.id)) throw new Error('프로필 경로 기록이 올바르지 않습니다.')
  const result = join(base, 'profiles', data.id)
  if (!existsSync(join(result, 'isolated-profile.json'))) throw new Error('새 프로필 저장 공간을 찾을 수 없습니다. 원본 프로필은 보존되어 있습니다.')
  return result
}

// Credential/session/cache directories are deliberately not portable exports.
// DIPS is Chromium's bounce-tracking database, not Bandal content. Its live
// SQLite journal may disappear even while app edits and sync are paused. Omit
// the database and its exact sidecars together, at the profile root only;
// never suppress missing user files or skip journal suffixes in course folders.
const excluded = new Set(['auth', 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Session Storage', 'Local Storage', 'IndexedDB', 'Service Worker', 'Partitions', 'Network', 'DIPS', 'DIPS-journal', 'DIPS-wal', 'DIPS-shm', 'workspace-previews', 'logs', 'Crashpad', 'profiles', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', POINTER])
interface Entry { source: string; target: string; sha256: string; size: number }
async function digest(file: string): Promise<string> { return createHash('sha256').update(await readFile(file)).digest('hex') }
export function createProfileManager(deps: { db: Database; baseRoot: string; root: string; chooseDestination(): Promise<string | null>; pause(): void | Promise<void>; resume(): void; relaunch(): void }) {
  let working = false
  let pendingSwitch: (() => void) | null = null
  const backup = async (keepPaused = false): Promise<{ ok: boolean; cancelled: boolean; path?: string }> => {
    if (working) throw new Error('백업이 진행 중입니다.')
    working = true
    let paused = false
    let retained = false
    try {
      const selected = await deps.chooseDestination()
      if (!selected) return { ok: false, cancelled: true }
      // Resolve ancestor links before checking containment, otherwise a backup
      // through an external symlink could recursively copy into its own source.
      const destination = join(await realpath(dirname(selected)), basename(selected))
      const roots = [deps.root, ...(deps.db.prepare('SELECT folder_path FROM courses').all() as Array<{folder_path:string}>).map(row => row.folder_path)]
      for (const root of roots) {
        const path = relative(await realpath(root), destination)
        if (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) throw new Error('자료 폴더 밖에 백업을 저장해 주세요.')
      }
      paused = true
      await deps.pause()
      await mkdir(destination, { recursive: false })
      const entries: Entry[] = []
      const dbVersion = deps.db.pragma('data_version', { simple: true })
      const localVersion = (deps.db.prepare('SELECT total_changes() AS value').get() as {value:number}).value
      await deps.db.backup(join(destination, 'bandal.db'))
      const copy = async (source: string, target: string, profile = false): Promise<void> => {
        await mkdir(target, { recursive: true })
        for (const item of await readdir(source, { withFileTypes: true })) {
          if (profile && (excluded.has(item.name) || item.name.startsWith('bandal.db') || item.name === 'material-path-lock.db')) continue
          const from = join(source, item.name), to = join(target, item.name)
          const before = await lstat(from)
          if (before.isSymbolicLink()) throw new Error('연결 파일이 포함된 폴더는 백업을 확인해야 합니다. 원본은 변경하지 않았습니다.')
          if (before.isDirectory()) { await copy(from, to); continue }
          if (!before.isFile()) continue
          const hash = await digest(from)
          await cp(from, to, { force: false, errorOnExist: true })
          if (await digest(to) !== hash || await digest(from) !== hash) throw new Error('백업 중 자료가 변경되었습니다. 다시 시도해 주세요.')
          entries.push({ source: from, target: relative(destination, to), sha256: hash, size: before.size })
        }
      }
      await copy(deps.root, join(destination, 'profile'), true)
      const courses = deps.db.prepare('SELECT id, folder_path FROM courses').all() as Array<{id:string;folder_path:string}>
      for (const course of courses) await copy(course.folder_path, join(destination, 'courses', course.id))
      // Recheck earlier files too: a long backup must represent one stable snapshot.
      for (const entry of entries) if (await digest(entry.source) !== entry.sha256) throw new Error('백업 중 원본이 변경되었습니다. 다시 시도해 주세요.')
      if (deps.db.pragma('data_version', { simple: true }) !== dbVersion || (deps.db.prepare('SELECT total_changes() AS value').get() as {value:number}).value !== localVersion) throw new Error('백업 중 자료 기록이 변경되었습니다. 다시 시도해 주세요.')
      await writeFile(join(destination, 'manifest.json'), JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), databaseSha256: await digest(join(destination, 'bandal.db')), courses, entries, excluded: [...excluded] }, null, 2), { mode: 0o600 })
      retained = keepPaused
      return { ok: true, cancelled: false, path: destination }
    } finally { if (!retained) { working = false; if (paused) deps.resume() } }
  }
  return { backup: () => backup(), busy: () => working, cancelSwitch: () => pendingSwitch?.(), async newProfile() {
    const result = await backup(true)
    if (!result.ok) return result
    const pointer = join(deps.baseRoot, POINTER)
    let previous: string | null = null
    let switched = false
    try {
      previous = existsSync(pointer) ? readFileSync(pointer, 'utf8') : null
      const id = randomUUID(), root = join(deps.baseRoot, 'profiles', id)
      mkdirSync(root, { recursive: true })
      writeFileAtomic(join(root, 'isolated-profile.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), previousBackup: result.path }))
      // Fresh settings prevent implicit attachment of the previous external data root.
      writeFileAtomic(join(root, 'settings.json'), JSON.stringify({ dataRoot: join(root, 'Courses') }))
      writeFileAtomic(pointer, JSON.stringify({ id })); switched = true
      pendingSwitch = () => {
        if (previous === null) unlinkSync(pointer)
        else writeFileAtomic(pointer, previous)
        pendingSwitch = null; working = false; deps.resume()
      }
      deps.relaunch()
      return result
    } catch (error) {
      // Keep the verified snapshot and source, and restore the selected profile
      // before permitting edits if starting the replacement process failed.
      if (switched) {
        pendingSwitch!()
      } else {
        working = false; deps.resume()
      }
      throw error
    }
  } }
}
