import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createExportSession, exportChanges, packLog } from '../../../src/main/features/sync/export'
import type { MetaEvent } from '../../../src/main/features/sync/format'
import { loadIdentity, takeSeq } from '../../../src/main/features/sync/identity'
import { MISSING_GRACE_MS, reconcileDocs, repointSyncDocs, type Scan } from '../../../src/main/features/sync/localDocs'
import { createPull } from '../../../src/main/features/sync/pull'
import { createTestDb, type TestDb } from '../helpers/testDb'

const FIXTURES = join(__dirname, '../../../sync-fixtures')
const PDF = readFileSync(join(FIXTURES, '01-basic/root/pdf/b874efadd08d8148d022b60add6a0b3e942654ed646871f2c984c9c9051fb765.pdf'))
const PNG = readFileSync(join(FIXTURES, '01-basic/root/assets/6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0.png'))
const STROKE = 'e1000000-0000-4000-8000-000000000001'
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

/** The shared cloud root. */
let root: Map<string, Uint8Array>
const open: TestDb[] = []
afterEach(() => {
  for (const ctx of open.splice(0)) ctx.cleanup()
})

function walk(folder: string): Scan {
  const files = readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const abs = join(entry.parentPath, entry.name), info = statSync(abs)
    return { relPath: relative(folder, abs).split(sep).join('/'), size: info.size, mtime: Math.round(info.mtimeMs) }
  })
  return { files, complete: true }
}

function device(machine: string) {
  const ctx = createTestDb()
  open.push(ctx)
  const dataRoot = join(ctx.dir, 'Courses'), trash = join(ctx.dir, 'Trash'), stateFile = join(ctx.dir, 'sync', 'state.json')
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
  const materials = createMaterialsRepo({
    db: ctx.db,
    getCourseFolder: id => courses.getFolder(id),
    revealItem: () => {},
    trashItem: async abs => {
      mkdirSync(trash, { recursive: true })
      renameSync(abs, join(trash, basename(abs)))
    },
    onPathChanged: change => ctx.db.transaction(() => {
      repointSyncDocs(ctx.db, change)
      repointMaterialPath({ ...change, db: ctx.db, courseFolder: courses.getFolder(change.courseId) })
    })()
  })
  ctx.db.prepare('UPDATE sync_runtime SET enabled = 1').run()
  const identity = loadIdentity(stateFile, machine)
  const pull = createPull({ db: ctx.db, courses, materials })
  const session = createExportSession()
  /** Root path prefixes whose writes fail, as a full disk would. */
  const failing = new Set<string>()
  let scans = 0
  /** One engine pass: pull, then export. Returns the root paths it wrote. */
  const sync = async (): Promise<string[]> => {
    const pulled = await pull({
      entries: [...root].map(([path, bytes]) => ({ path, version: sha(bytes) })),
      read: async path => root.get(path) ?? Promise.reject(new Error(`${path} is missing`))
    })
    if (pulled.status !== 'applied') throw new Error(JSON.stringify(pulled))
    const paths = new Set(root.keys())
    const { written } = await exportChanges({
      db: ctx.db, device: identity.device_id, takeSeq: () => takeSeq(stateFile, identity, paths),
      root: { paths, merged: pulled.merged, clock: pulled.clock },
      write: async (path, bytes) => {
        if ([...failing].some(prefix => path.startsWith(prefix))) throw new Error(`${path} refused`)
        root.set(path, Buffer.from(bytes))
      },
      scan: async folder => {
        scans += 1
        return walk(folder)
      }
    }, session)
    return written
  }
  const rescan = (courseId: string) => ctx.db.prepare("INSERT INTO sync_outbox (kind, id) VALUES ('docs', ?)").run(courseId)
  const row = (sql: string, ...params: unknown[]) => ctx.db.prepare(sql).get(...params) as Record<string, any> | undefined
  const events = (): MetaEvent[] => [...root].filter(([path]) => path.startsWith(`log/${identity.device_id}/`))
    .flatMap(([, bytes]) => JSON.parse(Buffer.from(bytes).toString('utf8')) as MetaEvent[])
  return { db: ctx.db, id: identity.device_id, courses, materials, trash, folder: (courseId: string) => courses.getFolder(courseId), sync, rescan, row, events, failing, scans: () => scans }
}

