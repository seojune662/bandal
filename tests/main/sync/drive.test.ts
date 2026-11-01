import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createDriveProvider } from '../../../src/main/features/sync/drive'
import { createFakeDrive, fakeEncryptor, seedToken, type FakeDrive } from './fakeDrive'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { openExternal } }))

let drive: FakeDrive, dirs: string[] = []
beforeEach(() => {
  drive = createFakeDrive()
  vi.stubGlobal('fetch', drive.fetch)
  vi.stubEnv('MAIN_VITE_GMAIL_CLIENT_ID', 'desktop-client.apps.googleusercontent.com')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function device(options: { signedIn?: boolean; dir?: string; activity?: () => { focused: boolean; idleSeconds: number } } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'bandal-drive-'))
  if (!options.dir) dirs.push(dir)
  if (options.signedIn !== false && !options.dir) seedToken(dir)
  return createDriveProvider({ dir, root: null, encryptor: fakeEncryptor, activity: options.activity ?? (() => ({ focused: false, idleSeconds: 0 })) })
}
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString()
const DEVICE = 'a1111111-0000-4000-8000-000000000001', DOC = 'd1111111-0000-4000-8000-000000000001'

test('two devices share one Bandal folder: nested own files go up once and are rewritten in place, and changes reach the other', async () => {
  const a = device(), b = device()
  expect(await b.findRoot(false)).toBeNull()
  const root = (await a.findRoot(true))!
  expect(drive.files.get(root)).toMatchObject({ name: 'Bandal', parents: ['ROOT'], properties: { bandalRoot: '2' }, appProperties: { bandalRoot: '2' } })
  expect(await b.findRoot(true)).toBe(root)
  await a.list()
  await a.write('bandal.json', Buffer.from('{"format":2}'))
  await a.write(`log/${DEVICE}/00000001.json`, Buffer.from('[]'))
  await a.write(`ink/${DOC}/1/${DEVICE}-00000001.json.gz`, Buffer.from('ink one'))
  await a.write(`ink/${DOC}/2/${DEVICE}-00000002.json.gz`, Buffer.from('ink two'))
  // The session log is rewritten, not added again; folders are made once.
  await a.write(`log/${DEVICE}/00000001.json`, Buffer.from('[{"t":1}]'))
  const paths = [...drive.files.values()].filter(file => !file.trashed).map(file => drive.pathOf(file.id)).sort()
  expect(paths).toEqual(['Bandal', 'Bandal/bandal.json', 'Bandal/ink', `Bandal/ink/${DOC}`, `Bandal/ink/${DOC}/1`, `Bandal/ink/${DOC}/1/${DEVICE}-00000001.json.gz`,
    `Bandal/ink/${DOC}/2`, `Bandal/ink/${DOC}/2/${DEVICE}-00000002.json.gz`, 'Bandal/log', `Bandal/log/${DEVICE}`, `Bandal/log/${DEVICE}/00000001.json`])

  const listed = await b.list()
  expect(listed.entries.map(entry => entry.path).sort()).toEqual(['bandal.json', `ink/${DOC}/1/${DEVICE}-00000001.json.gz`, `ink/${DOC}/2/${DEVICE}-00000002.json.gz`, `log/${DEVICE}/00000001.json`])
  expect(text(await listed.read(`log/${DEVICE}/00000001.json`))).toBe('[{"t":1}]')
  const before = listed.entries.find(entry => entry.path.startsWith('log/'))!.version
  await a.write(`log/${DEVICE}/00000001.json`, Buffer.from('[{"t":1},{"t":2}]'))
  const again = await b.list()
  expect(again.entries.find(entry => entry.path.startsWith('log/'))!.version).not.toBe(before)
  expect(text(await again.read(`log/${DEVICE}/00000001.json`))).toBe('[{"t":1},{"t":2}]')
  // A file outside the spec's names is not the root's.
  drive.file('notes.txt', root, Buffer.from('mine'))
  expect((await b.list()).entries.map(entry => entry.path)).not.toContain('notes.txt')
  // Two files at one path (a copy left by a retry): the one changed last counts (design P10).
  const logFolder = [...drive.files.values()].find(file => file.name === DEVICE && drive.files.get(file.parents[0]!)?.name === 'log')!
  drive.file('00000001.json', logFolder.id, Buffer.from('stale copy'))
  await a.write(`log/${DEVICE}/00000001.json`, Buffer.from('[{"t":3}]'))
  const fresh = device()
  await fresh.findRoot(false)
  expect(text(await (await fresh.list()).read(`log/${DEVICE}/00000001.json`))).toBe('[{"t":3}]')
  // The folder went to the trash: nothing is read or written until the person connects again.
  drive.trash(root)
  await expect(b.list()).rejects.toThrow('반달 폴더를 찾지 못했어요')
})

