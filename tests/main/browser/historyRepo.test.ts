import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createHistoryRepo,
  HISTORY_MAX_ROWS,
  hostOf,
  isRecordableUrl,
  type HistoryRepo
} from '../../../src/main/features/browser/historyRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('hostOf', () => {
  test('drops www so a prefix match behaves as typed', () => {
    expect(hostOf('https://www.myetl.snu.ac.kr/courses/1')).toBe(
      'myetl.snu.ac.kr'
    )
    expect(hostOf('https://portal.inha.ac.kr:8443/')).toBe('portal.inha.ac.kr')
  })

  test('returns empty for junk rather than throwing', () => {
    expect(hostOf('not a url')).toBe('')
  })
})

describe('isRecordableUrl', () => {
  test('accepts ordinary http(s) pages', () => {
    expect(isRecordableUrl('https://myetl.snu.ac.kr/courses/12345')).toBe(true)
    expect(isRecordableUrl('http://127.0.0.1:8080/x')).toBe(true)
  })

  test('rejects non-http schemes', () => {
    for (const url of ['about:blank', 'file:///etc/passwd', 'data:text/html,x']) {
      expect(isRecordableUrl(url), url).toBe(false)
    }
  })

  test('rejects our own search-result pages', () => {
    // Otherwise every omnibox query suggests the student's past queries
    // instead of the pages they actually opened.
    expect(isRecordableUrl('https://www.google.com/search?q=해시')).toBe(false)
    expect(isRecordableUrl('https://search.naver.com/search.naver?query=해시')).toBe(
      false
    )
    expect(isRecordableUrl('https://duckduckgo.com/?q=해시')).toBe(false)
  })

  test('keeps the search engine home page', () => {
    expect(isRecordableUrl('https://www.google.com/')).toBe(true)
  })
})

