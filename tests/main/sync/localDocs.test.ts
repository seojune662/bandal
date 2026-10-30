import { afterEach, beforeEach, expect, test } from 'vitest'
import { MISSING_GRACE_MS, reconcileDocs, repointSyncDocs, type LocalFile, type SyncDocRow } from '../../../src/main/features/sync/localDocs'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE = 'c0000000-0000-4000-8000-000000000001'
let ctx: TestDb
let hashes: Record<string, string>

beforeEach(() => {
  ctx = createTestDb()
  hashes = {}
  ctx.db.prepare(`INSERT INTO courses (id, name, slug, color, folder_path, created_at, updated_at)
    VALUES (?, '선형대수학', 'linear', 'blue', '/tmp/linear', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z')`).run(COURSE)
})
afterEach(() => ctx.cleanup())

const file = (relPath: string, hash: string, mtime = 1): LocalFile => {
  hashes[relPath] = hash
  return { relPath, size: hash.length, mtime }
}
const scan = (files: LocalFile[], now = 1000, complete = true) => reconcileDocs(ctx.db, COURSE, { files, complete }, async relPath => hashes[relPath]!, now)
const minute = MISSING_GRACE_MS
const rows = () => ctx.db.prepare('SELECT * FROM sync_docs ORDER BY local_path').all() as SyncDocRow[]
const at = (path: string) => rows().find(row => row.local_path === path)

test('a file renamed outside the app keeps its document id by content', async () => {
  await scan([file('1주차.pdf', 'h1'), file('요약.md', 'h2')])
  const id = at('1주차.pdf')!.document_id
  await scan([file('강의/1주차 벡터.pdf', 'h1'), file('요약.md', 'h2')])
  expect(rows().map(row => [row.local_path, row.document_id === id])).toEqual([['강의/1주차 벡터.pdf', true], ['요약.md', false]])
})

test('a document counts as deleted only when two complete scans a minute apart miss it', async () => {
  await scan([file('a.pdf', 'h1')])
  const id = at('a.pdf')!.document_id
  await scan([], 2000)
  expect(at('a.pdf')).toMatchObject({ document_id: id, missing_since: 2000 })
  await scan([file('a.pdf', 'h1')], 3000)
  expect(at('a.pdf')).toMatchObject({ document_id: id, missing_since: null })
  await scan([], 4000)
  // Back under another name before the second miss: still the same document.
  await scan([file('b.pdf', 'h1')], 5000)
  expect(at('b.pdf')!.document_id).toBe(id)
  await scan([], 6000)
  await scan([], 6000 + minute - 1)
  expect(at('b.pdf')).toMatchObject({ document_id: id, missing_since: 6000 })
  // A walk that stopped early proves nothing about the files it did not reach.
  await scan([], 6000 + 10 * minute, false)
  expect(at('b.pdf')).toBeDefined()
  await scan([], 6000 + minute)
  expect(rows()).toEqual([])
})

test('a scan that sees the file under other case or normalization keeps the document and its disk spelling', async () => {
  await scan([file('Lecture/1주차.pdf', 'h1')])
  const id = at('Lecture/1주차.pdf')!.document_id
  hashes = {}
  await scan([{ relPath: 'lecture/1주차.pdf'.normalize('NFD'), size: 2, mtime: 1 }])
  expect(rows().map(row => [row.document_id, row.local_path])).toEqual([[id, 'lecture/1주차.pdf'.normalize('NFD')]])
})

test('an edited file keeps its id and records the new bytes; the synced hash stays for export to compare', async () => {
  await scan([file('요약.md', 'h1', 1)])
  ctx.db.prepare("UPDATE sync_docs SET synced_hash = 'h1'").run()
  await scan([file('요약.md', 'h2', 2)])
  expect(at('요약.md')).toMatchObject({ local_hash: 'h2', synced_hash: 'h1', local_mtime: 2 })
})