/** A pen stroke saved in this app, as the drawings repo stores it. */
function draw(db: TestDb['db'], courseId: string, relPath: string, id = STROKE): void {
  const at = new Date().toISOString()
  db.prepare(`INSERT INTO pdf_drawings (id, course_id, rel_path, page, kind, data_json, style_json, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'ink', ?, ?, ?, ?)`).run(id, courseId, relPath,
    JSON.stringify({ inkVersion: 5, points: [{ x: 0.2, y: 0.3, p: 0.25, t: 0 }, { x: 0.204, y: 0.301, p: 0.4, t: 4 }] }),
    JSON.stringify({ color: 'ink', width: 0.003, opacity: 1 }), at, at)
}

/** Device A with a course holding a PDF with one stroke and a note with an editor image, synced once to an empty root. */
async function startedRoot() {
  root = new Map([['bandal.json', Buffer.from('{"format":2}')]])
  const a = device('mac-a')
  const { id: course } = a.courses.create({ name: '선형대수학', color: 'blue' })
  const dir = a.folder(course)
  mkdirSync(join(dir, '강의'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, '강의/1주차.pdf'), PDF)
  writeFileSync(join(dir, 'assets/그림 1.png'), PNG)
  writeFileSync(join(dir, '요약.md'), '# 요약\n\n![그림](assets/그림%201.png)\n')
  draw(a.db, course, '강의/1주차.pdf')
  return { a, course, written: await a.sync() }
}

test('a course with a PDF, its stroke and a note with an image reaches another device, and nothing echoes back', async () => {
  const { a, course, written } = await startedRoot()
  const pdf = a.row("SELECT document_id FROM sync_docs WHERE local_path = '강의/1주차.pdf'")!.document_id as string
  const note = a.row("SELECT document_id FROM sync_docs WHERE local_path = '요약.md'")!.document_id as string
  const spec = `# 요약\n\n![그림](../../assets/${sha(PNG)}.png)\n`
  const paths = written.map(path => path.replace(a.id, 'A'))
  // Content first, then ink and notes, then the log that points at them.
  expect(new Set(paths.slice(0, 2))).toEqual(new Set([`pdf/${sha(PDF)}.pdf`, `assets/${sha(PNG)}.png`]))
  expect(paths.slice(2)).toEqual([`ink/${pdf}/1/A-00000001.json.gz`, `notes/${note}/A-00000002.md`, 'log/A/00000003.json'])
  expect(Buffer.from(root.get(written[3]!)!).toString('utf8')).toBe(spec)
  const events = new Map(a.events().map(event => [event.id, event]))
  expect(events.get(course)).toMatchObject({ op: 'course.upsert', fields: { name: '선형대수학', color: 'blue', archived: false } })
  expect(events.get(note)).toMatchObject({ op: 'doc.upsert', fields: { course_id: course, type: 'md', rel_path: '', name: '요약.md', md_hash: sha(spec), md_base: null } })
  expect(events.get(pdf)).toMatchObject({ op: 'doc.upsert', fields: { course_id: course, type: 'pdf', rel_path: '강의', name: '1주차.pdf', pdf_sha256: sha(PDF), pdf_prev_sha256: null } })

  const b = device('mac-b')
  expect(await b.sync()).toEqual([])
  expect(b.row('SELECT name, color, deleted_at FROM courses WHERE id = ?', course)).toEqual({ name: '선형대수학', color: 'blue', deleted_at: null })
  expect(sha(readFileSync(join(b.folder(course), '강의/1주차.pdf')))).toBe(sha(PDF))
  expect(readFileSync(join(b.folder(course), '요약.md'), 'utf8')).toBe(`# 요약\n\n![그림](assets/${sha(PNG)}.png)\n`)
  expect(sha(readFileSync(join(b.folder(course), `assets/${sha(PNG)}.png`)))).toBe(sha(PNG))
  expect(b.row('SELECT rel_path, page, kind, deleted_at FROM pdf_drawings WHERE id = ?', STROKE)).toEqual({ rel_path: '강의/1주차.pdf', page: 1, kind: 'ink', deleted_at: null })

  // Each side reads its own files back as applied, and a folder rescan finds nothing new.
  a.rescan(course)
  b.rescan(course)
  expect(await a.sync()).toEqual([])
  expect(await b.sync()).toEqual([])
  // An image-path rewrite touches updated_at without changing the stroke: the base settles and nothing goes (18.3).
  for (const side of [a, b]) side.db.prepare('UPDATE pdf_drawings SET updated_at = ? WHERE id = ?').run(new Date(Date.now() + 5000).toISOString(), STROKE)
  expect(await a.sync()).toEqual([])
  expect(await b.sync()).toEqual([])
})

