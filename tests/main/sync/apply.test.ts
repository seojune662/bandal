import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { repointMaterialPath } from '../../../src/main/features/links/renameRepoint'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { importInkObject } from '../../../src/main/features/sync/adapter'
import { localPath } from '../../../src/main/features/sync/apply'
import type { InkObject } from '../../../src/main/features/sync/format'
import { MISSING_GRACE_MS, reconcileDocs, repointSyncDocs } from '../../../src/main/features/sync/localDocs'
import { createPull, type RootSnapshot } from '../../../src/main/features/sync/pull'
import { createTestDb, type TestDb } from '../helpers/testDb'

const FIXTURES = join(__dirname, '../../../sync-fixtures')
const NAMES = readdirSync(FIXTURES).filter(name => /^\d\d-/.test(name)).sort()
const COURSE = 'c0000000-0000-4000-8000-000000000001'
const PDF_DOC = 'd0000000-0000-4000-8000-000000000001'
const NOTE_DOC = 'd0000000-0000-4000-8000-000000000002'
const PHONE = 'eeeeeeee-0000-4000-8000-000000000005'
const COURSE2 = 'c0000000-0000-4000-8000-000000000002'
const NOTE_V0 = '2644a7f618bea8112420f70848e4796a79d8cad194f211e698dacaf7a0472661'
const T = 1793400000000

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const localized = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8').replace(/\.\.\/\.\.\/assets\//g, 'assets/')

type Root = Map<string, Uint8Array>

function loadRoot(name: string): Root {
  const dir = join(FIXTURES, name, 'root')
  return new Map(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => [relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'), readFileSync(join(entry.parentPath, entry.name))]))
}

function snapshot(root: Root, options: { offline?: ReadonlySet<string>; onRead?: (path: string) => void } = {}): RootSnapshot {
  return {
    entries: [...root].map(([path, bytes]) => ({ path, version: sha(bytes) })),
    read: async path => {
      options.onRead?.(path)
      const bytes = root.get(path)
      if (options.offline?.has(path) || bytes === undefined) throw new Error(`${path} is unavailable`)
      return bytes
    }
  }
}

/** A device's later log file; `t` is past every fixture stamp. */
function withLog(root: Root, seq: number, events: { t: number; op: string; id: string; fields?: Record<string, unknown> }[]): Root {
  return new Map([...root, [`log/${PHONE}/${String(seq).padStart(8, '0')}.json`, Buffer.from(JSON.stringify(events))]])
}

let ctx: TestDb
beforeEach(() => { ctx = createTestDb() })
afterEach(() => ctx.cleanup())

function profile() {
  const dataRoot = join(ctx.dir, 'Courses'), trash = join(ctx.dir, 'Trash')
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
  const materials = createMaterialsRepo({
    db: ctx.db,
    getCourseFolder: id => courses.getFolder(id),
    revealItem: () => {},
    trashItem: async abs => {
      mkdirSync(trash, { recursive: true })
      renameSync(abs, join(trash, basename(abs)))
    },
    // The app's path-change hook, minus the parts these tests do not touch.
    onPathChanged: change => ctx.db.transaction(() => {
      repointSyncDocs(ctx.db, change)
      repointMaterialPath({ ...change, db: ctx.db, courseFolder: courses.getFolder(change.courseId) })
    })()
  })
  ctx.db.prepare('UPDATE sync_runtime SET enabled = 1').run()
  const folder = (courseId: string) => courses.getFolder(courseId)
  /** What the engine will do after each scan of a course folder. */
  const scanCourse = async (courseId: string, now: number) => {
    const dir = folder(courseId)
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
      const abs = join(entry.parentPath, entry.name), info = statSync(abs)
      return { relPath: relative(dir, abs).split(sep).join('/'), size: info.size, mtime: Math.round(info.mtimeMs) }
    })
    await reconcileDocs(ctx.db, courseId, { files, complete: true }, async relPath => sha(readFileSync(join(dir, relPath))), now)
  }
  return { pull: createPull({ db: ctx.db, courses, materials }), courses, materials, folder, trash, scanCourse }
}

