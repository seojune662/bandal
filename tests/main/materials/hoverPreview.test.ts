import { mkdtemp, mkdir, rm, writeFile, utimes, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
import { utilityProcess } from 'electron'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { extractMaterialHoverPreview, HOVER_OFFICE_READ_BYTES, HOVER_TEXT_READ_BYTES, readHoverText } from '../../../src/main/features/materials/hoverPreviewExtract'
import { createHoverPreviewExtractor, createMaterialHoverPreviewService, HOVER_PARSE_TIMEOUT_MS } from '../../../src/main/features/materials/hoverPreview'
import { OFFICE_RUNTIME_VERSION } from '../../../src/main/features/presentation/conversionRuntime'
import { viewerKindFor, VIEWABLE_EXTENSIONS } from '../../../src/renderer/src/features/file/fileFormats'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }))

const folder = await mkdtemp(join(tmpdir(), 'bandal-hover-preview-'))
afterAll(async () => { await rm(folder, { recursive: true, force: true }) })
async function fixture(name: string, bytes: string | Uint8Array): Promise<string> {
  const path = join(folder, name)
  await writeFile(path, bytes)
  return path
}
async function zipFixture(name: string, entries: Record<string, string | Uint8Array>): Promise<string> {
  const zip = new JSZip()
  for (const [path, value] of Object.entries(entries)) zip.file(path, value)
  return fixture(name, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}
async function extract(path: string, extension: string) {
  return extractMaterialHoverPreview({ absolutePath: path, extension, userData: folder })
}

describe('bounded material hover extraction', () => {
  test('reads just the prefix of a huge note and preserves complete Unicode characters', async () => {
    const path = await fixture('unicode.md', '가'.repeat(HOVER_TEXT_READ_BYTES))
    const result = await readHoverText(path, true)
    expect(result).toEqual({ kind: 'markdown', text: '가'.repeat(1200), truncated: true })
    const boundary = await fixture('boundary.txt', `${' '.repeat(HOVER_TEXT_READ_BYTES - 1)}가`)
    expect(await readHoverText(boundary, false)).toEqual({ kind: 'text', text: '', truncated: true })
  })

  test('extracts DOCX paragraphs and XML entities without executing embedded content', async () => {
    const path = await zipFixture('doc.docx', {
      'word/document.xml': '<w:document><w:p><w:r><w:t>일정 &amp; 계획</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt; &#x1f31c;</w:t></w:r></w:p></w:document>',
      'word/_rels/document.xml.rels': '<Relationship Target="https://example.test/private-image.png" />'
    })
    expect(await extract(path, '.docx')).toEqual({ kind: 'text', text: '일정 & 계획\n<script>alert(1)</script> 🌜', truncated: false, label: 'Word 본문' })
  })

  test('rejects zip expansion and oversized office input before parsing', async () => {
    const path = await zipFixture('large.docx', { 'word/document.xml': 'a'.repeat(9 * 1024 * 1024) })
    expect(await extract(path, '.docx')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
    const huge = await fixture('huge.xlsx', '')
    await truncate(huge, HOVER_OFFICE_READ_BYTES + 1)
    expect(await extract(huge, '.xlsx')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
  })

  test.each(['xlsx', 'xls'] as const)('reads first %s sheet within row, column, and total text budgets', async bookType => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 10 }, (_, row) => Array.from({ length: 8 }, (_, col) => `${row}:${col}`)))
    sheet['A1'] = { t: 'n', v: 0.25, z: '0%' }
    sheet['B1'] = { t: 'n', v: 4, f: '2+2' }
    XLSX.utils.book_append_sheet(workbook, sheet, '과제 일정')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['다른 시트']]), '성적')
    const result = await extract(await fixture(`table.${bookType}`, XLSX.write(workbook, { type: 'buffer', bookType })), `.${bookType}`)
    expect(result).toMatchObject({ kind: 'table', sheetName: '과제 일정', sheetCount: 2, truncated: true })
    if (result.kind !== 'table') throw new Error('Table expected')
    expect(result.rows).toHaveLength(8)
    expect(result.rows.every(row => row.length === 6)).toBe(true)
    expect(result.rows[0]?.slice(0, 2)).toEqual(['25%', '4'])
    expect(result.rows.flat()).not.toContain('다른 시트')
  })

  test('CSV and TSV keep delimited cell meaning and bounded content', async () => {
    const csv = await fixture('cells.csv', '이름,내용\n"김,서준","줄 하나\n줄 둘"')
    expect(await extract(csv, '.csv')).toMatchObject({ kind: 'table', rows: [['이름', '내용'], ['김,서준', '줄 하나\n줄 둘']] })
    const tsv = await fixture('cells.tsv', '주차\t제목\n1\t역학')
    expect(await extract(tsv, '.tsv')).toMatchObject({ kind: 'table', rows: [['주차', '제목'], ['1', '역학']] })
    const large = await fixture('large.csv', `이름,내용\n자료,"${'가'.repeat(HOVER_TEXT_READ_BYTES)}"`)
    const result = await extract(large, '.csv')
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.truncated).toBe(true)
      expect(result.rows.flat().join('').length).toBeLessThanOrEqual(1200)
    }
  })

  test('uses presentation order rather than slide file numbers; no full slide render', async () => {
    const path = await zipFixture('slides.pptx', {
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId r:id="cover"/><p:sldId r:id="second"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="cover" Target="slides/slide9.xml"/><Relationship Id="second" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide9.xml': '<a:p><a:r><a:t>표지: 운동 법칙</a:t></a:r></a:p>',
      'ppt/slides/slide1.xml': '<a:p><a:r><a:t>두 번째 장</a:t></a:r></a:p>'
    })
    expect(await extract(path, '.pptx')).toEqual({ kind: 'slides', text: '표지: 운동 법칙', slideCount: 2, truncated: false })
  })

  test('legacy PPT only reads the pre-existing converted cache and never creates one', async () => {
    const path = await fixture('legacy.ppt', 'unconverted legacy bytes')
    expect(await extract(path, '.ppt')).toMatchObject({ kind: 'unsupported', reason: 'needs-conversion' })
    const cache = join(folder, 'presentation-runtime', 'cache', OFFICE_RUNTIME_VERSION)
    await mkdir(cache, { recursive: true })
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', '<p:presentation><p:sldId r:id="id1"/></p:presentation>')
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationship Id="id1" Target="slides/slide1.xml"/>')
    zip.file('ppt/slides/slide1.xml', '<a:p><a:t>저장된 변환 결과</a:t></a:p>')
    const hash = createHash('sha256').update('unconverted legacy bytes').digest('hex')
    await writeFile(join(cache, `${hash}.pptx`), await zip.generateAsync({ type: 'nodebuffer' }))
    expect(await extract(path, '.ppt')).toMatchObject({ kind: 'slides', text: '저장된 변환 결과' })
  })

  test('HWPX sections follow numeric order and HWP handles compressed text/passwords', async () => {
    const hwpx = await zipFixture('korean.hwpx', {
      'Contents/section10.xml': '<hp:p><hp:t>나중 내용</hp:t></hp:p>',
      'Contents/section0.xml': '<hp:p><hp:t>처음 내용</hp:t></hp:p>'
    })
    expect(await extract(hwpx, '.hwpx')).toMatchObject({ kind: 'text', text: '처음 내용\n\n나중 내용' })
    const CFB = (XLSX as unknown as { CFB: { utils: { cfb_new(): unknown; cfb_add(container: unknown, name: string, bytes: Uint8Array): void }; write(container: unknown, options: { type: 'buffer' }): Uint8Array } }).CFB
    for (const passworded of [false, true]) {
      const container = CFB.utils.cfb_new()
      const header = Buffer.alloc(256)
      header.write('HWP Document File')
      header.writeUInt32LE(passworded ? 3 : 1, 36)
      const body = Buffer.from('한글 압축 본문', 'utf16le')
      const record = Buffer.alloc(body.length + 4)
      record.writeUInt32LE(67 | (body.length << 20), 0); body.copy(record, 4)
      CFB.utils.cfb_add(container, '/FileHeader', header)
      CFB.utils.cfb_add(container, '/BodyText/Section0', deflateRawSync(record))
      const result = await extract(await fixture(`legacy-${passworded}.hwp`, CFB.write(container, { type: 'buffer' })), '.hwp')
      expect(result).toMatchObject(passworded ? { kind: 'unsupported', reason: 'unreadable' } : { kind: 'text', text: '한글 압축 본문' })
    }
  })

  test('corrupt/missing office data becomes a quiet fallback', async () => {
    expect(await extract(await fixture('bad.docx', 'invalid zip'), '.docx')).toMatchObject({ kind: 'unsupported', reason: 'unreadable' })
    expect(await extract(await zipFixture('missing.pptx', { 'ppt/presentation.xml': '<p:sldId r:id="bad"/>' }), '.pptx')).toMatchObject({ kind: 'unsupported', reason: 'unreadable' })
  })
})

