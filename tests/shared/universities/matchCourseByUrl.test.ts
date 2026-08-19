import { describe, expect, test } from 'vitest'
import { matchCourseByUrl } from '../../../src/shared/universities/matchCourseByUrl'

const CANDIDATES = [
  {
    courseId: 'ds',
    url: 'https://myetl.snu.ac.kr/courses/12345',
    lmsCourseId: '12345'
  },
  {
    courseId: 'algo',
    url: 'https://myetl.snu.ac.kr/courses/999',
    lmsCourseId: '999'
  },
  {
    courseId: 'inha',
    url: 'https://learn.inha.ac.kr:8443/courses/77',
    lmsCourseId: '77'
  },
  {
    courseId: 'no-lms',
    url: 'https://example.ac.kr/notes',
    lmsCourseId: null
  }
]

describe('matchCourseByUrl', () => {
  test('matches the course page itself', () => {
    expect(
      matchCourseByUrl('https://myetl.snu.ac.kr/courses/12345', CANDIDATES)
    ).toBe('ds')
  })

  test('matches a page deeper inside the same course', () => {
    // Where a student actually is when they download a handout.
    expect(
      matchCourseByUrl(
        'https://myetl.snu.ac.kr/courses/12345/files/8899?wrap=1',
        CANDIDATES
      )
    ).toBe('ds')
  })

  test('does not confuse a course id with a longer one', () => {
    // `/courses/999` must not match a link saved for `/courses/9999`.
    expect(
      matchCourseByUrl('https://myetl.snu.ac.kr/courses/9995', CANDIDATES)
    ).toBeNull()
  })

  test('a different host on the same platform is not a match', () => {
    expect(
      matchCourseByUrl('https://myetl.kaist.ac.kr/courses/12345', CANDIDATES)
    ).toBeNull()
  })

  test('the port is part of the identity', () => {
    // 인하대 :8443 / 아주대 :30443 are load-bearing, not decoration.
    expect(
      matchCourseByUrl('https://learn.inha.ac.kr:8443/courses/77', CANDIDATES)
    ).toBe('inha')
    expect(
      matchCourseByUrl('https://learn.inha.ac.kr/courses/77', CANDIDATES)
    ).toBeNull()
  })

  test('http and https are different origins', () => {
    expect(
      matchCourseByUrl('http://myetl.snu.ac.kr/courses/12345', CANDIDATES)
    ).toBeNull()
  })

  test('a course with no LMS id never matches', () => {
    expect(
      matchCourseByUrl('https://example.ac.kr/notes', CANDIDATES)
    ).toBeNull()
  })

  test('an ambiguous page matches nothing rather than guessing', () => {
    // Filing a lecture into the wrong course silently is worse than not
    // filing it at all.
    const ambiguous = [
      { courseId: 'a', url: 'https://lms.ac.kr/c/1', lmsCourseId: '1' },
      { courseId: 'b', url: 'https://lms.ac.kr/x/1', lmsCourseId: '1' }
    ]
    expect(matchCourseByUrl('https://lms.ac.kr/c/1', ambiguous)).toBeNull()
  })

  test('junk input is not a match', () => {
    for (const url of ['', 'not a url', 'file:///etc/passwd', 'about:blank']) {
      expect(matchCourseByUrl(url, CANDIDATES), url).toBeNull()
    }
  })

  test('no candidates means no match', () => {
    expect(matchCourseByUrl('https://myetl.snu.ac.kr/courses/1', [])).toBeNull()
  })
})