const row = (sql: string, ...params: unknown[]) => ctx.db.prepare(sql).get(...params) as Record<string, any> | undefined
const outbox = () => ctx.db.prepare('SELECT kind, id FROM sync_outbox').all()

/** Everything apply may touch: rows and the bytes of every file under the data root. */
function dump(): unknown {
  const tables = ['courses', 'sync_docs', 'sync_meta', 'sync_ink', 'pdf_drawings']
    .map(table => ctx.db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all())
  const dataRoot = join(ctx.dir, 'Courses')
  const files = existsSync(dataRoot)
    ? readdirSync(dataRoot, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
      .map(entry => [relative(dataRoot, join(entry.parentPath, entry.name)), sha(readFileSync(join(entry.parentPath, entry.name)))]).sort()
    : []
  return { tables, files }
}

interface Expected {
  blocked: string | null
  courses: Record<string, { name?: string; sort?: number; color?: string; archived?: boolean; alive: boolean }>
  docs: Record<string, { course_id: string; type: string; name: string; rel_path: string; pdf_sha256?: string; alive: boolean }>
  ink: Record<string, Record<string, Record<string, InkObject>>>
  notes: Record<string, { md_hash: string; file: string | null }>
  conflict_copies: { id: string; course_id: string; rel_path: string; name: string; file: string }[]
  renames: { id: string; name: string }[]
  waiting: { docs: string[]; ink: string[]; copies: string[] }
}

/** The profile shows what expected.json says the root holds, except what has to wait. */
function expectProfile(expected: Expected, root: Root, folder: (courseId: string) => string): void {
  const alive = Object.entries(expected.docs).filter(([, doc]) => doc.alive)
  const holding = new Set([...alive.map(([, doc]) => doc.course_id), ...expected.conflict_copies.map(copy => copy.course_id)])
  for (const [id, course] of Object.entries(expected.courses)) {
    const local = row('SELECT * FROM courses WHERE id = ?', id)
    if (!course.alive && !holding.has(id)) {
      expect(local).toBeUndefined()
      continue
    }
    expect(local).toMatchObject({ name: course.name, color: course.color, archived: course.archived ? 1 : 0, deleted_at: null, source: 'managed' })
    if (course.sort !== undefined) expect(local!.sort_order).toBe(course.sort)
  }
  const waiting = new Set([...expected.waiting.docs, ...expected.waiting.copies])
  const renamed = new Map(expected.renames.map(rename => [rename.id, rename.name]))
  const placed = new Map<string, string>()
  // In id order, as apply places them: a path another file already holds on a case-insensitive disk gets "(2)".
  const arriving = [
    ...alive.filter(([id]) => !waiting.has(id)).map(([id, doc]) => ({ id, course: doc.course_id, path: localPath(doc.rel_path, renamed.get(id) ?? doc.name, doc.type as 'pdf' | 'md'),
      content: doc.type === 'pdf' ? null : expected.notes[id]!.file!, hash: doc.pdf_sha256 })),
    ...expected.conflict_copies.map(copy => ({ id: copy.id, course: copy.course_id, path: localPath(copy.rel_path, copy.name, 'md'), content: copy.file, hash: undefined }))
  ].sort((a, b) => (a.id < b.id ? -1 : 1))
  const disk = (course: string, path: string) => `${course}/${path.normalize('NFC').toUpperCase()}`
  const onDisk = new Set<string>()
  for (const doc of arriving) {
    const path = onDisk.has(disk(doc.course, doc.path)) ? doc.path.replace(/(\.[^./]+)?$/, ' (2)$1') : doc.path
    onDisk.add(disk(doc.course, path))
    expect(row('SELECT local_path FROM sync_docs WHERE document_id = ?', doc.id)?.local_path).toBe(path)
    const bytes = readFileSync(join(folder(doc.course), path))
    if (doc.content === null) expect(sha(bytes)).toBe(doc.hash)
    else expect(bytes.toString('utf8')).toBe(localized(root.get(doc.content)!))
    placed.set(doc.id, path)
  }
  for (const [id] of alive) if (waiting.has(id)) expect(row('SELECT * FROM sync_docs WHERE document_id = ?', id)).toBeUndefined()
  for (const [id, doc] of Object.entries(expected.docs)) if (!doc.alive) expect(row('SELECT * FROM sync_docs WHERE document_id = ?', id)).toBeUndefined()

  for (const [doc, pages] of Object.entries(expected.ink)) {
    for (const objects of Object.values(pages)) {
      for (const [id, object] of Object.entries(objects)) {
        const local = row('SELECT * FROM pdf_drawings WHERE id = ?', id), path = placed.get(doc)
        if (expected.waiting.ink.includes(id) || path === undefined || !path.endsWith('.pdf')) {
          expect(local).toBeUndefined()
          continue
        }
        if (object.del) {
          if (local) expect(local.deleted_at).not.toBeNull()
          continue
        }
        let action: string
        try { action = importInkObject(object, () => 'assets/x').action } catch { action = 'invalid' }
        if (action !== 'upsert') expect(local).toBeUndefined()
        else expect(local).toMatchObject({ rel_path: path, page: object.page, kind: object.kind, deleted_at: null, updated_at: new Date(object.t).toISOString() })
      }
    }
  }
}

describe.each(NAMES)('fixture %s', name => {
  test('applies to a fresh profile, quietly and only once', async () => {
    const root = loadRoot(name), { pull, folder } = profile()
    const expected = JSON.parse(readFileSync(join(FIXTURES, name, 'expected.json'), 'utf8')) as Expected
    const result = await pull(snapshot(root))
    if (expected.blocked !== null) {
      expect(result).toEqual({ status: 'blocked', blocked: expected.blocked })
      expect(row('SELECT COUNT(*) AS n FROM courses')!.n).toBe(0)
      return
    }
    expect(result.status).toBe('applied')
    expectProfile(expected, root, folder)
    expect(outbox()).toEqual([])
    const before = dump()
    expect(await pull(snapshot(root))).toMatchObject({ status: 'applied', changed: [] })
    expect(dump()).toEqual(before)
  })
})

test('a local edit waiting for export is kept; untouched fields still take the remote change', async () => {
  const { pull, courses, folder } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  courses.rename({ courseId: COURSE, name: '선형대수 (내 이름)' })
  const note = join(folder(COURSE), '요약.md')
  writeFileSync(note, '# 요약\n\n여기서 고친 내용\n')
  expect(outbox()).toEqual([{ kind: 'course', id: COURSE }])

  const body = Buffer.from('# 요약\n\n다른 기기에서 고친 내용\n')
  const later = withLog(new Map([...root, [`notes/${NOTE_DOC}/${PHONE}-00000002.md`, body]]), 1, [
    { t: 1793400000000, op: 'course.upsert', id: COURSE, fields: { name: '선형대수 (원격)', color: 'green' } },
    { t: 1793400000001, op: 'doc.upsert', id: NOTE_DOC, fields: { md_hash: sha(body), md_base: '2644a7f618bea8112420f70848e4796a79d8cad194f211e698dacaf7a0472661' } }
  ])
  expect(await pull(snapshot(later))).toMatchObject({ status: 'applied', changed: [COURSE] })
  expect(row('SELECT name, color FROM courses WHERE id = ?', COURSE)).toEqual({ name: '선형대수 (내 이름)', color: 'green' })
  expect(readFileSync(note, 'utf8')).toBe('# 요약\n\n여기서 고친 내용\n')
})

test('a remote note edit replaces an untouched local note', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const body = Buffer.from('# 요약\n\n![](../../assets/6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0.png)\n')
  await pull(snapshot(withLog(new Map([...root, [`notes/${NOTE_DOC}/${PHONE}-00000002.md`, body]]), 1, [
    { t: 1793400000000, op: 'doc.upsert', id: NOTE_DOC, fields: { md_hash: sha(body), md_base: '2644a7f618bea8112420f70848e4796a79d8cad194f211e698dacaf7a0472661' } }
  ])))
  expect(readFileSync(join(folder(COURSE), '요약.md'), 'utf8')).toBe('# 요약\n\n![](assets/6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0.png)\n')
  expect(existsSync(join(folder(COURSE), 'assets/6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0.png'))).toBe(true)
  expect(outbox()).toEqual([])
})

