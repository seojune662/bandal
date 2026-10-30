import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { v5 as uuidv5 } from 'uuid'
import { describe, expect, test } from 'vitest'
import { MAX_STAMP, readRoot, type InkObject, type MetaEvent, type ParsedFile, type RemoteFile } from '../../../src/main/features/sync/format'
import { CONFLICT_COPY_NAMESPACE, isAlive, merge } from '../../../src/main/features/sync/merge'

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', C = 'cccccccc-0000-4000-8000-000000000003'
const COURSE = 'c0000000-0000-4000-8000-000000000001'
const PDF = '1'.repeat(64)
const H = (digit: string): string => digit.repeat(64)

const root: ParsedFile = { kind: 'root', path: 'bandal.json', format: 2 }
const devices: ParsedFile[] = [[A, 'MacBook Air'], [B, 'iPad Pro'], [C, 'iPad mini']]
  .map(([device, name]) => ({ kind: 'device', path: `devices/${device}.json`, device, name }))
const event = (t: number, op: string, id: string, fields: Record<string, unknown> = {}): MetaEvent => ({ t, op, id, fields })
const log = (author: string, seq: number, events: MetaEvent[]): ParsedFile =>
  ({ kind: 'log', path: `log/${author}/${String(seq).padStart(8, '0')}.json`, author, seq, events, dropped: 0 })
const note = (author: string, seq: number, doc: string, hash: string): ParsedFile =>
  ({ kind: 'note', path: `notes/${doc}/${author}-${String(seq).padStart(8, '0')}.md`, author, seq, doc, hash, assets: [] })
const ink = (author: string, seq: number, doc: string, objects: InkObject[]): ParsedFile =>
  ({ kind: 'ink', path: `ink/${doc}/1/${author}-${String(seq).padStart(8, '0')}.json.gz`, author, seq, doc, objects, dropped: 0 })
const logFile = (author: string, seq: number, events: unknown[]): RemoteFile =>
  ({ path: `log/${author}/${String(seq).padStart(8, '0')}.json`, bytes: Buffer.from(JSON.stringify(events)) })
const rootFile: RemoteFile = { path: 'bandal.json', bytes: Buffer.from('{"format":2}') }
const course = log(A, 1, [event(1, 'course.upsert', COURSE, { name: '물리', sort: 0, color: 'blue', archived: false })])
const docId = (n: number): string => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const mdDoc = (doc: string, t: number, hash: string, fields: Record<string, unknown> = {}): MetaEvent =>
  event(t, 'doc.upsert', doc, { course_id: COURSE, type: 'md', name: '노트.md', rel_path: '', md_hash: hash, md_base: null, ...fields })
