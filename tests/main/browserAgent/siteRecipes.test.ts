import { describe, expect, test, vi } from 'vitest'
import {
  fetchLmsList,
  lmsTargetFor,
  parseCanvasList,
  type LmsTarget
} from '../../../src/main/features/browserAgent/siteRecipes'

const TARGET: LmsTarget = {
  platform: 'canvas',
  origin: 'https://myetl.snu.ac.kr',
  lmsCourseId: '12345'
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response
}

describe('lmsTargetFor', () => {
  test('derives the API origin from a saved course link', () => {
    expect(
      lmsTargetFor(
        { url: 'https://myetl.snu.ac.kr/courses/12345', lmsCourseId: '12345' },
        { platform: 'canvas' }
      )
    ).toEqual(TARGET)
  })

  test('needs a recognised course id', () => {
    expect(
      lmsTargetFor(
        { url: 'https://myetl.snu.ac.kr/x', lmsCourseId: null },
        { platform: 'canvas' }
      )
    ).toBeNull()
  })

  test('needs a platform', () => {
    expect(
      lmsTargetFor(
        { url: 'https://myetl.snu.ac.kr/courses/1', lmsCourseId: '1' },
        null
      )
    ).toBeNull()
  })

  test('rejects a non-http link', () => {
    expect(
      lmsTargetFor({ url: 'file:///x', lmsCourseId: '1' }, { platform: 'canvas' })
    ).toBeNull()
  })
})

describe('parseCanvasList', () => {
  test('reads announcements, taking the human page URL', () => {
    const items = parseCanvasList(
      [
        {
          id: 7,
          title: '휴강 공지',
          posted_at: '2026-08-19T01:00:00Z',
          html_url: 'https://myetl.snu.ac.kr/courses/12345/discussion_topics/7',
          url: 'https://myetl.snu.ac.kr/api/v1/…'
        }
      ],
      'announcements',
      TARGET
    )
    expect(items).toEqual([
      {
        id: '7',
        title: '휴강 공지',
        at: '2026-08-19T01:00:00Z',
        url: 'https://myetl.snu.ac.kr/courses/12345/discussion_topics/7'
      }
    ])
  })

  test('assignments report the due date, not the creation date', () => {
    const items = parseCanvasList(
      [{ id: 1, name: '과제 1', due_at: '2026-09-01T14:59:00Z', created_at: '2026-08-01T00:00:00Z' }],
      'assignments',
      TARGET
    )
    expect(items[0]?.at).toBe('2026-09-01T14:59:00Z')
  })

  test('handles the different name fields Canvas uses per resource', () => {
    expect(parseCanvasList([{ id: 1, name: 'n' }], 'modules', TARGET)[0]?.title).toBe('n')
    expect(
      parseCanvasList([{ id: 2, display_name: 'd.pdf' }], 'files', TARGET)[0]?.title
    ).toBe('d.pdf')
  })

  test('falls back to the course page when a row has no html_url', () => {
    expect(parseCanvasList([{ id: 1, title: 't' }], 'modules', TARGET)[0]?.url).toBe(
      'https://myetl.snu.ac.kr/courses/12345'
    )
  })

  test('skips junk rather than throwing', () => {
    expect(
      parseCanvasList([null, 'x', {}, { id: 1, title: '   ' }], 'modules', TARGET)
    ).toEqual([])
    expect(parseCanvasList({ error: 'nope' }, 'modules', TARGET)).toEqual([])
  })
})

describe('fetchLmsList', () => {
  test('calls the Canvas REST path for the kind asked for', async () => {
    const fetch = vi.fn(async () => json([]))
    await fetchLmsList({ fetch }, TARGET, 'announcements')
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://myetl.snu.ac.kr/api/v1/courses/12345/discussion_topics?only_announcements=true&per_page=20'
    )
  })

  test('says so plainly when the session is not logged in', async () => {
    for (const status of [401, 403]) {
      const result = await fetchLmsList(
        { fetch: async () => json({}, status) },
        TARGET,
        'announcements'
      )
      expect(result.status, String(status)).toBe('failed')
      if (result.status === 'failed') {
        expect(result.message).toContain('로그인')
      }
    }
  })

  test('reports unsupported for a platform with no cookie-auth API', async () => {
    // Moodle needs the HTML rung; pretending would produce silent emptiness.
    const fetch = vi.fn()
    const result = await fetchLmsList(
      { fetch },
      { ...TARGET, platform: 'moodle' },
      'announcements'
    )
    expect(result.status).toBe('unsupported')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('a thrown fetch is a failure, not a crash', async () => {
    const result = await fetchLmsList(
      {
        fetch: async () => {
          throw new Error('offline')
        }
      },
      TARGET,
      'announcements'
    )
    expect(result.status).toBe('failed')
  })
})
