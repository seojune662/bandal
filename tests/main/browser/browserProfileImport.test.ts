import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { createBrowserImportService, type BrowserImportService, type BrowserImportSinks } from '../../../src/main/features/browser/import'
import { capabilities, discoverImportSources, fileImportSource, type PrivateImportSource } from '../../../src/main/features/browser/import/discovery'
import { boundHistory, readImportFile, readProfile } from '../../../src/main/features/browser/import/readers'
import { readSnapshot } from '../../../src/main/features/browser/import/sqlite'
import { createChromiumDecryptor } from '../../../src/main/features/browser/import/crypto'
import type { BrowserImportJob } from '../../../src/shared/types/browserImport'
import type { ImportedCookie } from '../../../src/main/features/browser/import/types'

vi.mock('better-sqlite3', async () => ({ default: createRequire(import.meta.url)('better-sqlite3-node') }))
const Sqlite = createRequire(import.meta.url)('better-sqlite3-node') as typeof import('better-sqlite3')
const temporary: string[] = []
const services: BrowserImportService[] = []
afterEach(() => { for (const service of services.splice(0)) service.dispose(); for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temp = (): string => { const dir = mkdtempSync(join(tmpdir(), 'bandal-import-synthetic-')); temporary.push(dir); return dir }
const now = Date.UTC(2026, 9, 1)
const chromiumDate = (ms: number): number => (ms + 11_644_473_600_000) * 1000
const signal = (): AbortSignal => new AbortController().signal
const source = (path: string, browser: 'chrome' | 'edge' | 'firefox' = 'chrome'): PrivateImportSource => ({ path, root: path, public: { id: 'source', browser, name: browser, profileName: 'Synthetic', kind: 'profile', capabilities: capabilities(browser, 'profile', 'darwin') } })
const keyPassword = 'synthetic safe storage'
function encryptMac(value: string, host?: string): Buffer {
  const key = pbkdf2Sync(keyPassword, 'saltysalt', 1003, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  const plain = host ? Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)]) : Buffer.from(value)
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
}
const options = () => ({ platform: 'darwin' as const, now, signal: signal(), helper: vi.fn(async () => Buffer.from(keyPassword)) })
function sinks(): BrowserImportSinks {
  const cookies: ImportedCookie[] = []
  return {
    passwords: vi.fn((_profile, entries) => ({ imported: entries.length, kept: 0, unsupported: 0, failed: 0 })),
    history: vi.fn((_profile, entries) => ({ imported: entries.length, kept: 0, unsupported: 0, failed: 0 })),
    bookmark: vi.fn(() => 'imported' as const),
    cookies: () => ({ get: async () => cookies.map((cookie) => ({ ...cookie, domain: cookie.domain ?? new URL(cookie.url).hostname, hostOnly: cookie.domain === undefined })), set: async (cookie) => { cookies.push({ ...cookie }) } })
  }
}
async function finish(service: BrowserImportService, id: string): Promise<BrowserImportJob> {
  await vi.waitFor(() => expect(service.get(id)?.state).not.toBe('running'))
  return service.get(id)!
}

describe('browser source discovery', () => {
  test('discovers only explicitly provided synthetic home and exposes no paths', async () => {
    const home = temp()
    const chrome = join(home, 'Library/Application Support/Google/Chrome')
    const edge = join(home, 'Library/Application Support/Microsoft Edge')
    mkdirSync(join(chrome, 'Default'), { recursive: true }); mkdirSync(join(edge, 'Profile 1'), { recursive: true })
    writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'School' } } } }))
    const firefox = join(home, 'Library/Application Support/Firefox')
    mkdirSync(join(firefox, 'Profiles/synthetic'), { recursive: true })
    writeFileSync(join(firefox, 'profiles.ini'), '[Profile0]\nName=Personal\nIsRelative=1\nPath=Profiles/synthetic\n')
    const found = await discoverImportSources({ platform: 'darwin', homeDir: home })
    expect(found.map((entry) => [entry.public.browser, entry.public.profileName])).toEqual([['chrome', 'School'], ['edge', 'Profile 1'], ['firefox', 'Personal']])
    expect(JSON.stringify(found.map((entry) => entry.public))).not.toContain(home)
    expect(found[2]!.public.capabilities.passwords.supported).toBe(false)
  })
  test('Windows Chromium capabilities explain app-bound exclusions', () => {
    expect(capabilities('chrome', 'profile', 'win32').cookies.description).toContain('앱 바운드')
    expect(capabilities('safari', 'safari-zip', 'darwin').cookies.supported).toBe(false)
  })
})