test('edits travel back: a rename keeps the stroke without rewriting it, then an edited note and a deleted stroke follow', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  await b.materials.rename({ courseId: course, relPath: '강의/1주차.pdf', newName: '1주차 벡터.pdf' })
  b.rescan(course)
  // The rename moved the stroke's row too; it is the same stroke, so no ink file goes.
  expect((await b.sync()).map(path => path.replace(b.id, 'B'))).toEqual(['log/B/00000001.json'])
  await a.sync()
  expect(existsSync(join(a.folder(course), '강의/1주차 벡터.pdf'))).toBe(true)
  expect(a.row('SELECT rel_path FROM pdf_drawings WHERE id = ?', STROKE)!.rel_path).toBe('강의/1주차 벡터.pdf')

  writeFileSync(join(b.folder(course), '요약.md'), '# 요약\n\n다른 기기에서 고친 내용\n')
  const at = new Date(Date.now() + 1000).toISOString()
  b.db.prepare('UPDATE pdf_drawings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(at, at, STROKE)
  b.rescan(course)
  await b.sync()
  const note = b.row("SELECT document_id FROM sync_docs WHERE local_path = '요약.md'")!.document_id as string
  expect(b.events().find(event => event.id === note && event.fields.md_hash === sha('# 요약\n\n다른 기기에서 고친 내용\n'))?.fields.md_base)
    .toBe(sha(`# 요약\n\n![그림](../../assets/${sha(PNG)}.png)\n`))
  await a.sync()
  expect(readFileSync(join(a.folder(course), '요약.md'), 'utf8')).toBe('# 요약\n\n다른 기기에서 고친 내용\n')
  expect(a.row('SELECT deleted_at FROM pdf_drawings WHERE id = ?', STROKE)!.deleted_at).not.toBeNull()
  expect(await a.sync()).toEqual([])
})

test('a course deleted here goes elsewhere with its documents; its folder stays here', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  a.courses.softDelete({ courseId: course })
  await a.sync()
  expect(a.events().filter(event => event.op.endsWith('.delete')).map(event => event.op)).toEqual(['course.delete', 'doc.delete', 'doc.delete'])
  await b.sync()
  expect(b.row('SELECT deleted_at FROM courses WHERE id = ?', course)!.deleted_at).not.toBeNull()
  expect(readdirSync(b.trash).sort()).toEqual(['1주차.pdf', '요약.md'])
  expect(existsSync(join(a.courses.getFolderIncludingDeleted(course), '강의/1주차.pdf'))).toBe(true)
  expect(await a.sync()).toEqual([])
})

test('a file deleted here becomes a doc.delete once two complete scans a minute apart miss it', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  const folder = a.folder(course)
  rmSync(join(folder, '요약.md'))
  await reconcileDocs(a.db, course, walk(folder), async relPath => sha(readFileSync(join(folder, relPath))), Date.now() - 2 * MISSING_GRACE_MS)
  a.rescan(course)
  await a.sync()
  expect(a.events().at(-1)).toMatchObject({ op: 'doc.delete' })
  await b.sync()
  expect(readdirSync(b.trash)).toEqual(['요약.md'])
})

test('a conflict copy stays derived until it is edited here, then goes out as a document of its own', async () => {
  root = new Map([...readdirSync(join(FIXTURES, '04-note-both-edited/root'), { recursive: true, withFileTypes: true })]
    .filter(entry => entry.isFile())
    .map(entry => [relative(join(FIXTURES, '04-note-both-edited/root'), join(entry.parentPath, entry.name)).split(sep).join('/'), readFileSync(join(entry.parentPath, entry.name))]))
  const a = device('mac-a')
  await a.sync()
  const copy = a.row("SELECT document_id, course_id, local_path FROM sync_docs WHERE local_path LIKE '%충돌 사본%'")!
  a.rescan(copy.course_id)
  expect(await a.sync()).toEqual([])
  writeFileSync(join(a.folder(copy.course_id), copy.local_path), '# 사본에서 이어 쓴 내용\n')
  a.rescan(copy.course_id)
  await a.sync()
  expect(a.events().find(event => event.id === copy.document_id)).toMatchObject({
    op: 'doc.upsert', fields: { course_id: copy.course_id, type: 'md', md_hash: sha('# 사본에서 이어 쓴 내용\n') }
  })
})