test('a large file moves in pieces and goes on from where a cut-off upload stopped; a restart reads metadata from its cache, not Drive', async () => {
  const a = device()
  await a.findRoot(true)
  await a.list()
  const pdf = Buffer.from(Array.from({ length: 9 * 1024 * 1024 }, (_, index) => index % 251))
  drive.state.cutNextPiece = true
  await expect(a.write(`pdf/${'a'.repeat(64)}.pdf`, pdf)).rejects.toThrow('인터넷 연결')
  await a.write(`pdf/${'a'.repeat(64)}.pdf`, pdf)
  // One session: half the first piece had arrived, so the rest went on from 2 MiB in two pieces.
  expect(drive.state.uploads.resumable).toBe(1)
  expect(drive.state.pieces).toBe(3)
  await a.write('bandal.json', Buffer.from('{"format":2}'))
  expect(drive.state.uploads.multipart).toBe(1)
  // What this device wrote is not read back.
  const own = drive.state.media
  expect(text(await (await a.list()).read('bandal.json'))).toBe('{"format":2}')
  expect(drive.state.media).toBe(own)

  const dir = mkdtempSync(join(tmpdir(), 'bandal-drive-'))
  dirs.push(dir)
  seedToken(dir)
  const b = device({ dir })
  await b.findRoot(false)
  const listed = await b.list()
  expect(Buffer.from(await listed.read(`pdf/${'a'.repeat(64)}.pdf`)).equals(pdf)).toBe(true)
  expect(drive.state.ranges).toBe(3)
  expect(text(await listed.read('bandal.json'))).toBe('{"format":2}')
  const downloads = drive.state.media
  const restarted = device({ dir })
  await restarted.findRoot(false)
  expect(text(await (await restarted.list()).read('bandal.json'))).toBe('{"format":2}')
  expect(drive.state.media).toBe(downloads)
})

test('first connects that race take the same earliest folder, and one holding bandal.json wins over an earlier empty one', async () => {
  const other = drive.folder()
  drive.state.hideRootsOnce = true
  const a = device()
  // Both looked before either made one: this device makes its own, then takes the earlier.
  expect(await a.findRoot(true)).toBe(other.id)
  expect([...drive.files.values()].filter(file => file.name === 'Bandal' && !file.trashed).map(file => file.id)).toEqual([other.id])

  const started = drive.folder()
  drive.file('bandal.json', started.id, Buffer.from('{"format":2}'))
  expect(await device().findRoot(true)).toBe(started.id)
})

test('a root is found by its mark wherever it is and whatever it is called, and only with no mark in sight by the name Bandal and bandal.json (spec v2.5)', async () => {
  // Made before v2.5 by another client: its only mark is private to that client.
  const early = drive.folder('Bandal', 'ROOT', {})
  expect(await device().findRoot(false)).toBeNull()
  drive.file('bandal.json', early.id, Buffer.from('{"format":2}'))
  expect(await device().findRoot(false)).toBe(early.id)
  // This client's own private mark, from before v2.5, moved and renamed.
  const own = drive.folder('반달 백업', 'f-elsewhere', { appProperties: { bandalRoot: '2' } })
  expect(await device().findRoot(false)).toBe(own.id)
  // Another client's public mark; it holds bandal.json, so it goes first.
  const shared = drive.folder('동기화', 'f-elsewhere')
  drive.file('bandal.json', shared.id, Buffer.from('{"format":2}'))
  expect(await device().findRoot(false)).toBe(shared.id)
  // Equal on bandal.json and createdTime: the smaller id as a string, though Drive lists it after.
  const twin = drive.folder('Bandal', 'ROOT')
  drive.files.delete(twin.id)
  drive.files.set('a-twin', { ...twin, id: 'a-twin', createdTime: drive.files.get(shared.id)!.createdTime })
  drive.file('bandal.json', 'a-twin', Buffer.from('{"format":2}'))
  expect(await device().findRoot(false)).toBe('a-twin')
  // A marked folder in the trash is not looked at.
  drive.trash(shared.id)
  drive.trash('a-twin')
  expect(await device().findRoot(false)).toBe(own.id)
})

