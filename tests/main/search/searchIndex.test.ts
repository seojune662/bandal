import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ValidationError } from '../../../src/main/db/errors'
import {
  contentSearchKey,
  createSearchIndex,
  type SearchIndex
} from '../../../src/main/features/search'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('course content search index', () => {
  let ctx: TestDb
  let courseFolder: string
  let index: SearchIndex

  beforeEach(() => {
    ctx = createTestDb()
    courseFolder = join(ctx.dir, 'course')
    mkdirSync(courseFolder)
    index = createSearchIndex(ctx.db, {
      getCourseFolder: (courseId) => {
        if (courseId !== 'course-1') throw new Error('unknown course')
        return courseFolder
      }
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  function createInstrumentedIndex(): {
    instrumentedIndex: SearchIndex
    readTextFile: ReturnType<typeof vi.fn<(path: string) => string>>
  } {
    const readTextFile = vi.fn((path: string) => readFileSync(path, 'utf8'))
    return {
      instrumentedIndex: createSearchIndex(ctx.db, {
        getCourseFolder: () => courseFolder,
        readTextFile
      }),
      readTextFile
    }
  }

  test('uses the trigram tokenizer bundled with better-sqlite3', () => {
    const sql = ctx.db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'table' AND name = 'course_content_fts'`
      )
      .get() as { sql: string }

    expect(sql.sql).toContain("tokenize='trigram'")
  })

  test('finds an unsegmented Korean substring from NFD text using an NFC query', () => {
    const nfcPhrase = '파동함수'.normalize('NFC')
    const nfdBody = `양자역학에서${nfcPhrase.normalize('NFD')}의 의미를 배웠다.`
    expect(nfdBody).not.toContain(nfcPhrase)
    writeFileSync(join(courseFolder, '양자역학.md'.normalize('NFD')), nfdBody)

    const hits = index.query('course-1', nfcPhrase)

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'note', page: null })
    expect(hits[0]?.relPath.normalize('NFC')).toBe('양자역학.md')
    expect(hits[0]?.snippet).toContain(nfcPhrase)
  })

  test('falls back for a two-character Korean query', () => {
    writeFileSync(join(courseFolder, 'week.txt'), '중간고사 범위와 일정')

    expect(index.query('course-1', '고사')[0]).toMatchObject({
      kind: 'text',
      relPath: 'week.txt'
    })
  })

  test('does not read unchanged text files on the second query', () => {
    const { instrumentedIndex, readTextFile } = createInstrumentedIndex()
    writeFileSync(join(courseFolder, 'one.md'), '첫 번째 내용')
    writeFileSync(join(courseFolder, 'two.txt'), '두 번째 내용')

    expect(instrumentedIndex.query('course-1', '내용')).toHaveLength(2)
    expect(readTextFile).toHaveBeenCalledTimes(2)
    readTextFile.mockClear()

    expect(instrumentedIndex.query('course-1', '내용')).toHaveLength(2)
    expect(readTextFile).not.toHaveBeenCalled()
  })

  test('reindexes only the text file whose metadata changed', () => {
    const { instrumentedIndex, readTextFile } = createInstrumentedIndex()
    writeFileSync(join(courseFolder, 'live.md'), '첫 번째 내용')
    writeFileSync(join(courseFolder, 'stable.txt'), '계속 유지되는 내용')
    expect(instrumentedIndex.query('course-1', '내용')).toHaveLength(2)
    readTextFile.mockClear()

    writeFileSync(join(courseFolder, 'live.md'), '운영체제 교착상태로 변경된 긴 내용')

    expect(instrumentedIndex.query('course-1', '교착상태')[0]?.relPath).toBe(
      'live.md'
    )
    expect(readTextFile).toHaveBeenCalledTimes(1)
    expect(readTextFile).toHaveBeenCalledWith(join(courseFolder, 'live.md'))
    expect(instrumentedIndex.query('course-1', '첫 번째')).toHaveLength(0)
  })

  test('removes a deleted text file without rereading unchanged files', () => {
    const { instrumentedIndex, readTextFile } = createInstrumentedIndex()
    const deletedPath = join(courseFolder, 'deleted.md')
    writeFileSync(deletedPath, '삭제될 본문')
    writeFileSync(join(courseFolder, 'stable.md'), '남아 있는 본문')
    expect(instrumentedIndex.query('course-1', '본문')).toHaveLength(2)
    readTextFile.mockClear()

    unlinkSync(deletedPath)

    expect(instrumentedIndex.query('course-1', '삭제될')).toHaveLength(0)
    expect(readTextFile).not.toHaveBeenCalled()
    const count = ctx.db
      .prepare(
        `SELECT count(*) AS count FROM course_content_fts
         WHERE course_id = ? AND rel_path = ?`
      )
      .get('course-1', 'deleted.md') as { count: number }
    expect(count.count).toBe(0)
  })

  test('skips and warns about text files larger than two megabytes', () => {
    const readTextFile = vi.fn((path: string) => readFileSync(path, 'utf8'))
    const logger = { warn: vi.fn() }
    const boundedIndex = createSearchIndex(ctx.db, {
      getCourseFolder: () => courseFolder,
      readTextFile,
      logger
    })
    writeFileSync(
      join(courseFolder, 'oversized.txt'),
      Buffer.alloc(2 * 1024 * 1024 + 1, 'a')
    )

    expect(boundedIndex.query('course-1', 'aaa')).toHaveLength(0)
    expect(readTextFile).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('over 2097152 bytes')
    )
  })

  test('stops and warns before scanning beyond depth ten', () => {
    const logger = { warn: vi.fn() }
    const boundedIndex = createSearchIndex(ctx.db, {
      getCourseFolder: () => courseFolder,
      logger
    })
    const tooDeep = join(
      courseFolder,
      ...Array.from({ length: 11 }, (_, index) => `depth-${index + 1}`)
    )
    mkdirSync(tooDeep, { recursive: true })
    writeFileSync(join(tooDeep, 'hidden.txt'), '깊이 제한 본문')

    expect(boundedIndex.query('course-1', '깊이 제한')).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('beyond depth 10')
    )
  })

  test('stops and warns after scanning five thousand files', () => {
    const logger = { warn: vi.fn() }
    const boundedIndex = createSearchIndex(ctx.db, {
      getCourseFolder: () => courseFolder,
      logger
    })
    for (let index = 0; index <= 5_000; index += 1) {
      writeFileSync(
        join(courseFolder, `unsupported-${String(index).padStart(4, '0')}.bin`),
        ''
      )
    }

    expect(boundedIndex.query('course-1', '없는 내용')).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stopped after 5000 files')
    )
  })

  test('indexes PDF pages without parsing the PDF in main', () => {
    writeFileSync(join(courseFolder, 'lecture.pdf'), 'not-a-real-pdf')
    index.indexPdfPages({
      courseId: 'course-1',
      relPath: 'lecture.pdf',
      pages: [
        { page: 2, text: '베이즈 정리는 사후확률을 계산한다.' },
        { page: 8, text: '중심극한정리 복습' }
      ]
    })

    expect(index.query('course-1', '사후확률')[0]).toMatchObject({
      kind: 'pdf',
      relPath: 'lecture.pdf',
      page: 2
    })
  })

  test('replaces an already indexed PDF page instead of duplicating it', () => {
    writeFileSync(join(courseFolder, 'lecture.pdf'), 'pdf')
    index.indexPdfPages({
      courseId: 'course-1',
      relPath: 'lecture.pdf',
      pages: [{ page: 3, text: '기존 본문' }]
    })
    index.indexPdfPages({
      courseId: 'course-1',
      relPath: 'lecture.pdf',
      pages: [{ page: 3, text: '새로운 본문' }]
    })

    expect(index.query('course-1', '기존 본문')).toHaveLength(0)
    expect(index.query('course-1', '새로운 본문')).toHaveLength(1)
    const row = ctx.db
      .prepare(
        `SELECT count(*) AS count FROM course_content_fts
         WHERE course_id = ? AND rel_path = ? AND page = ?`
      )
      .get('course-1', 'lecture.pdf', 3) as { count: number }
    expect(row.count).toBe(1)
  })

  test('prunes cached PDF pages after the file disappears', () => {
    const pdfPath = join(courseFolder, 'deleted.pdf')
    writeFileSync(pdfPath, 'pdf')
    index.indexPdfPages({
      courseId: 'course-1',
      relPath: 'deleted.pdf',
      pages: [{ page: 1, text: '삭제될 색인' }]
    })
    unlinkSync(pdfPath)

    index.prune('course-1')

    const count = ctx.db
      .prepare(
        `SELECT count(*) AS count FROM course_content_fts
         WHERE course_id = 'course-1'`
      )
      .get() as { count: number }
    expect(count.count).toBe(0)
  })

  test('returns contextual snippets no longer than 160 characters', () => {
    writeFileSync(
      join(courseFolder, 'long.txt'),
      `${'앞'.repeat(180)}핵심개념${'뒤'.repeat(180)}`
    )

    const hit = index.query('course-1', '핵심개념')[0]
    expect(hit?.snippet).toContain('핵심개념')
    expect(hit?.snippet.length).toBeLessThanOrEqual(160)
    expect(hit?.snippet.startsWith('…')).toBe(true)
    expect(hit?.snippet.endsWith('…')).toBe(true)
  })

  test('normalizes comparison keys and validates unsafe inputs', () => {
    expect(contentSearchKey('과제'.normalize('NFD'))).toBe(
      contentSearchKey('과제'.normalize('NFC'))
    )
    expect(() => index.query('course-1', '  ')).toThrow(ValidationError)
    expect(() =>
      index.indexPdfPages({
        courseId: 'course-1',
        relPath: '../escape.pdf',
        pages: [{ page: 1, text: 'x' }]
      })
    ).toThrow()
  })

  test('ignores hidden folders and unsupported binaries', () => {
    mkdirSync(join(courseFolder, '.bandal'))
    writeFileSync(join(courseFolder, '.bandal', 'private.md'), '숨은본문')
    writeFileSync(join(courseFolder, 'image.png'), '보이면안됨')

    expect(index.query('course-1', '숨은본문')).toHaveLength(0)
    expect(index.query('course-1', '보이면안됨')).toHaveLength(0)
  })
})