test('a remote move takes the file and its drawings along through the materials journal', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const drawings = ctx.db.prepare('SELECT id FROM pdf_drawings WHERE rel_path = ? ORDER BY id').all('강의자료/1주차 벡터.pdf')
  expect(drawings.length).toBeGreaterThan(0)
  await pull(snapshot(withLog(root, 1, [{ t: 1793400000000, op: 'doc.upsert', id: PDF_DOC, fields: { rel_path: '보관/1학기', name: '벡터.pdf' } }])))
  expect(existsSync(join(folder(COURSE), '보관/1학기/벡터.pdf'))).toBe(true)
  expect(existsSync(join(folder(COURSE), '강의자료/1주차 벡터.pdf'))).toBe(false)
  expect(row('SELECT local_path FROM sync_docs WHERE document_id = ?', PDF_DOC)!.local_path).toBe('보관/1학기/벡터.pdf')
  expect(ctx.db.prepare('SELECT id FROM pdf_drawings WHERE rel_path = ? ORDER BY id').all('보관/1학기/벡터.pdf')).toEqual(drawings)
})

test('a remote delete moves an untouched file to the trash; a file edited here stays', async () => {
  const { pull, folder, trash } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  writeFileSync(join(folder(COURSE), '요약.md'), '고친 내용')
  const deleted = withLog(root, 1, [
    { t: 1793400000000, op: 'doc.delete', id: PDF_DOC },
    { t: 1793400000001, op: 'doc.delete', id: NOTE_DOC }
  ])
  await pull(snapshot(deleted))
  expect(readdirSync(trash)).toEqual(['1주차 벡터.pdf'])
  expect(row('SELECT * FROM sync_docs WHERE document_id = ?', PDF_DOC)).toBeUndefined()
  expect(readFileSync(join(folder(COURSE), '요약.md'), 'utf8')).toBe('고친 내용')
  expect(row('SELECT * FROM sync_docs WHERE document_id = ?', NOTE_DOC)).toBeDefined()
})

