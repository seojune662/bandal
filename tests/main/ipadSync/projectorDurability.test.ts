import { afterEach, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createContext, runInContext } from 'node:vm'

const SQLite = createRequire(import.meta.url)('better-sqlite3-node')
const source = fs.readFileSync(new URL('../../../resources/ipad-bridge/backend.js', import.meta.url), 'utf8')
const anchor = '  globalThis.BandalBackend = {'
if (source.split(anchor).length !== 2) throw new Error('Projector test seam changed')
// Exercise the exact shipped functions without initializing an application DB.
const executable = source.replace(anchor, '  globalThis.durability = { createFileJournal, preserveConflictAssets };\n' + anchor)
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'bandal-projector-durable-'))
  const db = new SQLite(':memory:')
  db.exec('CREATE TABLE ipad_sync_commits(id TEXT PRIMARY KEY); CREATE TABLE ipad_sync_projection(id TEXT PRIMARY KEY,source_json TEXT); CREATE TABLE changes(id TEXT)')
  const descriptors = new Map<number, { path: string; flags: string }>()
  const flushed: string[] = []
  let failFlush = (_path: string) => false
  const perform = (op: string, a: any): any => {
    switch (op) {
      case 'environment': return { userDataPath: root, platform: 'win32' }
      case 'fs.exists': return fs.existsSync(a.path)
      case 'fs.mkdir': return fs.mkdirSync(a.path, { recursive: a.recursive })
      case 'fs.readdir': return fs.readdirSync(a.path, { withFileTypes: true }).map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
      case 'fs.copy': return fs.copyFileSync(a.from, a.to, a.overwrite ? 0 : fs.constants.COPYFILE_EXCL)
      case 'fs.chmod': return fs.chmodSync(a.path, a.mode)
      case 'fs.stat': { const stat = fs.statSync(a.path); return { mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs, isFile: stat.isFile(), isDirectory: stat.isDirectory() } }
      case 'fs.open': { const fd = fs.openSync(a.path, a.flags, a.mode); descriptors.set(fd, { path: a.path, flags: a.flags }); return fd }
      case 'fs.close': descriptors.delete(a.fd); return fs.closeSync(a.fd)
      case 'fs.fsync': {
        const handle = descriptors.get(a.fd)!
        // FlushFileBuffers requires GENERIC_WRITE even for a newly copied file.
        if (!/[wa+]/.test(handle.flags)) throw Object.assign(new Error('EPERM: read-only flush handle'), { code: 'EPERM' })
        if (failFlush(handle.path)) throw Object.assign(new Error('injected disk flush failure'), { code: 'EIO' })
        fs.fsyncSync(a.fd); flushed.push(handle.path); return null
      }
      case 'fs.write': return fs.writeSync(a.fd, Buffer.from(a.data, 'base64'), 0, Buffer.from(a.data, 'base64').length, a.position)
      case 'fs.readFile': return fs.readFileSync(a.path).toString(a.encoding)
      case 'fs.rename': return fs.renameSync(a.from, a.to)
      case 'fs.remove': return fs.rmSync(a.path, { recursive: a.recursive, force: a.force })
      case 'fs.sha256': return createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')
      case 'crypto.randomUUID': return randomUUID()
      case 'crypto.randomBytes': return randomBytes(a.length).toString('base64')
      default: throw new Error('Unimplemented native operation ' + op)
    }
  }
  const context = createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    __bandalNative: { perform: (input: string) => {
      const { op, args } = JSON.parse(input)
      try { return JSON.stringify({ ok: true, value: perform(op, args) }) }
      catch (error: any) { return JSON.stringify({ ok: false, error: { message: error.message, code: error.code } }) }
    } } })
  runInContext(executable, context)
  cleanups.push(() => { for (const fd of descriptors.keys()) fs.closeSync(fd); db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const input = join(root, 'input.pdf'), target = join(root, 'target.pdf')
  fs.writeFileSync(input, 'new PDF bytes'); fs.chmodSync(input, 0o444)
  const inputMode = fs.statSync(input).mode
  return { root, db, input, target, flushed, api: context.durability,
    fail: (predicate: (path: string) => boolean) => { failFlush = predicate },
    unchanged: () => { expect(fs.readFileSync(input, 'utf8')).toBe('new PDF bytes'); expect(fs.statSync(input).mode).toBe(inputMode) } }
}

describe('shipped projector durable copies', () => {
  test.each([false, true])('imports a read-only asset with a writable private copy (existing target: %s)', existing => {
    const f = fixture()
    if (existing) fs.writeFileSync(f.target, 'old PDF bytes')
    f.api.createFileJournal(f.db)([{ target: f.target, source: f.input }], () => f.db.prepare('INSERT INTO changes VALUES(?)').run('committed'))
    expect(fs.readFileSync(f.target, 'utf8')).toBe('new PDF bytes'); f.unchanged()
    expect(f.db.prepare('SELECT count(*) n FROM ipad_sync_commits').get().n).toBe(1)
    expect(f.flushed.some(p => p.endsWith('.sync'))).toBe(true)
    expect(f.flushed.some(p => p.endsWith('.original'))).toBe(existing)
    expect(fs.readdirSync(f.root).some(p => p.endsWith('.sync'))).toBe(false)
  })
  test.each(['.original', '.sync'])('a failed %s flush propagates, preserves the target, and can retry', suffix => {
    const f = fixture(); fs.writeFileSync(f.target, 'old PDF bytes')
    const targetMode = fs.statSync(f.target).mode
    const journal = f.api.createFileJournal(f.db), commit = () => f.db.prepare('INSERT INTO changes VALUES(?)').run('committed')
    f.fail(path => path.endsWith(suffix))
    expect(() => journal([{ target: f.target, source: f.input }], commit)).toThrow('injected disk flush failure')
    expect(fs.readFileSync(f.target, 'utf8')).toBe('old PDF bytes'); f.unchanged()
    expect(fs.statSync(f.target).mode).toBe(targetMode)
    expect(f.db.prepare('SELECT count(*) n FROM ipad_sync_commits').get().n).toBe(0)
    expect(f.db.prepare('SELECT count(*) n FROM changes').get().n).toBe(0)
    expect(fs.readdirSync(f.root).some(p => p.endsWith('.sync'))).toBe(false)
    f.fail(() => false); journal([{ target: f.target, source: f.input }], commit)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('new PDF bytes')
    expect(f.db.prepare('SELECT count(*) n FROM ipad_sync_commits').get().n).toBe(1)
  })
  test('preserves a read-only conflict asset and fails closed on a real flush error', () => {
    const f = fixture(), revision = createHash('sha256').update('new PDF bytes').digest('hex')
    const record = { id: 'asset', kind: 'artifact', payload: { recordType: 'desktop-learning-file', assetRevision: revision } }
    const provided = new Map([[revision, f.input]]), directory = join(f.root, 'SyncConflictAssets')
    f.fail(path => path.endsWith('.tmp'))
    expect(() => f.api.preserveConflictAssets(f.db, record, provided)).toThrow('injected disk flush failure')
    expect(fs.readdirSync(directory)).toEqual([]); f.unchanged()
    f.fail(() => false)
    const saved = f.api.preserveConflictAssets(f.db, record, provided)
    expect(saved).toHaveLength(1)
    expect(fs.readFileSync(saved[0].path, 'utf8')).toBe('new PDF bytes'); f.unchanged()
    expect(fs.readdirSync(directory)).toEqual([revision])
  })
})
