import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createPDFRevisionReader } from '../../../src/main/features/pdf/pdfOriginals'
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readSync: vi.fn(actual.readSync) }
})
const directories: string[] = [], hash = (value: string) => createHash('sha256').update(value).digest('hex')
const fixture = () => { const directory = mkdtempSync(join(tmpdir(), 'bandal-revision-')); directories.push(directory); const path = join(directory, 'lesson.pdf'); writeFileSync(path, 'original'); return path }
const fixed = new Date('2026-10-01T00:00:00Z')
afterEach(() => { vi.clearAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
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