test('a path collision\'s name is written out once and then stays put', async () => {
  root = new Map([...readdirSync(join(FIXTURES, '06-path-collision/root'), { recursive: true, withFileTypes: true })]
    .filter(entry => entry.isFile())
    .map(entry => [relative(join(FIXTURES, '06-path-collision/root'), join(entry.parentPath, entry.name)).split(sep).join('/'), readFileSync(join(entry.parentPath, entry.name))]))
  const expected = JSON.parse(readFileSync(join(FIXTURES, '06-path-collision/expected.json'), 'utf8')) as { renames: { id: string; name: string }[] }
  const a = device('mac-a')
  await a.sync()
  a.rescan('c0000000-0000-4000-8000-000000000001')
  await a.sync()
  expect(a.events().map(event => ({ id: event.id, name: event.fields.name })).sort((x, y) => (x.id < y.id ? -1 : 1))).toEqual(expected.renames)
  a.rescan('c0000000-0000-4000-8000-000000000001')
  expect(await a.sync()).toEqual([])
})

test('a note that is not UTF-8 goes out byte for byte, links and all', async () => {
  const { a, course } = await startedRoot()
  const euckr = Buffer.concat([Buffer.from('b0a1b3aa0a', 'hex'), Buffer.from('![](assets/그림%201.png)\n')])
  writeFileSync(join(a.folder(course), '요약.md'), euckr)
  a.rescan(course)
  const written = await a.sync()
  expect(Buffer.from(root.get(written.find(path => path.startsWith('notes/'))!)!)).toEqual(euckr)
})

test('a note link only ever uploads files from the course\'s assets folder', async () => {
  const { a, course } = await startedRoot()
  writeFileSync(join(a.folder(course), 'private.txt'), '비밀')
  writeFileSync(join(a.folder(course), '요약.md'), '![](assets/../private.txt)\n')
  a.rescan(course)
  const written = await a.sync()
  expect(written.filter(path => path.startsWith('assets/'))).toEqual([])
  expect(Buffer.from(root.get(written.find(path => path.startsWith('notes/'))!)!).toString('utf8')).toBe('![](assets/../private.txt)\n')
})

test('a rename that only changes case goes out, and a Mac that cannot apply it does not send the old spelling back', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  renameSync(join(b.folder(course), '강의/1주차.pdf'), join(b.folder(course), '강의/1주차.PDF'))
  b.rescan(course)
  await b.sync()
  expect(b.events().at(-1)).toMatchObject({ op: 'doc.upsert', fields: { name: '1주차.PDF' } })
  await a.sync()
  a.rescan(course)
  expect(await a.sync()).toEqual([])
  b.rescan(course)
  expect(await b.sync()).toEqual([])
})

test('a stroke whose PDF is gone stays here instead of asking for a rescan on every pass', async () => {
  const { a, course } = await startedRoot()
  draw(a.db, course, '없는 파일.pdf', 'e1000000-0000-4000-8000-000000000009')
  await a.sync()
  const scans = a.scans()
  await a.sync()
  await a.sync()
  expect(a.scans()).toBe(scans)
})

test('a failed write is retried under the same file names, so a fault never multiplies files', async () => {
  const { a, course } = await startedRoot()
  writeFileSync(join(a.folder(course), '새 노트.md'), '# 새 노트\n')
  a.rescan(course)
  a.failing.add('log/')
  await expect(a.sync()).rejects.toThrow('refused')
  await expect(a.sync()).rejects.toThrow('refused')
  a.failing.clear()
  await a.sync()
  const note = a.row("SELECT document_id FROM sync_docs WHERE local_path = '새 노트.md'")!.document_id as string
  expect([...root.keys()].filter(path => path.startsWith(`notes/${note}/`))).toHaveLength(1)
  expect(a.events().filter(event => event.id === note).length).toBeGreaterThan(0)
})