test('utility preview references queue independently and force-stop on timeout; stale responses cannot replace them', async () => {
  vi.useFakeTimers()
  const workers: (EventEmitter & { kill: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> })[] = []
  vi.mocked(utilityProcess.fork).mockImplementation(() => {
    const worker = Object.assign(new EventEmitter(), { kill: vi.fn(), postMessage: vi.fn() })
    workers.push(worker)
    return worker as never
  })
  const extractor = createHoverPreviewExtractor()
  const input = { absolutePath: '/validated/course/report.docx', extension: '.docx', userData: folder }
  try {
    const first = extractor.read(input)
    const second = extractor.read({ ...input, absolutePath: '/validated/course/new.docx' })
    expect(workers).toHaveLength(1)
    expect(workers[0]!.postMessage).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(HOVER_PARSE_TIMEOUT_MS)
    expect(await first).toMatchObject({ kind: 'unsupported', reason: 'timeout' })
    expect(workers[0]!.kill).toHaveBeenCalledOnce()
    workers[0]!.emit('message', { id: 1, content: { kind: 'text', text: 'stale', truncated: false } })
    const fresh = { kind: 'text', text: 'fresh', truncated: false }
    workers[1]!.emit('message', { id: 2, content: fresh })
    expect(await second).toEqual(fresh)
    const third = extractor.read(input)
    const fourth = extractor.read(input)
    workers[1]!.emit('message', { id: 3, content: fresh })
    expect(await third).toEqual(fresh)
    await vi.advanceTimersByTimeAsync(HOVER_PARSE_TIMEOUT_MS)
    expect(await fourth).toMatchObject({ kind: 'unsupported', reason: 'timeout' })
    expect(workers[1]!.kill).toHaveBeenCalledOnce()
  } finally { extractor.dispose(); vi.useRealTimers() }
})