describe('read-only snapshots and browser readers', () => {
  test('SQLite reader sees committed WAL and one consistent snapshot without writing source', () => {
    const path = join(temp(), 'History')
    const writer = new Sqlite(path)
    writer.pragma('journal_mode=WAL'); writer.exec('CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'one\')')
    const original = readFileSync(path)
    const values = readSnapshot(path, (reader) => {
      const first = reader.prepare('SELECT value FROM sample').pluck().get()
      writer.prepare('UPDATE sample SET value = ?').run('two')
      const second = reader.prepare('SELECT value FROM sample').pluck().get()
      expect(() => reader.prepare('DELETE FROM sample').run()).toThrow()
      return [first, second]
    })
    expect(values).toEqual(['one', 'one'])
    expect(readFileSync(path)).toEqual(original)
    writer.close()
  })
  test('locked SQLite snapshot reports a recoverable reason', () => {
    const path = join(temp(), 'locked')
    const writer = new Sqlite(path)
    writer.exec('CREATE TABLE sample (value TEXT); BEGIN EXCLUSIVE')
    expect(() => readSnapshot(path, (db) => db.prepare('SELECT * FROM sample').all())).toThrow('locked')
    writer.exec('ROLLBACK'); writer.close()
  })
  test('Chrome cookies preserve session/domain/security semantics and exclude partitioned data', async () => {
    const dir = temp()
    const db = new Sqlite(join(dir, 'Cookies'))
    db.exec(`CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version','24');
      CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER, has_expires INTEGER, samesite INTEGER, top_frame_site_key TEXT, has_cross_site_ancestor INTEGER)`)
    const insert = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    insert.run('school.example', 'session', '', encryptMac('synthetic session', 'school.example'), '/', 1, 1, 0, 0, 1, '', 0)
    insert.run('.school.example', 'remember', '', encryptMac('synthetic remember', '.school.example'), '/login', 1, 0, chromiumDate(now + 86_400_000), 1, 2, '', 0)
    insert.run('school.example', 'partition', 'excluded', Buffer.alloc(0), '/', 1, 1, 0, 0, 1, 'https://parent.example', 0)
    insert.run('school.example', 'bound', '', Buffer.from('v20encrypted'), '/', 1, 1, 0, 0, 1, '', 0)
    db.close()
    const setup = options()
    const payload = await readProfile(source(dir), ['cookies'], setup)
    expect(payload.cookies).toEqual([
      { url: 'https://school.example/', name: 'session', value: 'synthetic session', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      { url: 'https://school.example/login', name: 'remember', value: 'synthetic remember', domain: '.school.example', path: '/login', secure: true, httpOnly: false, sameSite: 'strict', expirationDate: (now + 86_400_000) / 1000 }
    ])
    expect(payload.unsupported.cookies).toBe(2)
    expect(setup.helper).toHaveBeenCalledTimes(1)
  })
  test('Chrome multiple logins are decrypted independently; permission errors are sanitized', async () => {
    const dir = temp(); const db = new Sqlite(join(dir, 'Login Data'))
    db.exec('CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER)')
    const insert = db.prepare('INSERT INTO logins VALUES (?,?,?,0)')
    insert.run('https://school.example/login', 'one', encryptMac('secret one'))
    insert.run('https://school.example/login', 'two', encryptMac('secret two'))
    db.close()
    expect((await readProfile(source(dir), ['passwords'], options())).passwords.map((entry) => entry.username)).toEqual(['one', 'two'])
    const denied = await readProfile(source(dir), ['passwords'], { ...options(), helper: async () => { throw new Error('PRIVATE SECRET /USER/PATH') } })
    expect(denied.failed.passwords).toBe(1)
    expect(JSON.stringify(denied.messages)).not.toContain('PRIVATE')
  })
  test('Firefox normal cookies/history/bookmarks exclude containers and retain recent records', async () => {
    const dir = temp(); const places = new Sqlite(join(dir, 'places.sqlite'))
    places.exec('CREATE TABLE moz_places (id INTEGER, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER); CREATE TABLE moz_bookmarks (id INTEGER, fk INTEGER, title TEXT, type INTEGER)')
    places.prepare('INSERT INTO moz_places VALUES (1,?,?,?,?)').run('https://recent.example', 'Recent', 7, now * 1000)
    places.prepare('INSERT INTO moz_places VALUES (2,?,?,?,?)').run('https://old.example', 'Old', 99, (now - 100 * 86_400_000) * 1000)
    places.exec("INSERT INTO moz_bookmarks VALUES (1,1,'Bookmark',1)"); places.close()
    const cookieDb = new Sqlite(join(dir, 'cookies.sqlite'))
    cookieDb.exec('CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)')
    const insert = cookieDb.prepare('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?)')
    insert.run('recent.example', 'normal', 'value', '/', now / 1000 + 3600, 1, 1, 1, '')
    insert.run('recent.example', 'container', 'value', '/', now / 1000 + 3600, 1, 1, 1, '^userContextId=1')
    cookieDb.close()
    const payload = await readProfile(source(dir, 'firefox'), ['bookmarks', 'history', 'cookies'], options())
    expect(payload.bookmarks).toEqual([{ url: 'https://recent.example', title: 'Bookmark' }])
    expect(payload.history).toEqual([{ url: 'https://recent.example', title: 'Recent', visitCount: 7, lastVisitedAt: new Date(now).toISOString() }])
    expect(payload.cookies).toHaveLength(1)
    expect(payload.unsupported.cookies).toBe(1)
  })
  test('history deduplicates by maximum visits, enforces 90 days and a 20k ceiling', () => {
    const rows = Array.from({ length: 20_002 }, (_, index) => ({ url: `https://example.test/${index}`, title: '', visitCount: 3, lastVisitedAt: new Date(now).toISOString() }))
    rows.push({ ...rows[0]!, visitCount: 9 })
    rows.push({ url: 'https://old.test', title: '', visitCount: 1, lastVisitedAt: new Date(now - 100 * 86_400_000).toISOString() })
    const result = boundHistory(rows, now)
    expect(result).toHaveLength(20_000)
    expect(result[0]!.visitCount).toBe(9)
    expect(result.some((entry) => entry.url === 'https://old.test')).toBe(false)
  })
})

describe('Windows encryption', () => {
  test('an unreadable legacy DPAPI record does not abort later supported values', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIsynthetic-key').toString('base64') } }))
    const key = Buffer.alloc(32, 3)
    const iv = Buffer.alloc(12, 4)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([Buffer.from('v10'), iv, cipher.update('readable value'), cipher.final(), cipher.getAuthTag()])
    const helper = vi.fn(async (request: { operation: string; data?: string }) => {
      if (request.data !== Buffer.from('synthetic-key').toString('base64')) throw new Error('DPAPI rejected this record')
      return Buffer.from(key)
    })
    const controller = new AbortController()
    const decryptor = createChromiumDecryptor({ platform: 'win32', browser: 'chrome', root: dir, helper, signal: controller.signal })
    expect(await decryptor.decrypt(Buffer.from('unreadable legacy value'))).toBeNull()
    expect((await decryptor.decrypt(encrypted))?.toString()).toBe('readable value')
    controller.abort()
    await expect(decryptor.decrypt(Buffer.from('another legacy value'))).rejects.toThrow('cancelled')
    decryptor.dispose()
  })
  test('ordinary DPAPI-wrapped AES key works; app-bound values never call helper', async () => {
    const dir = temp(); writeFileSync(join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIsynthetic').toString('base64') } }))
    const key = Buffer.alloc(32, 7); const iv = Buffer.alloc(12, 8)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([Buffer.from('v10'), iv, cipher.update('windows synthetic'), cipher.final(), cipher.getAuthTag()])
    const helper = vi.fn(async () => Buffer.from(key))
    const decryptor = createChromiumDecryptor({ platform: 'win32', browser: 'chrome', root: dir, helper, signal: signal() })
    expect(await decryptor.decrypt(Buffer.from('v20unsupported'))).toBeNull()
    expect(helper).not.toHaveBeenCalled()
    expect((await decryptor.decrypt(encrypted))?.toString()).toBe('windows synthetic')
    expect(helper).toHaveBeenCalledOnce()
    decryptor.dispose()
  })
})

describe('official exports and jobs', () => {
  test('Safari archive identifies localized filenames, ignores cards, and bounds history', async () => {
    const dir = temp(); const archive = new JSZip()
    archive.file('책갈피.html', '<A HREF="https://bookmark.example">Book &amp; mark</A>')
    archive.file('암호.csv', 'Title,URL,Username,Password,Notes,OTPAuth\nSchool,https://school.example,user,secret,,\n')
    archive.file('방문 기록 - 학교.json', JSON.stringify({ metadata: { data_type: 'history', schema_version: 1 }, history: [{ url: 'https://history.example', title: 'History', time_usec: now * 1000, visits_count: 5 }] }))
    archive.file('결제 카드.json', JSON.stringify({ metadata: { data_type: 'payment_cards', schema_version: 1 }, payment_cards: [{ card_number: 'DO NOT IMPORT' }] }))
    const path = join(dir, 'safari.zip'); writeFileSync(path, await archive.generateAsync({ type: 'nodebuffer' }))
    const payload = await readImportFile(fileImportSource(path, 'safari-zip', 'darwin'), ['bookmarks', 'passwords', 'history', 'cookies'], signal(), now)
    expect(payload.bookmarks).toEqual([{ title: 'Book & mark', url: 'https://bookmark.example/' }])
    expect(payload.passwords).toHaveLength(1)
    expect(payload.history[0]!.visitCount).toBe(5)
    expect(payload.unsupported.cookies).toBe(1)
    expect(JSON.stringify(payload)).not.toContain('DO NOT IMPORT')
  })
  test('jobs use batch sinks and return counts without secret values or source paths', async () => {
    const dir = temp(); const path = join(dir, 'passwords.csv')
    writeFileSync(path, 'url,username,password\nhttps://school.example,one,PRIVATE_SECRET\nhttps://school.example,two,OTHER_SECRET\n')
    const sink = sinks()
    const service = createBrowserImportService({ helperPath: '', sinks: sink, homeDir: dir, now: () => now }); services.push(service)
    const registered = await service.registerFile(path, 'passwords-csv')
    const events: BrowserImportJob[] = []; service.subscribe((job) => events.push(job))
    const started = service.start({ sourceId: registered.id, targetProfileId: 'default', items: ['passwords'], conflict: 'keep' })
    expect(service.isProfileBusy('default')).toBe(true)
    expect(() => service.start({ sourceId: registered.id, targetProfileId: 'default', items: ['passwords'], conflict: 'keep' })).toThrow()
    const result = await finish(service, started.id)
    expect(result.state).toBe('completed'); expect(result.results.passwords.imported).toBe(2)
    expect(sink.passwords).toHaveBeenCalledOnce()
    expect(service.isProfileBusy('default')).toBe(false)
    const metadata = JSON.stringify([registered, result, events])
    expect(metadata).not.toContain(dir); expect(metadata).not.toContain('PRIVATE_SECRET'); expect(metadata).not.toContain('OTHER_SECRET')
  })
  test('cancel prevents further writes, retains completed items and permits retry', async () => {
    const dir = temp(); const path = join(dir, 'bookmarks.html')
    writeFileSync(path, Array.from({ length: 100 }, (_, index) => `<A HREF="https://example.test/${index}">${index}</A>`).join('\n'))
    const sink = sinks()
    const service = createBrowserImportService({ helperPath: '', sinks: sink, homeDir: dir }); services.push(service)
    const registered = await service.registerFile(path, 'bookmarks-html')
    let calls = 0; let id = ''
    sink.bookmark = () => { calls += 1; if (calls === 4) service.cancel(id); return 'imported' }
    id = service.start({ sourceId: registered.id, targetProfileId: 'default', items: ['bookmarks'], conflict: 'keep' }).id
    const result = await finish(service, id)
    expect(result.state).toBe('cancelled'); expect(result.results.bookmarks.imported).toBe(4); expect(calls).toBe(4)
    expect(service.isProfileBusy('default')).toBe(false)
    expect(service.start({ sourceId: registered.id, targetProfileId: 'default', items: ['bookmarks'], conflict: 'keep' }).state).toBe('running')
  })
  test('unknown sources and invalid jobs cannot choose arbitrary paths', () => {
    const service = createBrowserImportService({ helperPath: '', sinks: sinks(), homeDir: temp() }); services.push(service)
    expect(() => service.start({ sourceId: '/private/profile', targetProfileId: 'default', items: ['cookies'], conflict: 'keep' })).toThrow('원본')
  })
})