test('a deleted course stays while it holds a live document and goes with the last one (P8)', async () => {
  const { pull } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const deleted = withLog(root, 1, [{ t: 1793400000000, op: 'course.delete', id: COURSE }])
  await pull(snapshot(deleted))
  expect(row('SELECT deleted_at FROM courses WHERE id = ?', COURSE)!.deleted_at).toBeNull()
  await pull(snapshot(withLog(deleted, 2, [
    { t: 1793400000001, op: 'doc.delete', id: PDF_DOC },
    { t: 1793400000002, op: 'doc.delete', id: NOTE_DOC }
  ])))
  expect(row('SELECT deleted_at FROM courses WHERE id = ?', COURSE)!.deleted_at).not.toBeNull()
})

test('a new device still creates a deleted course while it holds live documents (P8)', async () => {
  const { pull, folder } = profile()
  const root = withLog(loadRoot('01-basic'), 1, [{ t: T, op: 'course.delete', id: COURSE }])
  expect(await pull(snapshot(root))).toMatchObject({ status: 'applied', held: [] })
  expect(row('SELECT deleted_at FROM courses WHERE id = ?', COURSE)!.deleted_at).toBeNull()
  expect(existsSync(join(folder(COURSE), '요약.md'))).toBe(true)
})

test('a root that lost files never rolls back what was already applied', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('01-basic')
  const body = Buffer.from('# 요약 v2\n')
  const later = withLog(new Map([...root, [`notes/${NOTE_DOC}/${PHONE}-00000002.md`, body]]), 1, [
    { t: 1793400000000, op: 'course.upsert', id: COURSE, fields: { name: '선형대수 v2' } },
    { t: 1793400000001, op: 'doc.upsert', id: NOTE_DOC, fields: { md_hash: sha(body), md_base: '2644a7f618bea8112420f70848e4796a79d8cad194f211e698dacaf7a0472661' } }
  ])
  await pull(snapshot(later))
  expect(await pull(snapshot(root))).toMatchObject({ status: 'applied', changed: [] })
  expect(row('SELECT name FROM courses WHERE id = ?', COURSE)!.name).toBe('선형대수 v2')
  expect(readFileSync(join(folder(COURSE), '요약.md'), 'utf8')).toBe('# 요약 v2\n')
})

