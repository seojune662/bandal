import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createShareInbox, shareRequestId } from '../../../src/main/features/share/shareInbox'
const roots: string[] = []
const id = 'fe52f87b-7056-4565-a099-4a52a9cefc57'
function fixture(files = ['공유한 내용.md']) {
  const root = mkdtempSync(join(tmpdir(), 'bandal-share-test-')); roots.push(root)
  mkdirSync(join(root, id))
  for (const name of files) writeFileSync(join(root, id, name), 'shared content')
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify({ version: 1, id, createdAt: '2026-10-19T13:00:00Z', files }))
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('share inbox', () => {
  it('accepts only an opaque UUID handoff, never paths or credentials', () => {
    expect(shareRequestId(`bandal://share/inbox/${id}`)).toBe(id)
    for (const url of [`bandal://share/inbox/../../etc`, `https://share/inbox/${id}`, `bandal://name@share/inbox/${id}`, `bandal://share/inbox/${id}?path=/etc/passwd`]) expect(shareRequestId(url)).toBeNull()
  })
  it('survives receiver restarts and only imports into the chosen destination', () => {
    const root = fixture(); const importer = vi.fn(() => ({ imported: ['강의/공유한 내용 (2).md'], failed: [] })); const changed = vi.fn()
    const create = () => createShareInbox({ journalRoot: join(root, 'journal'), root: () => root, importFiles: importer, changed })
    expect(create().list()[0]?.files[0]?.name).toBe('공유한 내용.md')
    expect(create().receive(`bandal://share/inbox/${id}`)).toBe(true)
    const inbox = create()
    expect(inbox.import({ id, courseId: 'course', dirRelPath: '강의' }).relPaths).toEqual(['강의/공유한 내용 (2).md'])
    expect(importer).toHaveBeenCalledWith('course', [join(root, id, '공유한 내용.md')], '강의')
    expect(inbox.list()).toEqual([])
  })
  it('rejects symlinked requests, files, and path traversal manifests', () => {
    const root = fixture(); const importer = vi.fn(); const inbox = createShareInbox({ journalRoot: join(root, 'journal'), root: () => root, importFiles: importer, changed: () => {} })
    rmSync(join(root, id, '공유한 내용.md')); symlinkSync(join(root, id, 'manifest.json'), join(root, id, '공유한 내용.md'))
    expect(inbox.list()).toEqual([])
    expect(() => inbox.import({ id, courseId: 'course', dirRelPath: '' })).toThrow()
    expect(importer).not.toHaveBeenCalled()
    writeFileSync(join(root, id, 'manifest.json'), JSON.stringify({ version: 1, id, createdAt: '2026-10-19', files: ['../outside'] }))
    expect(inbox.list()).toEqual([])
  })
  it('keeps a failed delivery and skips already imported files when retried', () => {
    const root = fixture(['one.md', 'two.md']); let failed = true
    const importer = vi.fn((_course: string, paths: string[]) => paths[0]?.endsWith('two.md') && failed
      ? { imported: [], failed: [{ path: paths[0], reason: 'unavailable' }] }
      : { imported: [paths[0]!.endsWith('two.md') ? 'two.md' : 'one.md'], failed: [] })
    const inbox = createShareInbox({ journalRoot: join(root, 'journal'), root: () => root, importFiles: importer, changed: () => {} })
    expect(() => inbox.import({ id, courseId: 'course', dirRelPath: '' })).toThrow()
    expect(inbox.list()).toHaveLength(1); failed = false
    const restarted = createShareInbox({ journalRoot: join(root, 'journal'), root: () => root, importFiles: importer, changed: () => {} })
    expect(restarted.import({ id, courseId: 'course', dirRelPath: '' }).relPaths).toEqual(['one.md', 'two.md'])
    expect(importer.mock.calls.filter(call => call[1][0]?.endsWith('one.md'))).toHaveLength(1)
  })
  it('dismisses staged copies without touching original source data', () => {
    const root = fixture(); writeFileSync(join(root, 'original.md'), 'original')
    createShareInbox({ journalRoot: join(root, 'journal'), root: () => root, importFiles: vi.fn(), changed: () => {} }).dismiss(id)
    expect(readFileSync(join(root, 'original.md'), 'utf8')).toBe('original')
  })
})