const stroke = (n: number, t: number): InkObject => ({
  id: `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, kind: 'ink', page: 1, t, created: t,
  data: { inkVersion: 5, points: [{ x: 0.1, y: 0.1, p: 0.5 }] }, style: { color: 'ink', width: 0.003, opacity: 1 }
})

describe('notes', () => {
  test('three devices editing at once leave one body and two copies (M12)', () => {
    const doc = docId(1)
    const state = merge([root, ...devices, course,
      log(A, 2, [mdDoc(doc, 10, H('0')), mdDoc(doc, 20, H('a'), { md_base: H('0') })]),
      log(B, 1, [event(21, 'doc.upsert', doc, { md_hash: H('b'), md_base: H('0') })]),
      log(C, 1, [event(22, 'doc.upsert', doc, { md_hash: H('c'), md_base: H('0') })]),
      note(A, 3, doc, H('0')), note(A, 4, doc, H('a')), note(B, 2, doc, H('b')), note(C, 2, doc, H('c'))])
    expect(state.notes.get(doc)).toEqual({ hash: H('c'), file: `notes/${doc}/${C}-00000002.md` })
    expect(state.conflictCopies.map(copy => [copy.name, copy.md_hash, copy.id])).toEqual([
      ['노트 (충돌 사본 MacBook Air).md', H('a'), uuidv5(`${doc}:${H('a')}`, CONFLICT_COPY_NAMESPACE)],
      ['노트 (충돌 사본 iPad Pro).md', H('b'), uuidv5(`${doc}:${H('b')}`, CONFLICT_COPY_NAMESPACE)]
    ].sort((x, y) => (x[2] < y[2] ? -1 : 1)))
  })

  test('two devices saving the same text is not a conflict (M13)', () => {
    const doc = docId(1)
    const state = merge([root, course,
      log(A, 2, [mdDoc(doc, 10, H('0')), mdDoc(doc, 20, H('a'), { md_base: H('0') })]),
      log(B, 1, [event(21, 'doc.upsert', doc, { md_hash: H('a'), md_base: H('0') })]),
      note(A, 3, doc, H('a'))])
    expect(state.conflictCopies).toEqual([])
    expect(state.notes.get(doc)).toEqual({ hash: H('a'), file: `notes/${doc}/${A}-00000003.md` })
  })

  test('a device name cannot put a folder separator into the copy name', () => {
    const doc = docId(1)
    const state = merge([root, course, { kind: 'device', path: `devices/${B}.json`, device: B, name: 'Kim/iPad\\2' },
      log(A, 2, [mdDoc(doc, 10, H('0')), mdDoc(doc, 30, H('a'), { md_base: H('0') })]),
      log(B, 1, [event(21, 'doc.upsert', doc, { md_hash: H('b'), md_base: H('0') })]), note(B, 2, doc, H('b'))])
    expect(state.conflictCopies.map(copy => copy.name)).toEqual(['노트 (충돌 사본 Kim_iPad\\2).md'])
  })

  test('a copy whose id already exists as a document is not made again', () => {
    const doc = docId(1), copyId = uuidv5(`${doc}:${H('a')}`, CONFLICT_COPY_NAMESPACE)
    const state = merge([root, course,
      log(A, 2, [mdDoc(doc, 10, H('0')), mdDoc(doc, 20, H('a'), { md_base: H('0') }), event(30, 'doc.delete', copyId)]),
      log(B, 1, [event(21, 'doc.upsert', doc, { md_hash: H('b'), md_base: H('0') })])])
    expect(state.conflictCopies).toEqual([])
  })
})

test('offline strokes from two devices on one page all survive (M16)', () => {
  const doc = docId(1)
  const state = merge([root, course, log(A, 2, [event(2, 'doc.upsert', doc, { course_id: COURSE, type: 'pdf', name: 'a.pdf', rel_path: '', pdf_sha256: PDF })]),
    ink(A, 3, doc, Array.from({ length: 50 }, (_, n) => stroke(n, 100 + n))),
    ink(B, 1, doc, Array.from({ length: 50 }, (_, n) => stroke(1000 + n, 100 + n)))])
  expect(state.ink.size).toBe(100)
})

test('content that has not arrived keeps documents and drawings waiting (M17)', () => {
  const pdfDoc = docId(1), mdDocId = docId(2)
  const image: InkObject = { ...stroke(1, 5), kind: 'image', data: { box: { x: 0, y: 0, width: 0.5, height: 0.5 }, image: { sha256: H('9'), ext: 'png', label: 'a.png' } } }
  const files: ParsedFile[] = [root, course,
    log(A, 2, [event(2, 'doc.upsert', pdfDoc, { course_id: COURSE, type: 'pdf', name: 'a.pdf', rel_path: '', pdf_sha256: PDF }), mdDoc(mdDocId, 3, H('a'))]),
    ink(A, 3, pdfDoc, [image]), ink(A, 4, docId(9), [stroke(2, 6)])]
  const waiting = merge(files)
  expect(waiting.waiting).toEqual({ docs: [pdfDoc, mdDocId], ink: [image.id, stroke(2, 6).id].sort(), copies: [] })
  expect(waiting.notes.get(mdDocId)).toEqual({ hash: H('a'), file: null })
  const arrived = merge([...files, { kind: 'pdf', path: `pdf/${PDF}.pdf`, hash: PDF }, note(A, 5, mdDocId, H('a')),
    { kind: 'asset', path: `assets/${H('9')}.png`, hash: H('9') }])
  expect(arrived.waiting).toEqual({ docs: [], ink: [stroke(2, 6).id], copies: [] })
})

test('an unreadable file is skipped whole, a bad item only on its own, and the rest still merges (M18)', () => {
  const doc = docId(1)
  const { parsed, errors } = readRoot([
    { path: 'bandal.json', bytes: Buffer.from('{"format":2}') },
    logFile(A, 1, [event(1, 'course.upsert', COURSE, { name: '물리' })]),
    { path: `log/${B}/00000001.json`, bytes: Buffer.from('[{"t":1,') },
    { path: `ink/${doc}/1/${B}-00000002.json.gz`, bytes: Buffer.from('not gzip') },
    { path: `ink/${doc}/1/${B}-00000003.json.gz`, bytes: gzipSync(Buffer.from(JSON.stringify([{ id: 'x' }, stroke(1, 5)]))) },
    { path: `log/${B}/00000004.json`, bytes: Buffer.from('[{"t":1e999,"op":"course.delete","id":"' + COURSE + '"}]') }
  ])
  expect(errors).toEqual([`ink/${doc}/1/${B}-00000002.json.gz`, `log/${B}/00000001.json`, `log/${B}/00000004.json`])
  expect(parsed.find(file => file.kind === 'ink')).toMatchObject({ objects: [stroke(1, 5)], dropped: 1 })
  expect(isAlive(merge(parsed).courses.get(COURSE))).toBe(true)
})

test('a conflict copy waits for its text and for its writer\'s device file', () => {
  const doc = docId(1), copy = uuidv5(`${doc}:${H('b')}`, CONFLICT_COPY_NAMESPACE)
  const files: ParsedFile[] = [root, course, note(A, 3, doc, H('a')),
    log(A, 2, [mdDoc(doc, 10, H('0')), mdDoc(doc, 30, H('a'), { md_base: H('0') })]),
    log(B, 1, [event(21, 'doc.upsert', doc, { md_hash: H('b'), md_base: H('0') })])]
  expect(merge(files)).toMatchObject({ conflictCopies: [], waiting: { copies: [copy] } })
  expect(merge([...files, note(B, 2, doc, H('b'))])).toMatchObject({ conflictCopies: [], waiting: { copies: [copy] } })
  expect(merge([...files, note(B, 2, doc, H('b')), devices[1]!])).toMatchObject({
    conflictCopies: [{ id: copy, name: '노트 (충돌 사본 iPad Pro).md', file: `notes/${doc}/${B}-00000002.md` }], waiting: { copies: [] }
  })
})

test('without a format-2 bandal.json nothing else is read', () => {
  const courseLog = logFile(A, 1, [event(1, 'course.upsert', COURSE, { name: '물리' })])
  expect(readRoot([courseLog, { path: `log/${B}/00000001.json`, bytes: Buffer.from('[') }])).toEqual({ parsed: [], ignored: [], errors: [], pending: [] })
  expect(readRoot([courseLog, { path: '.bandal.json.icloud', bytes: Buffer.alloc(0) }]).pending).toEqual(['bandal.json'])
  expect(readRoot([{ path: 'bandal.json', bytes: Buffer.from('{"format":3}') }, courseLog]).parsed).toEqual([{ kind: 'root', path: 'bandal.json', format: 3 }])
})

test('only format 2 is read (M19)', () => {
  expect(merge([course]).blocked).toBe('missing-root')
  expect(merge([{ ...root, format: 3 } as ParsedFile, course])).toMatchObject({ blocked: 'update-required', courses: new Map() })
  expect(merge([{ ...root, format: 1 } as ParsedFile, course]).blocked).toBe('unsupported-format')
})

test('unknown ops are ignored and unknown fields are kept (M20)', () => {
  const { parsed, errors } = readRoot([rootFile, { path: `log/${A}/00000001.json`, bytes: Buffer.from(JSON.stringify([
    { t: 1, op: 'pages.remap', id: 'not-a-uuid', fields: { pages: [2, 1] } },
    event(2, 'course.upsert', COURSE, { name: '물리', ribbon: { tone: 'gold' } })
  ])) }])
  expect(errors).toEqual([])
  const state = merge([root, ...parsed])
  expect([...state.courses.keys()]).toEqual([COURSE])
  expect(state.courses.get(COURSE)!.fields.get('ribbon')!.value).toEqual({ tone: 'gold' })
})

test('a remote path that could leave the course folder drops only its event', () => {
  const doc = docId(1), bad = [{ rel_path: '../밖' }, { name: 'a/b.pdf' }, { name: '..' }, { rel_path: '/abs' }, { rel_path: 'a//b' }, { name: 'a\u0007.pdf' }, { name: 'a\u0085.pdf' }]
  const { parsed, errors } = readRoot([rootFile, logFile(A, 1, [...bad.map(fields => event(1, 'doc.upsert', doc, fields)),
    event(2, 'doc.upsert', docId(2), { rel_path: '1주차/실습', name: 'Q1\\Q2.pdf' })])])
  expect(errors).toEqual([])
  expect(parsed[1]).toMatchObject({ dropped: bad.length, events: [{ id: docId(2), fields: { name: 'Q1\\Q2.pdf' } }] })
})

test('stamps from 2100 on are dropped so no clock can overflow', () => {
  const { parsed } = readRoot([rootFile, logFile(A, 1, [event(MAX_STAMP, 'course.upsert', COURSE, { name: '미래' }), event(MAX_STAMP - 1, 'course.upsert', COURSE, { name: '물리' })])])
  expect(parsed[1]).toMatchObject({ dropped: 1, events: [{ t: MAX_STAMP - 1 }] })
})

test('an image object must name its asset by sha256 and ext', () => {
  const doc = docId(1), image = (ref: Record<string, unknown>): InkObject =>
    ({ ...stroke(1, 5), kind: 'image', data: { box: { x: 0, y: 0, width: 0.5, height: 0.5 }, image: { label: 'a.png', ...ref } } })
  const { parsed } = readRoot([rootFile, { path: `ink/${doc}/1/${A}-00000001.json.gz`, bytes: gzipSync(Buffer.from(JSON.stringify([
    image({ sha256: '../../x', ext: 'png' }), image({ sha256: H('9'), ext: '/../etc' }), image({ sha256: H('9'), ext: 'png' })
  ]))) }])
  expect(parsed[1]).toMatchObject({ dropped: 2, objects: [{ data: { image: { sha256: H('9') } } }] })
})

test('iCloud placeholders wait for download instead of being ignored', () => {
  const doc = docId(1)
  expect(readRoot([rootFile,
    { path: `log/${A}/.00000001.json.icloud`, bytes: Buffer.alloc(0) },
    { path: `notes/${doc}/.${A}-00000002.md.icloud`, bytes: Buffer.alloc(0) },
    { path: '.cache.txt.icloud', bytes: Buffer.alloc(0) }
  ])).toMatchObject({ pending: [`log/${A}/00000001.json`, `notes/${doc}/${A}-00000002.md`], ignored: ['.cache.txt.icloud'] })
})

test('a note waits until the assets its snapshot links to arrive', () => {
  const doc = docId(1), body = Buffer.from(`![칠판](../../assets/${H('9')}.png)\n`)
  const files: RemoteFile[] = [{ path: 'bandal.json', bytes: Buffer.from('{"format":2}') },
    logFile(A, 1, [event(1, 'course.upsert', COURSE, { name: '물리' }), mdDoc(doc, 2, createHash('sha256').update(body).digest('hex'))]),
    { path: `notes/${doc}/${A}-00000002.md`, bytes: body }]
  expect(merge(readRoot(files).parsed).waiting.docs).toEqual([doc])
  const png = Buffer.from('png')
  const withAsset = [...files, { path: `assets/${createHash('sha256').update(png).digest('hex')}.png`, bytes: png }]
  expect(merge(readRoot(withAsset).parsed).waiting.docs).toEqual([doc])
  const linked = Buffer.from(`![칠판](../../assets/${createHash('sha256').update(png).digest('hex')}.png)\n`)
  const ready = [files[0]!, logFile(A, 1, [event(1, 'course.upsert', COURSE, { name: '물리' }), mdDoc(doc, 2, createHash('sha256').update(linked).digest('hex'))]),
    { path: `notes/${doc}/${A}-00000002.md`, bytes: linked }, withAsset[3]!]
  expect(merge(readRoot(ready).parsed).waiting.docs).toEqual([])
})

test('names outside the spec patterns are ignored, including upper-case ids', () => {
  const { ignored } = readRoot([rootFile,
    { path: `devices/${A.toUpperCase()}.json`, bytes: Buffer.from('{"name":"x"}') },
    { path: `notes/${docId(1)}/${A}-1.md`, bytes: Buffer.from('x') },
    { path: `ink/${docId(1)}/0/${A}-00000001.json.gz`, bytes: gzipSync(Buffer.from('[]')) }
  ])
  expect(ignored).toHaveLength(3)
})

test('documents that collide on one path are renamed the same way everywhere', () => {
  const first = 'd1000000-0000-4000-8000-000000000001', second = 'e2000000-0000-4000-8000-000000000002'
  const upsert = (id: string, t: number): MetaEvent => event(t, 'doc.upsert', id, { course_id: COURSE, type: 'pdf', name: '1주차.pdf', rel_path: '강의', pdf_sha256: PDF })
  const state = merge([root, course, log(A, 2, [upsert(second, 5)]), log(B, 1, [upsert(first, 9)])])
  expect(state.renames).toEqual([{ id: second, name: '1주차 (e200).pdf' }])
  expect(merge([root, course, log(A, 2, [upsert(second, 5), event(6, 'doc.delete', second)]), log(B, 1, [upsert(first, 9)])]).renames).toEqual([])
})

test('documents whose creating event has not arrived take part in no naming rule', () => {
  const first = docId(1), second = docId(2)
  const state = merge([root, course,
    log(A, 2, [event(10, 'doc.upsert', first, { md_hash: H('a'), md_base: H('0') }), event(11, 'doc.upsert', second, { md_hash: H('b'), md_base: H('0') })]),
    log(B, 1, [event(12, 'doc.upsert', first, { md_hash: H('c'), md_base: H('0') })])])
  expect(state.renames).toEqual([])
  expect(state.conflictCopies).toEqual([])
  expect(state.waiting.docs).toEqual([first, second])
})

test('the same drawing filed under two documents resolves the same way in any order', () => {
  const object = stroke(1, 5)
  const one = merge([root, ink(A, 1, docId(1), [object]), ink(A, 2, docId(2), [object])])
  const other = merge([root, ink(A, 2, docId(2), [object]), ink(A, 1, docId(1), [object])])
  expect(one.ink.get(object.id)!.value.doc).toBe(other.ink.get(object.id)!.value.doc)
  expect(one.waiting).toEqual(other.waiting)
})
