import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, session, type Session } from 'electron'
import Database from 'better-sqlite3'
import { writeFileAtomic, quarantineFile } from '../../lib/atomicWrite'
import { runtimeSafeStorage } from '../../lib/safeStorageGate'
import { createCredentialStore } from '../credentials/credentialStore'
import { createHistoryRepo } from './historyRepo'
import { createPermissionsRepo } from './permissionsRepo'
import { createBrowserSessionStore } from './sessionStore'
import { BROWSING_PARTITION, PRIVATE_BROWSING_PARTITION } from './webviewPolicy'
import { PROFILE_COLORS, type BrowserProfile } from '../../../shared/types/browserProfile'

let profiles: BrowserProfile[] | undefined
let defaultDb: Database.Database
const databases = new Map<string, Database.Database>()
const resources = new Map<string, ReturnType<typeof buildResources>>()
const listeners = new Set<(partition: string, profileId: string) => void>()
const activeDownloads = new Map<string, number>()
const initialized = new Map<string, string>()
const guestProfiles = new Map<number, { profileId: string; isPrivate: boolean }>()
const file = (): string => join(app.getPath('userData'), 'browser-profiles.json')
export const profileDirectory = (id: string): string => join(app.getPath('userData'), 'browser-profiles', requireProfile(id).id)
export function listBrowserProfiles(): BrowserProfile[] {
  if (!profiles) {
    profiles = [{ id: 'default', name: '기본', color: PROFILE_COLORS[0], icon: '●' }]
    if (existsSync(file())) {
      try {
      const raw: unknown = JSON.parse(readFileSync(file(), 'utf8'))
      if (!Array.isArray(raw)) throw new Error('브라우저 프로필 파일을 읽을 수 없습니다.')
      profiles = raw.filter((p): p is BrowserProfile => p && typeof p === 'object' &&
        (p.id === 'default' || /^[a-f0-9-]{36}$/.test(p.id)) && typeof p.name === 'string' &&
        PROFILE_COLORS.includes(p.color) && typeof p.icon === 'string')
      } catch (error) {
        quarantineFile(file())
        console.warn('[browser] Restoring profile metadata from retained folders', error)
        profiles = [{ id: 'default', name: '기본', color: PROFILE_COLORS[0], icon: '●' }]
        const root = join(app.getPath('userData'), 'browser-profiles')
        if (existsSync(root)) for (const id of readdirSync(root).filter(id => /^[a-f0-9-]{36}$/.test(id))) {
          profiles.push({ id, name: `복구된 프로필 ${profiles.length}`, color: PROFILE_COLORS[0], icon: '●' })
        }
        writeFileAtomic(file(), JSON.stringify(profiles))
      }
      if (!profiles.some(p => p.id === 'default')) profiles.unshift({ id: 'default', name: '기본', color: PROFILE_COLORS[0], icon: '●' })
    }
  }
  return profiles.map(p => ({ ...p }))
}
export function requireProfile(id = 'default'): BrowserProfile {
  const p = listBrowserProfiles().find(p => p.id === id)
  if (!p) throw new Error('삭제되었거나 존재하지 않는 브라우저 프로필입니다.')
  return p
}
export function saveBrowserProfile(input: { id?: string; name: string; color: string; icon: string }): BrowserProfile {
  if (typeof input.name !== 'string' || typeof input.icon !== 'string') throw new Error('프로필 입력이 올바르지 않습니다.')
  const name = input.name.trim().slice(0, 40)
  if (!name || !PROFILE_COLORS.includes(input.color as typeof PROFILE_COLORS[number])) throw new Error('프로필 이름과 색상을 확인해 주세요.')
  const all = listBrowserProfiles()
  if (!input.id && all.length >= 100) throw new Error('프로필은 최대 100개까지 만들 수 있습니다.')
  const p = { id: input.id ? requireProfile(input.id).id : randomUUID(), name, color: input.color, icon: [...String(input.icon)].slice(0, 2).join('') || '●' }
  const next = all.filter(item => item.id !== p.id).concat(p)
  writeFileAtomic(file(), JSON.stringify(next))
  profiles = next
  return p
}
export function profilePartition(id = 'default', isPrivate = false): string {
  requireProfile(id)
  if (id === 'default') return isPrivate ? PRIVATE_BROWSING_PARTITION : BROWSING_PARTITION
  return `${isPrivate ? '' : 'persist:'}bandal-profile-${id}${isPrivate ? '-private' : ''}`
}
export function initializeBrowserProfiles(db: Database.Database): void { defaultDb = db }
export function onBrowserSession(callback: (partition: string, id: string) => void): void {
  for (const [partition, id] of initialized) callback(partition, id)
  listeners.add(callback)
}
export function ensureProfileSession(id = 'default', isPrivate = false): Session {
  const partition = profilePartition(id, isPrivate)
  if (!initialized.has(partition)) {
    initialized.set(partition, id)
    session.fromPartition(partition).on('will-download', (_event, item) => {
      activeDownloads.set(id, (activeDownloads.get(id) ?? 0) + 1)
      item.once('done', () => activeDownloads.set(id, Math.max(0, (activeDownloads.get(id) ?? 1) - 1)))
    })
    try { for (const callback of listeners) callback(partition, id) }
    catch (error) { initialized.delete(partition); throw error }
  }
  return session.fromPartition(partition)
}
function buildResources(id: string) {
  const directory = id === 'default' ? app.getPath('userData') : profileDirectory(id)
  mkdirSync(directory, { recursive: true })
  let db = defaultDb
  if (id !== 'default') {
    db = new Database(join(directory, 'browser.sqlite'))
    db.pragma('journal_mode = WAL')
    for (const table of ['browser_history', 'browser_permissions']) {
      const schema = defaultDb.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', table) as { sql: string }
      db.exec(schema.sql.replace(/CREATE TABLE(?: IF NOT EXISTS)?/, 'CREATE TABLE IF NOT EXISTS'))
    }
    db.exec('CREATE INDEX IF NOT EXISTS history_visited ON browser_history(last_visited_at DESC)')
    databases.set(id, db)
  }
  const ses = session.fromPartition(profilePartition(id))
  const cookies = id === 'default' ? createBrowserSessionStore() : createBrowserSessionStore({ session: ses, app })
  cookies.startFlushOnQuit()
  const history = createHistoryRepo(db)
  history.prune()
  return { history, permissions: createPermissionsRepo(db), cookies,
    credentials: id === 'default' ? createCredentialStore() : createCredentialStore({ safeStorage: runtimeSafeStorage(), userDataPath: directory }) }
}
export function browserProfileResources(id = 'default'): ReturnType<typeof buildResources> {
  requireProfile(id)
  if (!resources.has(id)) resources.set(id, buildResources(id))
  return resources.get(id)!
}
export function registerGuestProfile(id: number, profileId: string, isPrivate: boolean): void { guestProfiles.set(id, { profileId, isPrivate }) }
export function forgetGuestProfile(id: number): void { guestProfiles.delete(id) }
export function guestProfile(id: number): { profileId: string; isPrivate: boolean } {
  const value = guestProfiles.get(id)
  if (!value) throw new Error('브라우저 탭을 찾을 수 없습니다.')
  return value
}
export async function deleteBrowserProfile(id: string): Promise<void> {
  requireProfile(id)
  if (id === 'default') throw new Error('기본 프로필은 삭제할 수 없습니다.')
  if ((activeDownloads.get(id) ?? 0) > 0) throw new Error('다운로드가 끝난 뒤 프로필을 삭제해 주세요.')
  if ([...guestProfiles.values()].some(p => p.profileId === id)) throw new Error('이 프로필의 탭을 먼저 닫아 주세요. 진행 중인 다운로드도 완료한 뒤 삭제해 주세요.')
  for (const privateMode of [false, true]) {
    const ses = session.fromPartition(profilePartition(id, privateMode))
    for (const extension of ses.extensions.getAllExtensions()) ses.extensions.removeExtension(extension.id)
    await ses.clearStorageData()
    await ses.clearCache()
    await ses.clearAuthCache()
    await ses.closeAllConnections()
  }
  const data = browserProfileResources(id)
  data.cookies.dispose()
  data.history.clear(null)
  data.permissions.forgetAll()
  for (const login of data.credentials.list()) data.credentials.forget(login.origin)
  databases.get(id)?.close()
  databases.delete(id)
  resources.delete(id)
  rmSync(profileDirectory(id), { recursive: true, force: true })
  const next = listBrowserProfiles().filter(p => p.id !== id)
  writeFileAtomic(file(), JSON.stringify(next))
  profiles = next
}