test('nothing is applied while a root file cannot be read yet', async () => {
  const { pull } = profile()
  const root = loadRoot('01-basic'), log = 'log/aaaaaaaa-0000-4000-8000-000000000001/00000001.json'
  expect(await pull(snapshot(root, { offline: new Set([log]) }))).toEqual({ status: 'incomplete', pending: [log] })
  expect(row('SELECT COUNT(*) AS n FROM courses')!.n).toBe(0)
  const placeholder = new Map([...root].filter(([path]) => path !== log))
  placeholder.set('log/aaaaaaaa-0000-4000-8000-000000000001/.00000001.json.icloud', new Uint8Array())
  expect(await pull(snapshot(placeholder))).toEqual({ status: 'incomplete', pending: [log] })
  expect(await pull(snapshot(root))).toMatchObject({ status: 'applied', changed: [COURSE] })
})

test('a different file already at the path stays, and the document arrives under a free name', async () => {
  const { pull, courses } = profile()
  const root = loadRoot('01-basic')
  courses.create({ name: '선형대수학', color: 'blue' }, { id: COURSE })
  const folder = courses.getFolder(COURSE)
  writeFileSync(join(folder, '요약.md'), '이 기기의 다른 요약')
  await pull(snapshot(root))
  expect(readFileSync(join(folder, '요약.md'), 'utf8')).toBe('이 기기의 다른 요약')
  expect(row('SELECT local_path FROM sync_docs WHERE document_id = ?', NOTE_DOC)!.local_path).toBe('요약 (2).md')
  expect(readFileSync(join(folder, '요약 (2).md'), 'utf8')).toContain('벡터 공간')
})

test('spec names become names the app accepts and its scans track', () => {
  expect(localPath('강의: 1/a. ', 'CON.pdf', 'pdf', 'win32')).toBe('강의： 1/a/_CON.pdf')
  expect(localPath('', 'what?.md', 'md', 'win32')).toBe('what？.md')
  expect(localPath('', 'COM¹.pdf', 'pdf', 'win32')).toBe('_COM¹.pdf')
  expect(localPath('강의: 1', 'CON.pdf', 'pdf', 'darwin')).toBe('강의： 1/CON.pdf')
  expect(localPath('.비공개', '  요약 ', 'md', 'darwin')).toBe('비공개/요약.md')
  expect(localPath('', '1주차', 'pdf', 'darwin')).toBe('1주차.pdf')
  const long = localPath('', `${'가'.repeat(200)}.pdf`, 'pdf', 'darwin')
  expect([long.length, long.endsWith('.pdf')]).toEqual([120, true])
})

test('a note edited while the remote bytes are read is not overwritten', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const note = join(folder(COURSE), '요약.md'), body = Buffer.from('# 요약\n\n다른 기기에서 고친 내용\n')
  const file = `notes/${NOTE_DOC}/${PHONE}-00000002.md`
  const later = withLog(new Map([...root, [file, body]]), 1, [{ t: T, op: 'doc.upsert', id: NOTE_DOC, fields: { md_hash: sha(body), md_base: NOTE_V0 } }])
  let reads = 0
  // The listing reads the note first; the second read is apply's, and the user types during it.
  await pull(snapshot(later, { onRead: path => { if (path === file && ++reads === 2) writeFileSync(note, '방금 쓴 문장') } }))
  expect(readFileSync(note, 'utf8')).toBe('방금 쓴 문장')
})