test('only pdf and md files outside dot folders are documents, and rows still being written are left alone', async () => {
  ctx.db.prepare("INSERT INTO sync_docs (document_id, course_id, local_path) VALUES ('d0000000-0000-4000-8000-00000000000a', ?, 'arriving.pdf')").run(COURSE)
  await scan([file('.bandal/learning/state.md', 'h1'), file('scan.png', 'h2'), file('노트.markdown', 'h3')])
  await scan([])
  expect(rows().map(row => row.local_path)).toEqual(['arriving.pdf', '노트.markdown'])
})

test('a PDF keeps the identity its document binding already gave it', async () => {
  ctx.db.exec('CREATE TABLE pdf_document_aliases (course_id TEXT NOT NULL, rel_path TEXT NOT NULL, material_id TEXT NOT NULL UNIQUE, PRIMARY KEY (course_id, rel_path))')
  ctx.db.prepare("INSERT INTO pdf_document_aliases VALUES (?, 'a.pdf', 'e5a1a1a1-0000-4000-8000-000000000001')").run(COURSE)
  await scan([file('a.pdf', 'h1')])
  expect(at('a.pdf')!.document_id).toBe('e5a1a1a1-0000-4000-8000-000000000001')
})

test('in-app renames of another case still find the documents', async () => {
  await scan([file('Lecture/a.pdf', 'h1')])
  repointSyncDocs(ctx.db, { courseId: COURSE, fromRelPath: 'lecture', toRelPath: 'Week 1', isDirectory: true })
  expect(rows().map(row => row.local_path)).toEqual(['Week 1/a.pdf'])
})

test('in-app renames carry document ids to the new file or folder path', async () => {
  await scan([file('강의/1주차.pdf', 'h1'), file('강의/2주차.pdf', 'h2'), file('강의자료.md', 'h3')])
  const before = Object.fromEntries(rows().map(row => [row.document_id, row.local_path]))
  repointSyncDocs(ctx.db, { courseId: COURSE, fromRelPath: '강의', toRelPath: '수업', isDirectory: true })
  repointSyncDocs(ctx.db, { courseId: COURSE, fromRelPath: '수업/1주차.pdf', toRelPath: '수업/1주차 벡터.pdf', isDirectory: false })
  const after = Object.fromEntries(rows().map(row => [row.document_id, row.local_path]))
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  expect(Object.values(after).sort()).toEqual(['강의자료.md', '수업/1주차 벡터.pdf', '수업/2주차.pdf'])
})

test('triggers note local changes only while sync is on and no remote change is being applied', () => {
  const outbox = () => ctx.db.prepare('SELECT kind, id FROM sync_outbox ORDER BY rowid').all()
  const rename = (name: string) => ctx.db.prepare('UPDATE courses SET name = ? WHERE id = ?').run(name, COURSE)
  rename('off')
  expect(outbox()).toEqual([])
  ctx.db.prepare('UPDATE sync_runtime SET enabled = 1').run()
  rename('on')
  ctx.db.prepare("UPDATE courses SET folder_path = '/tmp/elsewhere' WHERE id = ?").run(COURSE)
  ctx.db.prepare(`INSERT INTO pdf_drawings (id, course_id, rel_path, page, kind, data_json, style_json, created_at, updated_at)
    VALUES ('e0000000-0000-4000-8000-000000000001', ?, 'a.pdf', 1, 'ink', '{}', '{}', 'x', 'x')`).run(COURSE)
  const index = ctx.db.prepare(`INSERT INTO materials_index (id, course_id, rel_path, kind, size, mtime, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, 'x', 'x')`)
  index.run('m1', COURSE, 'a.pdf', 'pdf')
  index.run('m2', COURSE, 'scan.png', 'image')
  ctx.db.prepare('UPDATE sync_runtime SET applying = 1').run()
  rename('applying')
  ctx.db.prepare("UPDATE pdf_drawings SET deleted_at = 'x'").run()
  expect(outbox()).toEqual([
    { kind: 'course', id: COURSE },
    { kind: 'ink', id: 'e0000000-0000-4000-8000-000000000001' },
    { kind: 'docs', id: COURSE }
  ])
})
