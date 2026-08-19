/**
 * The read-only agent tools, end to end against real repos and a fake fetch.
 *
 * The point of these tests is the GATE: a read being cheap is not a reason for
 * it to be ungoverned. Every path here asserts either a refusal or an audit
 * row, not just the happy answer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createAuditRepo } from '../../../src/main/features/browserAgent/audit'
import { createBrowserTools } from '../../../src/main/features/browserAgent/browserTools'
import { createGrantsRepo } from '../../../src/main/features/browserAgent/grants'
import { createSeenRepo } from '../../../src/main/features/browserAgent/seenRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE = 'ds'
const ORIGIN = 'https://myetl.snu.ac.kr'

function announcements(...titles: string[]): unknown[] {
  return titles.map((title, index) => ({
    id: index + 1,
    title,
    posted_at: '2026-08-19T00:00:00Z',
    html_url: `${ORIGIN}/courses/12345/discussion_topics/${index + 1}`
  }))
}

describe('browser tools (read-only)', () => {
  let ctx: TestDb
  let audit: ReturnType<typeof createAuditRepo>
  let grants: ReturnType<typeof createGrantsRepo>
  let body: unknown[]
  let fetch: ReturnType<typeof vi.fn>

  function tools(over: Partial<Parameters<typeof createBrowserTools>[0]> = {}) {
    return createBrowserTools({
      courseId: COURSE,
      getRunId: () => 'run-1',
      grants,
      audit,
      seen: createSeenRepo(ctx.db),
      courseLinks: () => [
        { url: `${ORIGIN}/courses/12345`, lmsCourseId: '12345' }
      ],
      specFor: () => ({ platform: 'canvas' }),
      // Default to declining: a test that wants access has to say so, the
      // same way a student does.
      confirm: async () => false,
      fetch: fetch as unknown as (url: string) => Promise<Response>,
      ...over
    })
  }

  beforeEach(() => {
    ctx = createTestDb()
    audit = createAuditRepo(ctx.db)
    grants = createGrantsRepo(ctx.db)
    body = announcements('휴강 공지')
    fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body
    }))
  })

  afterEach(() => ctx.cleanup())

  test('lms_course_page reports the linked classroom', () => {
    expect(tools().lms_course_page(COURSE)).toEqual({
      url: `${ORIGIN}/courses/12345`,
      platform: 'canvas'
    })
  })

  test('lms_course_page is honest when nothing is linked', () => {
    expect(tools({ courseLinks: () => [] }).lms_course_page(COURSE)).toEqual({
      url: null,
      platform: null
    })
  })

  test('asks before reading a site for the first time, and honours a no', async () => {
    const confirm = vi.fn(async () => false)
    const result = await tools({ confirm }).lms_new_items(COURSE, 'announcements')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect(grants.list(COURSE)).toEqual([])

    const tail = audit.tail(COURSE)
    expect(tail[0]?.action).toBe('denied')
    expect(tail[0]?.detail).toContain('거부')
  })

  test('a yes creates a scoped, expiring grant and proceeds', async () => {
    const confirm = vi.fn(async () => true)
    const result = await tools({ confirm }).lms_new_items(COURSE, 'announcements')

    expect(result.status).toBe('ok')
    const [grant] = grants.list(COURSE)
    expect(grant?.origin).toBe(ORIGIN)
    expect(grant?.capability).toBe('read')
    // Not "forever": it has an end date the student can see.
    expect(grant?.expiresAt.length).toBeGreaterThan(0)
    expect(audit.tail(COURSE).some((e) => e.action === 'grant')).toBe(true)
  })

  test('does not ask twice for the same site', async () => {
    const confirm = vi.fn(async () => true)
    const api = tools({ confirm })
    await api.lms_new_items(COURSE, 'announcements')
    await api.lms_new_items(COURSE, 'announcements')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  test('the first look records the list instead of dumping it', async () => {
    // Otherwise the very first question replays the whole semester.
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    const result = await tools().lms_new_items(COURSE, 'announcements')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.firstRun).toBe(true)
      expect(result.items).toEqual([])
    }
  })

  test('afterwards it reports only what is new', async () => {
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    const api = tools()
    await api.lms_new_items(COURSE, 'announcements')

    body = announcements('휴강 공지', '기말 범위 공지')
    const result = await api.lms_new_items(COURSE, 'announcements')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.firstRun).toBe(false)
      expect(result.items.map((item) => item.title)).toEqual(['기말 범위 공지'])
    }
  })

  test('asking again with nothing new returns nothing', async () => {
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    const api = tools()
    await api.lms_new_items(COURSE, 'announcements')
    body = announcements('휴강 공지', '기말 범위 공지')
    await api.lms_new_items(COURSE, 'announcements')

    const third = await api.lms_new_items(COURSE, 'announcements')
    if (third.status === 'ok') expect(third.items).toEqual([])
  })

  test('an unknown kind falls back to announcements rather than failing', async () => {
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    const result = await tools().lms_new_items(COURSE, 'nonsense')
    if (result.status === 'ok') expect(result.kind).toBe('announcements')
  })

  test('says what to do when no classroom is linked', async () => {
    const result = await tools({ courseLinks: () => [] }).lms_new_items(
      COURSE,
      'announcements'
    )
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('과목 링크')
  })

  test('a hard-denied origin is refused even with a grant', async () => {
    // 수강신청 is refused because of what it is, not because of a permission.
    grants.grant({
      courseId: COURSE,
      url: 'https://sugang.snu.ac.kr',
      capability: 'read'
    })
    const result = await tools({
      courseLinks: () => [
        { url: 'https://sugang.snu.ac.kr/courses/1', lmsCourseId: '1' }
      ]
    }).lms_new_items(COURSE, 'announcements')

    expect(result.status).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect(audit.tail(COURSE)[0]?.detail).toContain('registration')
  })

  test('a successful read is audited without the query string', async () => {
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    await tools().lms_new_items(COURSE, 'announcements')
    const entry = audit.tail(COURSE)[0]
    expect(entry?.action).toBe('read')
    // origin + path, so the root reads as `…/`. No query, no fragment.
    expect(entry?.url).toBe(`${ORIGIN}/`)
    expect(entry?.url).not.toContain('?')
  })

  test('using a grant stamps it, so a stale one is visible in settings', async () => {
    const grant = grants.grant({
      courseId: COURSE,
      url: ORIGIN,
      capability: 'read'
    })
    await tools().lms_new_items(COURSE, 'announcements')
    expect(grants.list(COURSE)[0]?.lastUsedAt).not.toBeNull()
    expect(grant).not.toBeNull()
  })

  test('a logged-out classroom says so instead of reporting zero news', async () => {
    grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const result = await tools().lms_new_items(COURSE, 'announcements')
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('로그인')
  })
  describe('collection', () => {
    test('lms_list returns the whole list, not just what is new', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
      const api = tools()
      // Even after a diff has consumed them, listing still shows everything.
      await api.lms_new_items(COURSE, 'announcements')
      const result = await api.lms_list(COURSE, 'announcements')
      expect(result.status).toBe('ok')
      if (result.status === 'ok') expect(result.items).toHaveLength(1)
    })

    test('lms_list defaults to files — what collecting handouts needs', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
      const result = await tools().lms_list(COURSE, null)
      if (result.status === 'ok') expect(result.kind).toBe('files')
    })

    test('a read grant does NOT authorise downloading — it asks again', async () => {
      // Looking at a page and taking files off it are separate decisions.
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
      const confirm = vi.fn(async () => false)
      const collect = vi.fn()
      const result = await tools({ collect, confirm }).browser_download(
        COURSE,
        `${ORIGIN}/files/1.pdf`,
        ''
      )
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('error')
      expect(collect).not.toHaveBeenCalled()
    })

    test('a hard-denied origin is never even asked about', async () => {
      // Asking would imply a yes could unlock it. It cannot.
      const confirm = vi.fn(async () => true)
      const collect = vi.fn()
      await tools({ collect, confirm }).browser_download(
        COURSE,
        'https://sugang.snu.ac.kr/files/1.pdf',
        ''
      )
      expect(confirm).not.toHaveBeenCalled()
      expect(collect).not.toHaveBeenCalled()
    })

    test('downloads with a download grant, and journals the path', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'download' })
      const collect = vi.fn(async () => ({ relPath: '3주차/강의자료.pdf' }))
      const result = await tools({ collect }).browser_download(
        COURSE,
        `${ORIGIN}/files/1.pdf`,
        '3주차'
      )
      expect(result).toEqual({ status: 'ok', relPath: '3주차/강의자료.pdf' })
      expect(collect).toHaveBeenCalledWith({
        courseId: COURSE,
        url: `${ORIGIN}/files/1.pdf`,
        dirRelPath: '3주차'
      })
      const entry = audit.tail(COURSE)[0]
      expect(entry?.action).toBe('download')
      expect(entry?.detail).toContain('강의자료.pdf')
    })

    test('a download grant covers reading too', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'download' })
      const result = await tools().lms_list(COURSE, 'files')
      expect(result.status).toBe('ok')
    })

    test('never downloads from a hard-denied origin', async () => {
      grants.grant({
        courseId: COURSE,
        url: 'https://sugang.snu.ac.kr',
        capability: 'download'
      })
      const collect = vi.fn()
      const result = await tools({ collect }).browser_download(
        COURSE,
        'https://sugang.snu.ac.kr/files/1.pdf',
        ''
      )
      expect(result.status).toBe('error')
      expect(collect).not.toHaveBeenCalled()
    })

    test('a failed download reports the reason and audits it', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'download' })
      const result = await tools({
        collect: async () => {
          throw new Error('파일이 너무 큽니다')
        }
      }).browser_download(COURSE, `${ORIGIN}/files/1.pdf`, '')

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.message).toContain('너무 큽니다')
      }
      expect(audit.tail(COURSE)[0]?.detail).toContain('실패')
    })

    test('says so plainly when the session cannot download at all', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'download' })
      const result = await tools().browser_download(
        COURSE,
        `${ORIGIN}/files/1.pdf`,
        ''
      )
      expect(result.status).toBe('error')
    })
  })

  describe('interaction (DOM tier)', () => {
    function page(over: Record<string, unknown> = {}) {
      return {
        openTab: vi.fn(async (url: string) => ({ tabId: 't1', url })),
        generation: () => 3,
        snapshot: vi.fn(async () => ({ url: `${ORIGIN}/w3`, outline: 'f0:e0@3 link "자료"' })),
        read: vi.fn(async () => ({ url: `${ORIGIN}/w3`, text: '본문' })),
        factsFor: vi.fn(async () => ({
          tag: 'a',
          type: null,
          inNonGetForm: false,
          href: '/f/1.pdf',
          disabled: false
        })),
        act: vi.fn(async () => true),
        currentUrl: () => `${ORIGIN}/w3`,
        handoff: vi.fn(async () => 'resumed' as const),
        assertLive: vi.fn(),
        step: vi.fn(),
        ...over
      }
    }

    test('interacting needs its own grant — read is not enough', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'read' })
      const p = page()
      const result = await tools({ page: p }).browser_act('t1', 'f0:e0@3', {
        kind: 'click'
      })
      expect(result.status).toBe('error')
      expect(p.act).not.toHaveBeenCalled()
    })

    test('a stale ref is refused rather than clicking something else', async () => {
      // The generation is 3; a ref from generation 2 names a different page.
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page()
      const result = await tools({ page: p }).browser_act('t1', 'f0:e0@2', {
        kind: 'click'
      })
      expect(result.status).toBe('error')
      if (result.status === 'error') expect(result.message).toContain('바뀌었')
      expect(p.act).not.toHaveBeenCalled()
    })

    test('refuses to click anything that submits', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page({
        factsFor: async () => ({
          tag: 'button',
          type: 'submit',
          inNonGetForm: true,
          href: null,
          disabled: false
        })
      })
      const result = await tools({ page: p }).browser_act('t1', 'f0:e0@3', {
        kind: 'click'
      })
      expect(result.status).toBe('error')
      if (result.status === 'error') expect(result.message).toContain('직접')
      expect(p.act).not.toHaveBeenCalled()
    })

    test('refuses to type into a password field', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page({
        factsFor: async () => ({
          tag: 'input',
          type: 'password',
          inNonGetForm: true,
          href: null,
          disabled: false
        })
      })
      const result = await tools({ page: p }).browser_act('t1', 'f0:e0@3', {
        kind: 'type',
        text: 'hunter2'
      })
      expect(result.status).toBe('error')
      expect(p.act).not.toHaveBeenCalled()
    })

    test('performs an ordinary click and records it', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page()
      const result = await tools({ page: p }).browser_act('t1', 'f0:e0@3', {
        kind: 'click'
      })
      expect(result.status).toBe('ok')
      expect(p.act).toHaveBeenCalledTimes(1)
      expect(audit.tail(COURSE).some((e) => e.detail.includes('click'))).toBe(true)
    })

    test('typed text is redacted in the audit like everything else', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page({
        factsFor: async () => ({
          tag: 'input',
          type: 'text',
          inNonGetForm: false,
          href: null,
          disabled: false
        })
      })
      await tools({ page: p }).browser_act('t1', 'f0:e0@3', {
        kind: 'type',
        text: '학번 2021123456'
      })
      const entry = audit.tail(COURSE).find((e) => e.detail.includes('type'))
      expect(entry?.detail).not.toContain('2021123456')
      expect(entry?.detail).toContain('██████')
    })

    test('중지 stops before the action, not after', async () => {
      grants.grant({ courseId: COURSE, url: ORIGIN, capability: 'interact' })
      const p = page({
        assertLive: () => {
          throw new Error('학생이 중지했어요.')
        }
      })
      await expect(
        tools({ page: p }).browser_act('t1', 'f0:e0@3', { kind: 'click' })
      ).rejects.toThrow('중지')
      expect(p.act).not.toHaveBeenCalled()
    })

    test('snapshot and read need a read grant, and report the URL', async () => {
      const confirm = vi.fn(async () => true)
      const p = page()
      const api = tools({ page: p, confirm })
      const snap = await api.browser_snapshot('t1', null)
      expect(snap.status).toBe('ok')
      if (snap.status === 'ok') expect(snap.outline).toContain('f0:e0@3')

      const read = await api.browser_read('t1', null)
      expect(read.status).toBe('ok')
    })

    test('handoff is an outcome, not a failure', async () => {
      const p = page()
      const result = await tools({ page: p }).browser_handoff(
        't1',
        '로그인하고 계속을 눌러 주세요'
      )
      expect(result).toEqual({ status: 'resumed' })
      expect(p.handoff).toHaveBeenCalled()
    })

    test('a stopped handoff reports the stop', async () => {
      const p = page({ handoff: async () => 'stopped' as const })
      const result = await tools({ page: p }).browser_handoff('t1', 'x')
      expect(result.status).toBe('error')
    })

    test('without a page surface every interaction tool declines cleanly', async () => {
      const api = tools()
      for (const result of [
        await api.browser_open(`${ORIGIN}/w3`),
        await api.browser_snapshot('t1', null),
        await api.browser_read('t1', null),
        await api.browser_act('t1', 'f0:e0@3', { kind: 'click' }),
        await api.browser_handoff('t1', 'x')
      ]) {
        expect(result.status).toBe('error')
      }
    })
  })

})