test('a document moved into another course arrives there with its drawings before the old file goes', async () => {
  const { pull, folder, trash } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  ctx.db.prepare(`INSERT INTO pdf_drawings (id, course_id, rel_path, page, kind, data_json, style_json, created_at, updated_at)
    VALUES ('e0000000-0000-4000-8000-0000000000ff', ?, '강의자료/1주차 벡터.pdf', 1, 'ink', '{}', '{}', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z')`).run(COURSE)
  const drawings = ctx.db.prepare('SELECT id FROM pdf_drawings ORDER BY id').all()
  const moved = withLog(root, 1, [
    { t: T, op: 'course.upsert', id: COURSE2, fields: { name: '다른 과목', sort: 1, color: 'green', archived: false } },
    { t: T + 1, op: 'doc.upsert', id: PDF_DOC, fields: { course_id: COURSE2 } }
  ])
  const pdf = [...root.keys()].find(path => path.startsWith('pdf/'))!
  await pull(snapshot(moved, { offline: new Set([pdf]) }))
  expect(existsSync(join(folder(COURSE), '강의자료/1주차 벡터.pdf'))).toBe(true)
  expect(row('SELECT course_id FROM sync_docs WHERE document_id = ?', PDF_DOC)!.course_id).toBe(COURSE)
  await pull(snapshot(moved))
  expect(existsSync(join(folder(COURSE2), '강의자료/1주차 벡터.pdf'))).toBe(true)
  expect(readdirSync(trash)).toEqual(['1주차 벡터.pdf'])
  expect(row('SELECT course_id, local_path FROM sync_docs WHERE document_id = ?', PDF_DOC)).toEqual({ course_id: COURSE2, local_path: '강의자료/1주차 벡터.pdf' })
  expect(ctx.db.prepare('SELECT id FROM pdf_drawings WHERE course_id = ? AND rel_path = ? ORDER BY id').all(COURSE2, '강의자료/1주차 벡터.pdf')).toEqual(drawings)
})

test('a file deleted here stays deleted on the next pull; its export comes first', async () => {
  const { pull, folder, scanCourse } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  rmSync(join(folder(COURSE), '요약.md'))
  await scanCourse(COURSE, 0)
  await scanCourse(COURSE, MISSING_GRACE_MS)
  expect(row('SELECT * FROM sync_docs WHERE document_id = ?', NOTE_DOC)).toBeUndefined()
  expect(await pull(snapshot(root))).toMatchObject({ status: 'applied', changed: [] })
  expect(existsSync(join(folder(COURSE), '요약.md'))).toBe(false)
})

test('documents arrive under names the app accepts, and scans keep tracking them', async () => {
  const { pull, scanCourse } = profile()
  const root = withLog(loadRoot('01-basic'), 1, [
    { t: T, op: 'doc.upsert', id: PDF_DOC, fields: { rel_path: '.숨김/Week 1: Intro', name: '벡터' } },
    { t: T + 1, op: 'doc.upsert', id: NOTE_DOC, fields: { name: '요약.txt' } }
  ])
  await pull(snapshot(root))
  const paths = () => ctx.db.prepare('SELECT local_path FROM sync_docs ORDER BY local_path').all()
  expect(paths()).toEqual([{ local_path: '숨김/Week 1： Intro/벡터.pdf' }, { local_path: '요약.txt.md' }])
  await scanCourse(COURSE, 0)
  await scanCourse(COURSE, MISSING_GRACE_MS)
  expect(paths()).toEqual([{ local_path: '숨김/Week 1： Intro/벡터.pdf' }, { local_path: '요약.txt.md' }])
  expect(await pull(snapshot(root))).toMatchObject({ changed: [] })
})

test('a course renamed and then deleted elsewhere goes, under its new name', async () => {
  const { pull } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const result = await pull(snapshot(withLog(root, 1, [
    { t: T, op: 'course.upsert', id: COURSE, fields: { name: '지난 학기' } },
    { t: T + 1, op: 'doc.delete', id: PDF_DOC },
    { t: T + 2, op: 'doc.delete', id: NOTE_DOC },
    { t: T + 3, op: 'course.delete', id: COURSE }
  ])))
  expect(result).toMatchObject({ removed: [COURSE], held: [] })
  expect(row('SELECT name, deleted_at IS NOT NULL AS gone FROM courses WHERE id = ?', COURSE)).toEqual({ name: '지난 학기', gone: 1 })
})