describe('historyRepo', () => {
  let ctx: TestDb
  let repo: HistoryRepo

  beforeEach(() => {
    ctx = createTestDb()
    repo = createHistoryRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  const visit = (
    url: string,
    title = 'T',
    courseId: string | null = 'c1',
    at?: Date
  ): void => repo.recordVisit({ url, title, courseId }, at)

  test('a revisit updates instead of appending', () => {
    visit('https://a.ac.kr/x', '처음')
    visit('https://a.ac.kr/x', '나중')

    const hits = repo.search('a.ac.kr')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.visitCount).toBe(2)
    expect(hits[0]?.title).toBe('나중')
  })

  test('history imports preserve real counts, skip old entries and never add visits on retry', () => {
    const at = new Date('2026-10-01T00:00:00Z')
    const rows = [{ url: 'https://school.test/lecture', title: '강의', visitCount: 20, lastVisitedAt: '2026-09-20T00:00:00Z' },
      { url: 'https://school.test/old', title: '이전', visitCount: 9, lastVisitedAt: '2020-01-01T00:00:00Z' }]
    expect(repo.importMany(rows, 'keep', at)).toEqual({ imported: 1, kept: 0, unsupported: 1, failed: 0 })
    expect(repo.importMany(rows, 'keep', at).kept).toBe(1)
    expect(repo.importMany(rows, 'replace', at).kept).toBe(1)
    expect(repo.search('school')[0]?.visitCount).toBe(20)
    repo.recordVisit({ url: rows[0]!.url, title: '변경', courseId: 'my-course' }, at)
    repo.importMany(rows, 'replace', at)
    expect(repo.search('school')[0]).toMatchObject({ visitCount: 21, courseId: 'my-course', lastVisitedAt: at.toISOString() })
  })

  test('import counts only URLs surviving the combined history ceiling, including retries and duplicates', () => {
    const at = new Date('2026-10-01T00:00:00Z')
    const insert = ctx.db.prepare('INSERT INTO browser_history (url,title,host,course_id,visit_count,last_visited_at) VALUES (?,?,?,NULL,?,?)')
    ctx.db.transaction(() => {
      for (let index = 0; index < HISTORY_MAX_ROWS; index++) {
        insert.run(`https://existing.test/${index}`, 'Existing', 'existing.test', 1, '2026-09-30T00:00:00.000Z')
      }
    })()
    const recent = { url: 'https://import.test/recent', title: 'Newest title', visitCount: 3, lastVisitedAt: at.toISOString() }
    const dropped = { url: 'https://import.test/older', title: 'Older', visitCount: 2, lastVisitedAt: '2026-09-20T00:00:00Z' }
    const rows = [recent, dropped, { ...recent, title: 'Previous title', visitCount: 8, lastVisitedAt: '2026-09-29T00:00:00Z' }, dropped, recent]
    expect(repo.importMany(rows, 'replace', at)).toEqual({ imported: 1, kept: 2, unsupported: 2, failed: 0 })
    expect(ctx.db.prepare('SELECT COUNT(*) AS total FROM browser_history').get()).toEqual({ total: HISTORY_MAX_ROWS })
    expect(repo.search('import.test')).toEqual([expect.objectContaining({ url: recent.url, title: recent.title, visitCount: 8, lastVisitedAt: recent.lastVisitedAt })])
    for (const conflict of ['keep', 'replace'] as const) {
      expect(repo.importMany(rows, conflict, at)).toEqual({ imported: 0, kept: 3, unsupported: 2, failed: 0 })
      expect(ctx.db.prepare('SELECT COUNT(*) AS total FROM browser_history').get()).toEqual({ total: HISTORY_MAX_ROWS })
    }
  })

  test('expired destination rows do not block a valid keep-mode history import', () => {
    const at = new Date('2026-10-01T00:00:00Z')
    const url = 'https://school.test/renewed'
    visit(url, 'Expired', 'c1', new Date('2026-01-01T00:00:00Z'))
    visit('https://school.test/still-expired', 'Expired', 'c1', new Date('2026-01-01T00:00:00Z'))
    const incoming = { url, title: 'Recent', visitCount: 5, lastVisitedAt: at.toISOString() }
    expect(repo.importMany([incoming, incoming], 'keep', at)).toEqual({ imported: 1, kept: 1, unsupported: 0, failed: 0 })
    expect(repo.search('school.test')).toEqual([expect.objectContaining({ url, title: 'Recent', visitCount: 5 })])
    expect(repo.importMany([incoming, incoming], 'replace', at)).toEqual({ imported: 0, kept: 2, unsupported: 0, failed: 0 })
  })

  test('a momentarily empty title does not wipe a good one', () => {
    // Pages report '' mid-load; overwriting would blank the suggestion.
    visit('https://a.ac.kr/x', '자료구조 3주차')
    visit('https://a.ac.kr/x', '')
    expect(repo.search('a.ac.kr')[0]?.title).toBe('자료구조 3주차')
  })

  test('ignores anything not worth remembering', () => {
    visit('about:blank')
    visit('https://www.google.com/search?q=x')
    expect(repo.search('blank')).toEqual([])
    expect(repo.search('google')).toEqual([])
  })

  test('matches on title as well as url', () => {
    visit('https://a.ac.kr/1', '자료구조 강의계획서')
    expect(repo.search('강의계획서')).toHaveLength(1)
  })

  test('a host the student is typing outranks a more-visited page', () => {
    visit('https://other.ac.kr/포털', '포털')
    for (let i = 0; i < 10; i += 1) visit('https://other.ac.kr/포털', '포털')
    visit('https://portal.ac.kr/', '포털 홈')

    // "portal" prefixes the host of the second one, so it wins despite the
    // first having far more visits.
    expect(repo.search('portal')[0]?.url).toBe('https://portal.ac.kr/')
  })

  test('ranks by visit count, then recency', () => {
    visit('https://a.ac.kr/rare', 'r', 'c1', new Date('2026-08-20T00:00:00Z'))
    visit('https://a.ac.kr/often', 'o', 'c1', new Date('2026-08-01T00:00:00Z'))
    visit('https://a.ac.kr/often', 'o', 'c1', new Date('2026-08-02T00:00:00Z'))

    expect(repo.search('a.ac.kr').map((h) => h.url)).toEqual([
      'https://a.ac.kr/often',
      'https://a.ac.kr/rare'
    ])
  })

  test('an empty query returns recent visits ahead of old frequent pages', () => {
    visit('https://a.ac.kr/old', 'old', 'c1', new Date('2026-09-01'))
    visit('https://a.ac.kr/old', 'old', 'c1', new Date('2026-09-02'))
    visit('https://a.ac.kr/new', 'new', 'c1', new Date('2026-09-28'))
    expect(repo.search('   ').map((item) => item.title)).toEqual(['new', 'old'])
  })

  test('words match across title and URL in any order', () => {
    visit('https://snu.ac.kr/course', '자료구조 강의실')
    visit('https://other.ac.kr/course', '자료구조 강의실')
    expect(repo.search('강의실 snu 자료구조').map((item) => item.url))
      .toEqual(['https://snu.ac.kr/course'])
  })

  test('Korean paths match whether pasted encoded or typed naturally', () => {
    visit('https://snu.ac.kr/%EA%B3%B5%EA%B0%84%EC%98%88%EC%95%BD', 'SNU')
    expect(repo.search('공간예약')).toHaveLength(1)
    expect(repo.search('%EA%B3%B5%EA%B0%84%EC%98%88%EC%95%BD')).toHaveLength(1)
  })

  test('SQL wildcard characters are literal input', () => {
    visit('https://snu.ac.kr/a_b', 'a_b')
    visit('https://snu.ac.kr/axb', 'axb')
    expect(repo.search('a_b').map((item) => item.title)).toEqual(['a_b'])
    expect(repo.search('%')).toEqual([])
  })

  test('honours the limit', () => {
    for (let i = 0; i < 12; i += 1) visit(`https://a.ac.kr/${i}`)
    expect(repo.search('a.ac.kr', 5)).toHaveLength(5)
  })

  test('clears one course without touching the others', () => {
    visit('https://a.ac.kr/1', 'a', 'c1')
    visit('https://b.ac.kr/1', 'b', 'c2')
    repo.clear('c1')

    expect(repo.search('a.ac.kr')).toEqual([])
    expect(repo.search('b.ac.kr')).toHaveLength(1)
  })

  test('clears everything when asked', () => {
    visit('https://a.ac.kr/1', 'a', 'c1')
    visit('https://b.ac.kr/1', 'b', null)
    repo.clear(null)
    expect(repo.search('ac.kr')).toEqual([])
  })

  test('prune drops rows past the retention window', () => {
    const now = new Date('2026-08-20T00:00:00Z')
    visit('https://old.ac.kr/1', 'old', 'c1', new Date('2026-01-01T00:00:00Z'))
    visit('https://new.ac.kr/1', 'new', 'c1', now)

    repo.prune(now)

    expect(repo.search('old.ac.kr')).toEqual([])
    expect(repo.search('new.ac.kr')).toHaveLength(1)
  })
})