test('an expired token is refreshed once for parallel calls; a revoked grant asks for a sign-in; signing out keeps the grant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bandal-drive-'))
  dirs.push(dir)
  seedToken(dir, { access: 'stale', expires: 0 })
  const a = device({ dir })
  await Promise.all([a.findRoot(true), a.findRoot(true)])
  expect(drive.state.refreshes).toBe(1)
  expect(await a.status()).toBe('ready')

  seedToken(dir, { access: 'stale', expires: 0 })
  drive.state.revoked = true
  const b = device({ dir })
  await expect(b.list()).rejects.toThrow()
  await expect(b.findRoot(false)).rejects.toThrow('다시 연결해 주세요')
  expect(await b.status()).toBe('needs-auth')

  await b.signOut()
  expect(existsSync(join(dir, 'gdrive-token.enc'))).toBe(false)
  expect(drive.calls.some(call => call.includes('/revoke'))).toBe(false)
  expect(await b.status()).toBe('needs-auth')
})

/** The browser: a garbled request to the loopback port first (anything local can send one), then Google's redirect. */
function browser() {
  openExternal.mockImplementation(async (value: string) => {
    const auth = new URL(value)
    expect(auth.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    const redirect = new URL(auth.searchParams.get('redirect_uri')!)
    const garbled = await new Promise<string>(resolve => {
      const socket = connect(Number(redirect.port), '127.0.0.1', () => socket.end('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'))
      let reply = ''
      socket.on('data', chunk => { reply += chunk.toString() })
      socket.on('close', () => resolve(reply))
    })
    expect(garbled).toMatch(/^HTTP\/1\.1 400/)
    redirect.search = new URLSearchParams({ code: 'code', state: auth.searchParams.get('state')! }).toString()
    vi.unstubAllGlobals()
    try {
      expect((await fetch(redirect)).status).toBe(200)
    } finally {
      vi.stubGlobal('fetch', drive.fetch)
    }
  })
}

test('signing in asks only for drive.file in the browser and keeps the account; an unticked Drive box is refused', async () => {
  browser()
  drive.state.grantScope = 'openid'
  const a = device({ signedIn: false })
  expect(await a.status()).toBe('needs-auth')
  await expect(a.signIn()).rejects.toThrow('Google Drive 접근을 허용해 주세요')
  expect(await a.status()).toBe('needs-auth')
  drive.state.grantScope = 'https://www.googleapis.com/auth/drive.file'
  await a.signIn()
  expect(a.account()).toBe('me@example.com')
  expect(await a.status()).toBe('ready')
})

test('a refresh of the old sign-in that comes back refused does not undo a newer sign-in', async () => {
  browser()
  const dir = mkdtempSync(join(tmpdir(), 'bandal-drive-'))
  dirs.push(dir)
  seedToken(dir, { access: 'stale', expires: 0 })
  let release!: () => void
  drive.state.refreshGate = new Promise(resolve => { release = resolve })
  drive.state.revoked = true
  const a = device({ dir })
  const waiting = a.findRoot(false).catch((error: Error) => error)
  await vi.waitFor(() => expect(drive.state.refreshes).toBe(1))
  await a.signIn()
  release()
  expect(await waiting).toBeInstanceOf(Error)
  expect(await a.status()).toBe('ready')
  expect(await a.findRoot(true)).toEqual(expect.any(String))
})

test('Drive is asked every 30 s while a window is in use, every 5 minutes otherwise, and at once on coming back', async () => {
  vi.useFakeTimers()
  let activity = { focused: false, idleSeconds: 600 }
  const a = device({ activity: () => activity })
  await a.findRoot(true)
  await a.list()
  const polls = () => drive.calls.filter(call => call.endsWith('/drive/v3/changes')).length
  const changed = vi.fn()
  const stop = a.watch(changed)
  const start = polls()
  await vi.advanceTimersByTimeAsync(4 * 60_000)
  expect(polls()).toBe(start)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(polls()).toBe(start + 1)
  activity = { focused: true, idleSeconds: 0 }
  await vi.advanceTimersByTimeAsync(5_000)
  expect(polls()).toBe(start + 2)
  drive.file('bandal.json', [...drive.files.values()].find(file => file.name === 'Bandal')!.id, Buffer.from('{"format":2}'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(polls()).toBe(start + 3)
  expect(changed).toHaveBeenCalledTimes(1)
  stop()
})