test('a course deleted elsewhere stays while a note edited here still holds it', async () => {
  const { pull, folder, trash } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  writeFileSync(join(folder(COURSE), '요약.md'), '여기서 고친 요약')
  await pull(snapshot(withLog(root, 1, [
    { t: T, op: 'doc.delete', id: PDF_DOC },
    { t: T + 1, op: 'doc.delete', id: NOTE_DOC },
    { t: T + 2, op: 'course.delete', id: COURSE }
  ])))
  expect(row('SELECT deleted_at FROM courses WHERE id = ?', COURSE)!.deleted_at).toBeNull()
  expect(readdirSync(trash)).toEqual(['1주차 벡터.pdf'])
  expect(readFileSync(join(folder(COURSE), '요약.md'), 'utf8')).toBe('여기서 고친 요약')
})

test('a remote move whose new name is taken here lands once the name is free', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('01-basic')
  await pull(snapshot(root))
  const blocker = join(folder(COURSE), '보관', 'Week 1： Intro.pdf')
  mkdirSync(join(folder(COURSE), '보관'), { recursive: true })
  writeFileSync(blocker, '다른 파일')
  const moved = withLog(root, 1, [{ t: T, op: 'doc.upsert', id: PDF_DOC, fields: { rel_path: '보관', name: 'Week 1: Intro.pdf' } }])
  const at = () => row('SELECT local_path FROM sync_docs WHERE document_id = ?', PDF_DOC)!.local_path
  await pull(snapshot(moved))
  expect(at()).toBe('보관/1주차 벡터.pdf')
  // The folder part landed and is settled on its own, so an export will not report it as a move made here.
  expect(row("SELECT value_json FROM sync_meta WHERE entity_id = ? AND field = 'rel_path'", PDF_DOC)!.value_json).toBe('"보관"')
  rmSync(blocker)
  await pull(snapshot(moved))
  expect(at()).toBe('보관/Week 1： Intro.pdf')
  expect(readFileSync(join(folder(COURSE), at())).length).toBeGreaterThan(100)
})

test('a folder that differs only in case is the same folder, and later moves still apply', async () => {
  const { pull, courses, folder, scanCourse } = profile()
  courses.create({ name: '선형대수학', color: 'blue' }, { id: COURSE })
  mkdirSync(join(folder(COURSE), 'lecture'))
  const lecture = withLog(loadRoot('01-basic'), 1, [{ t: T, op: 'doc.upsert', id: PDF_DOC, fields: { rel_path: 'Lecture' } }])
  await pull(snapshot(lecture))
  await scanCourse(COURSE, 0)
  await pull(snapshot(withLog(lecture, 2, [{ t: T + 1, op: 'doc.upsert', id: PDF_DOC, fields: { rel_path: 'Week2' } }])))
  expect(row('SELECT local_path FROM sync_docs WHERE document_id = ?', PDF_DOC)!.local_path).toBe('Week2/1주차 벡터.pdf')
  expect(existsSync(join(folder(COURSE), 'Week2/1주차 벡터.pdf'))).toBe(true)
})

test('a conflict copy stays when the root stops computing it or another device renames it', async () => {
  const { pull, folder } = profile()
  const root = loadRoot('04-note-both-edited')
  await pull(snapshot(root))
  const copy = join(folder(COURSE), '노트', '질문 목록 (충돌 사본 MacBook Air).md')
  expect(existsSync(copy)).toBe(true)
  await pull(snapshot(new Map([...root].filter(([path]) => path !== 'log/aaaaaaaa-0000-4000-8000-000000000001/00000004.json'))))
  expect(existsSync(copy)).toBe(true)
  await pull(snapshot(withLog(root, 1, [{ t: T, op: 'doc.upsert', id: '55eb6b28-2ebf-5339-bedb-0aaf48d3b037', fields: { name: '질문 정리.md' } }])))
  expect(existsSync(copy)).toBe(true)
})

test('a provider whose read is a method keeps its this', async () => {
  class Provider implements RootSnapshot {
    readonly entries: RootSnapshot['entries']
    constructor(private readonly files: Root) { this.entries = snapshot(files).entries }
    async read(path: string): Promise<Uint8Array> { return this.files.get(path)! }
  }
  const { pull, folder } = profile()
  expect(await pull(new Provider(loadRoot('01-basic')))).toMatchObject({ status: 'applied', held: [] })
  expect(existsSync(join(folder(COURSE), '강의자료/1주차 벡터.pdf'))).toBe(true)
})
