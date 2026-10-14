import { afterEach, describe, expect, test, vi } from 'vitest'
import { chmodSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createPDFOriginalPreserver, createPDFRevisionReader } from '../../../src/main/features/pdf/pdfOriginals'
const flushFault = vi.hoisted(() => ({ requireWrite: false, error: null as NodeJS.ErrnoException | null, handles: new Map<number, string | number>() }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readSync: vi.fn(actual.readSync),
    openSync: vi.fn((...args: Parameters<typeof actual.openSync>) => {
      const descriptor = actual.openSync(...args)
      flushFault.handles.set(descriptor, args[1]); return descriptor
    }),
    closeSync: (descriptor: number) => { flushFault.handles.delete(descriptor); return actual.closeSync(descriptor) },
    fsyncSync: vi.fn((descriptor: number) => {
      const flags = flushFault.handles.get(descriptor)
      // Windows FlushFileBuffers requires a handle with GENERIC_WRITE.
      if (flushFault.requireWrite && (typeof flags !== 'string' || !/[wa+]/.test(flags))) {
        throw Object.assign(new Error('EPERM: read-only handle cannot flush'), { code: 'EPERM' })
      }
      if (flushFault.error) throw flushFault.error
      return actual.fsyncSync(descriptor)
    })
  }
})
const directories: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex')
const fixture = () => { const directory = mkdtempSync(join(tmpdir(), 'bandal-revision-')); directories.push(directory); const path = join(directory, 'lesson.pdf'); writeFileSync(path, 'original'); return path }
const fixed = new Date('2026-10-01T00:00:00Z')
afterEach(() => { flushFault.requireWrite = false; flushFault.error = null; flushFault.handles.clear(); vi.clearAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
describe('PDF revision reader', () => {
  test('fresh metadata checks reuse an unchanged digest without reading file bytes', () => {
    const path = fixture(), revision = createPDFRevisionReader()
    expect(revision(path)).toBe(hash('original'))
    const reads = vi.mocked(readSync).mock.calls.length
    for (let index = 0; index < 100; index++) expect(revision(path)).toBe(hash('original'))
    expect(vi.mocked(readSync).mock.calls.length).toBe(reads)
  })
  test('same-size in-place edit with restored mtime invalidates through ctime', () => {
    const path = fixture(), revision = createPDFRevisionReader()
    utimesSync(path, fixed, fixed)
    const before = statSync(path, { bigint: true })
    expect(revision(path)).toBe(hash('original'))
    writeFileSync(path, 'replaced'); utimesSync(path, fixed, fixed)
    const after = statSync(path, { bigint: true })
    expect(after.ino).toBe(before.ino); expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs)
    expect(after.ctimeNs).not.toBe(before.ctimeNs)
    expect(revision(path)).toBe(hash('replaced'))
  })
  test('atomic replacement with same size and mtime invalidates through inode', () => {
    const path = fixture(), revision = createPDFRevisionReader(), next = path + '.new'
    utimesSync(path, fixed, fixed); expect(revision(path)).toBe(hash('original'))
    const before = statSync(path, { bigint: true })
    writeFileSync(next, 'replaced'); utimesSync(next, fixed, fixed); renameSync(next, path)
    const after = statSync(path, { bigint: true })
    expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs); expect(after.ino).not.toBe(before.ino)
    expect(revision(path)).toBe(hash('replaced'))
  })
  test('a mutation during bounded hashing fails and cannot poison the next cached read', async () => {
    const path = fixture(), revision = createPDFRevisionReader(), actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.mocked(readSync).mockImplementationOnce(((...args: Parameters<typeof readSync>) => { const bytes = actual.readSync(...args); writeFileSync(path, 'changed-during-hash'); return bytes }) as typeof readSync)
    expect(() => revision(path)).toThrow(/changed while checking/)
    expect(revision(path)).toBe(hash('changed-during-hash'))
  })
})

describe('durable PDF original preservation', () => {
  test('flushes a writable private copy on Windows while leaving a read-only source intact', () => {
    const source = fixture(), cache = source + '-cache', revision = hash('original')
    chmodSync(source, 0o444)
    const sourceMode = statSync(source).mode
    flushFault.requireWrite = true
    const preserve = createPDFOriginalPreserver(cache, () => source)
    try {
      preserve('course', 'lesson.pdf', revision)
      expect(readFileSync(join(cache, revision + '.pdf'), 'utf8')).toBe('original')
      expect(readFileSync(source, 'utf8')).toBe('original')
      expect(statSync(source).mode).toBe(sourceMode)
      expect(fsyncSync).toHaveBeenCalledOnce()
      expect(vi.mocked(openSync).mock.calls.some(([path, flags]) => String(path).endsWith('.tmp') && flags === 'r+')).toBe(true)
      expect(readdirSync(cache)).toEqual([revision + '.pdf'])
      preserve('course', 'lesson.pdf', revision)
      expect(fsyncSync).toHaveBeenCalledOnce()
    } finally { chmodSync(source, 0o600) }
  })
  test('propagates a real flush failure, removes the unpublished copy, and retries without a false cached success', () => {
    const source = fixture(), cache = source + '-cache', revision = hash('original')
    const preserve = createPDFOriginalPreserver(cache, () => source)
    const failure = Object.assign(new Error('disk flush failed'), { code: 'EIO' })
    flushFault.error = failure
    expect(() => preserve('course', 'lesson.pdf', revision)).toThrow(failure)
    expect(existsSync(join(cache, revision + '.pdf'))).toBe(false)
    expect(readdirSync(cache)).toEqual([])
    expect(readFileSync(source, 'utf8')).toBe('original')
    flushFault.error = null
    preserve('course', 'lesson.pdf', revision)
    expect(readFileSync(join(cache, revision + '.pdf'), 'utf8')).toBe('original')
    expect(fsyncSync).toHaveBeenCalledTimes(2)
  })
})