describe('material preview service', () => {
  test('validates paths, returns media hints, and covers every existing text viewer extension', async () => {
    const read = vi.fn(async () => ({ kind: 'text' as const, text: 'office', truncated: false }))
    const guard = vi.fn(async (_courseId: string, relPath: string) => {
      if (relPath.includes('..')) throw new Error('Outside course')
      return join(folder, relPath)
    })
    const service = createMaterialHoverPreviewService({ materials: { absolutePathForAsync: guard }, userData: folder, extractor: { read, dispose: vi.fn() } })
    await expect(service.read({ courseId: 'course', relPath: '../private.md' })).rejects.toThrow('Outside course')
    for (const [extension, kind] of [['pdf', 'pdf'], ['mp4', 'video'], ['wav', 'recording']]) {
      await fixture(`media.${extension}`, '')
      expect(await service.read({ courseId: 'course', relPath: `media.${extension}` })).toMatchObject({ content: { kind } })
    }
    for (const extension of VIEWABLE_EXTENSIONS) {
      if (viewerKindFor(`source${extension}`) !== 'text') continue
      await fixture(`source${extension}`, '본문')
      expect((await service.read({ courseId: 'course', relPath: `source${extension}` })).content).toMatchObject({ kind: extension === '.md' || extension === '.markdown' ? 'markdown' : 'text', text: '본문' })
    }
    expect(read).not.toHaveBeenCalled()
    service.dispose()
  })

  test('coalesces identical reads, refreshes changed files, and separates courses', async () => {
    const path = await fixture('cache.docx', 'first')
    const read = vi.fn(async () => ({ kind: 'text' as const, text: 'first preview', truncated: false }))
    const service = createMaterialHoverPreviewService({ materials: { absolutePathForAsync: async () => path }, userData: folder, extractor: { read, dispose: vi.fn() } })
    const req = { courseId: 'course-one', relPath: 'cache.docx' }
    await Promise.all([service.read(req), service.read(req)])
    await service.read(req)
    expect(read).toHaveBeenCalledTimes(1)
    await service.read({ ...req, courseId: 'course-two' })
    expect(read).toHaveBeenCalledTimes(2)
    await writeFile(path, 'second contents')
    await utimes(path, new Date(), new Date(Date.now() + 1000))
    await service.read(req)
    expect(read).toHaveBeenCalledTimes(3)
    service.dispose()
  })
})