test('a course renamed here while another device deletes it stays, and the rename brings it back there', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  b.courses.softDelete({ courseId: course })
  await b.sync()
  a.courses.rename({ courseId: course, name: '선형대수학 (계속)' })
  await a.sync()
  expect(a.row('SELECT name, deleted_at FROM courses WHERE id = ?', course)).toEqual({ name: '선형대수학 (계속)', deleted_at: null })
  await b.sync()
  expect(b.row('SELECT name, deleted_at FROM courses WHERE id = ?', course)).toEqual({ name: '선형대수학 (계속)', deleted_at: null })
})

test('log events fill the open file, then new ones, each within the size limit', () => {
  const events = Array.from({ length: 12 }, (_, index) => ({ t: index, op: 'course.upsert', id: `c${index}`, fields: { name: 'x'.repeat(40) } }))
  let seq = 7
  const files = packLog({ seq: 3, events: events.slice(0, 1) }, events.slice(1), 300, () => seq++)
  expect(files[0]!.seq).toBe(3)
  expect(files.length).toBeGreaterThan(2)
  for (const file of files) expect(Buffer.byteLength(JSON.stringify(file.events))).toBeLessThanOrEqual(300)
  expect(files.flatMap(file => file.events)).toEqual(events)
})

test('a note edited here in a course another device deleted brings the course back with it (v2.4)', async () => {
  const { a, course } = await startedRoot()
  const b = device('mac-b')
  await b.sync()
  a.courses.softDelete({ courseId: course })
  await a.sync()
  writeFileSync(join(b.folder(course), '요약.md'), '# 요약\n\n지우기 전에 고친 내용\n')
  b.rescan(course)
  await b.sync()
  expect(b.events().filter(event => event.id === course).map(event => event.op)).toEqual(['course.upsert'])
  expect(b.row('SELECT deleted_at FROM courses WHERE id = ?', course)!.deleted_at).toBeNull()
  await a.sync()
  expect(a.row('SELECT deleted_at FROM courses WHERE id = ?', course)!.deleted_at).toBeNull()
  expect(readFileSync(join(a.folder(course), '요약.md'), 'utf8')).toBe('# 요약\n\n지우기 전에 고친 내용\n')
  // The PDF went with the delete and stays gone.
  expect(existsSync(join(a.folder(course), '강의/1주차.pdf'))).toBe(false)
})

test('pages appended here go out with the bytes they grew from, even several appends between two passes; a replacement does not', async () => {
  const { a, course } = await startedRoot()
  const pdf = a.row("SELECT document_id FROM sync_docs WHERE local_path = '강의/1주차.pdf'")!.document_id as string
  const file = join(a.folder(course), '강의/1주차.pdf')
  const h0 = readFileSync(file), h1 = Buffer.concat([h0, Buffer.from('% page 2\n')]), h2 = Buffer.concat([h1, Buffer.from('% page 3\n')])
  // What the page editor records (pdfNotes creates this table and its appended column).
  a.db.exec(`CREATE TABLE IF NOT EXISTS pdf_restructure_log (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, from_sha TEXT NOT NULL,
    to_sha TEXT NOT NULL, recipe_json TEXT NOT NULL, created_at TEXT NOT NULL, appended INTEGER NOT NULL DEFAULT 0)`)
  const record = a.db.prepare("INSERT INTO pdf_restructure_log VALUES (?, 'm', ?, ?, '[]', 'now', ?)")
  record.run('r1', sha(h0), sha(h1), 1)
  record.run('r2', sha(h1), sha(h2), 1)
  writeFileSync(file, h2)
  a.rescan(course)
  await a.sync()
  const last = () => a.events().filter(event => event.id === pdf).at(-1)!.fields
  expect(last()).toMatchObject({ pdf_sha256: sha(h2), pdf_prev_sha256: sha(h0) })
  const other = Buffer.from('%PDF-1.7 another file\n')
  writeFileSync(file, other)
  a.rescan(course)
  await a.sync()
  expect(last()).toMatchObject({ pdf_sha256: sha(other), pdf_prev_sha256: null })
})
