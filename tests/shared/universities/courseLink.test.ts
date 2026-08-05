import { describe, expect, test } from 'vitest'
import {
  buildCourseUrl,
  defaultCourseLinkLabel,
  inferCourseLinkSpec,
  normalizeHttpUrl,
  parseCourseUrl
} from '../../../src/shared/universities/courseLink'
import {
  blackboardCourseLink,
  canvasCourseLink,
  ilosCourseLink,
  moodleCourseLink
} from '../../../src/shared/universities/specs'
import { findUniversity } from '../../../src/shared/universities'

const SNU_SPEC = findUniversity('snu')?.courseLink ?? null
const KAIST_SPEC = findUniversity('kaist')?.courseLink ?? null

describe('normalizeHttpUrl', () => {
  test('accepts full https URLs unchanged', () => {
    expect(normalizeHttpUrl('https://myetl.snu.ac.kr/courses/12345')).toBe(
      'https://myetl.snu.ac.kr/courses/12345'
    )
  })

  test('adds the implicit https:// to a bare host', () => {
    expect(normalizeHttpUrl('plato.pusan.ac.kr/course/view.php?id=7')).toBe(
      'https://plato.pusan.ac.kr/course/view.php?id=7'
    )
  })

  test('keeps a non-standard port — 인하대 :8443 / 아주대 :30443 need it', () => {
    expect(normalizeHttpUrl('idp.inha.ac.kr:8443/exsignon-web/svc/tk/Auth.do')).toBe(
      'https://idp.inha.ac.kr:8443/exsignon-web/svc/tk/Auth.do'
    )
    expect(normalizeHttpUrl('https://mhaksa.ajou.ac.kr:30443/')).toContain(':30443')
  })

  test('rejects non-http schemes and junk', () => {
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeHttpUrl('   ')).toBeNull()
    expect(normalizeHttpUrl('그냥 텍스트')).toBeNull()
  })

  test('keeps http:// — 건국대 홈페이지 downgrades mid-redirect', () => {
    expect(normalizeHttpUrl('http://cert.postech.ac.kr/')).toBe(
      'http://cert.postech.ac.kr/'
    )
  })
})

describe('parseCourseUrl — Canvas (서울대 myeTL)', () => {
  test('recognises a course URL and keeps the pasted original', () => {
    const parse = parseCourseUrl('https://myetl.snu.ac.kr/courses/12345', SNU_SPEC)

    expect(parse.status).toBe('lms-course')
    if (parse.status !== 'lms-course') return
    expect(parse.lmsCourseId).toBe('12345')
    expect(parse.url).toBe('https://myetl.snu.ac.kr/courses/12345')
    expect(parse.rawUrl).toBe('https://myetl.snu.ac.kr/courses/12345')
    expect(parse.platform).toBe('canvas')
  })

  test('normalises a sub-page back to the course root', () => {
    const parse = parseCourseUrl(
      'https://myetl.snu.ac.kr/courses/12345/assignments?foo=1#top',
      SNU_SPEC
    )

    expect(parse.status).toBe('lms-course')
    if (parse.status !== 'lms-course') return
    expect(parse.url).toBe('https://myetl.snu.ac.kr/courses/12345')
    // The raw URL is never lost — the student can always get back.
    expect(parse.rawUrl).toContain('/assignments')
  })

  test('THE TRAP: the eTL catalog is not the 강의실', () => {
    // `etl.snu.ac.kr` is a Xinics catalog/SSO gateway. Its 24-hex catalog_id
    // is NOT a Canvas course id, and /course/view.php on it 404s.
    const catalog = parseCourseUrl(
      'https://etl.snu.ac.kr/course/?catalog_id=630871871954c05b9a4584eb',
      SNU_SPEC
    )
    expect(catalog.status).toBe('generic')

    const moodleShaped = parseCourseUrl(
      'https://etl.snu.ac.kr/course/view.php?id=12345',
      SNU_SPEC
    )
    expect(moodleShaped.status).toBe('generic')
  })

  test('a 24-hex id on the Canvas host is still not a course id', () => {
    const parse = parseCourseUrl(
      'https://myetl.snu.ac.kr/courses/630871871954c05b9a4584eb',
      SNU_SPEC
    )
    expect(parse.status).toBe('generic')
  })

  test('the front host never matches — /courses lives on the core host', () => {
    const spec = canvasCourseLink('canvas.knu.ac.kr')
    expect(parseCourseUrl('https://lms1.knu.ac.kr/courses/500', spec).status).toBe(
      'generic'
    )
    expect(parseCourseUrl('https://canvas.knu.ac.kr/courses/500', spec).status).toBe(
      'lms-course'
    )
  })
})

describe('parseCourseUrl — Moodle', () => {
  test('reads id from any query position', () => {
    const first = parseCourseUrl(
      'https://klms.kaist.ac.kr/course/view.php?id=4321',
      KAIST_SPEC
    )
    const later = parseCourseUrl(
      'https://klms.kaist.ac.kr/course/view.php?lang=ko&id=4321#section-3',
      KAIST_SPEC
    )

    expect(first.status).toBe('lms-course')
    expect(later.status).toBe('lms-course')
    if (later.status !== 'lms-course') return
    expect(later.lmsCourseId).toBe('4321')
    expect(later.url).toBe('https://klms.kaist.ac.kr/course/view.php?id=4321')
  })

  test('does not confuse a different id-suffixed param', () => {
    const spec = moodleCourseLink('plato.pusan.ac.kr')
    expect(
      parseCourseUrl('https://plato.pusan.ac.kr/course/view.php?courseid=9', spec)
        .status
    ).toBe('generic')
    expect(
      parseCourseUrl('https://plato.pusan.ac.kr/course/view.php?a=1&myid=9', spec)
        .status
    ).toBe('generic')
  })

  test('a non-numeric id is not a Moodle course', () => {
    const spec = moodleCourseLink('cyber.ewha.ac.kr')
    expect(
      parseCourseUrl('https://cyber.ewha.ac.kr/course/view.php?id=abc', spec).status
    ).toBe('generic')
  })
})

describe('parseCourseUrl — iLOS and Blackboard (베타)', () => {
  test('iLOS captures the string KJKEY and stays unreliable', () => {
    const spec = ilosCourseLink('ecampus.konkuk.ac.kr')
    const parse = parseCourseUrl(
      'https://ecampus.konkuk.ac.kr/ilos/st/course/submain_form.acl?KJKEY=A1b2-C3',
      spec
    )

    expect(parse.status).toBe('lms-course')
    if (parse.status !== 'lms-course') return
    expect(parse.lmsCourseId).toBe('A1b2-C3')
    expect(parse.reliable).toBe(false)
  })

  test('Blackboard reads the _12345_1 wrapper in both layouts', () => {
    const spec = blackboardCourseLink('eclass2.ajou.ac.kr')
    const ultra = parseCourseUrl(
      'https://eclass2.ajou.ac.kr/ultra/courses/_1234_1/cl/outline',
      spec
    )
    const original = parseCourseUrl(
      'https://eclass2.ajou.ac.kr/webapps/blackboard/execute/courseMain?course_id=_1234_1',
      spec
    )

    expect(ultra.status).toBe('lms-course')
    expect(original.status).toBe('lms-course')
    if (original.status !== 'lms-course') return
    expect(original.lmsCourseId).toBe('1234')
    expect(original.url).toBe(
      'https://eclass2.ajou.ac.kr/ultra/courses/_1234_1/cl/outline'
    )
  })
})

describe('parseCourseUrl — non-course and invalid input', () => {
  test('an unrelated but valid URL is saved, not rejected', () => {
    const parse = parseCourseUrl('cs.snu.ac.kr/notice', SNU_SPEC)

    expect(parse.status).toBe('generic')
    if (parse.status !== 'generic') return
    expect(parse.url).toBe('https://cs.snu.ac.kr/notice')
  })

  test('a school with no LMS spec keeps everything generic', () => {
    expect(parseCourseUrl('https://example.ac.kr/courses/5', null).status).toBe(
      'generic'
    )
  })

  test('reports why unusable input failed', () => {
    expect(parseCourseUrl('', SNU_SPEC)).toEqual({
      status: 'invalid',
      reason: 'empty'
    })
    expect(parseCourseUrl('javascript:alert(1)', SNU_SPEC)).toEqual({
      status: 'invalid',
      reason: 'unsupported-scheme'
    })
    expect(parseCourseUrl('그냥 메모', SNU_SPEC)).toEqual({
      status: 'invalid',
      reason: 'malformed'
    })
  })

  test('a malformed preset pattern degrades to generic instead of throwing', () => {
    const broken = { ...canvasCourseLink('x.ac.kr'), idPattern: '([' }
    expect(parseCourseUrl('https://x.ac.kr/courses/1', broken).status).toBe(
      'generic'
    )
  })
})

describe('inferCourseLinkSpec — 직접 추가한 학교', () => {
  test('infers Canvas from a pasted course URL', () => {
    const spec = inferCourseLinkSpec('https://canvas.hanbat.ac.kr/courses/777')

    expect(spec?.platform).toBe('canvas')
    expect(spec?.template).toBe('https://canvas.hanbat.ac.kr/courses/{id}')
    expect(parseCourseUrl('https://canvas.hanbat.ac.kr/courses/9', spec).status).toBe(
      'lms-course'
    )
  })

  test('infers Moodle from a pasted course URL', () => {
    const spec = inferCourseLinkSpec(
      'lms.hanbat.ac.kr/course/view.php?id=42&section=2'
    )

    expect(spec?.platform).toBe('moodle')
    expect(spec?.template).toBe('https://lms.hanbat.ac.kr/course/view.php?id={id}')
  })

  test('keeps a non-standard port in the inferred host', () => {
    const spec = inferCourseLinkSpec('https://lms.hanbat.ac.kr:8443/courses/5')

    expect(spec?.template).toBe('https://lms.hanbat.ac.kr:8443/courses/{id}')
    expect(
      parseCourseUrl('https://lms.hanbat.ac.kr:8443/courses/6', spec).status
    ).toBe('lms-course')
    // The port is part of the identity: the same path on :443 is a different site.
    expect(parseCourseUrl('https://lms.hanbat.ac.kr/courses/6', spec).status).toBe(
      'generic'
    )
  })

  test('returns null when the URL is not a recognisable course page', () => {
    expect(inferCourseLinkSpec('https://www.hanbat.ac.kr/')).toBeNull()
    expect(inferCourseLinkSpec('https://x.ac.kr/ilos/st/course/submain_form.acl?KJKEY=a')).toBeNull()
    expect(inferCourseLinkSpec('not a url')).toBeNull()
  })
})

describe('buildCourseUrl / defaultCourseLinkLabel', () => {
  test('rebuilds a course URL from its id', () => {
    expect(buildCourseUrl(canvasCourseLink('canvas.knu.ac.kr'), '881')).toBe(
      'https://canvas.knu.ac.kr/courses/881'
    )
  })

  test('labels an LMS hit 강의실 and a generic link by host', () => {
    expect(
      defaultCourseLinkLabel(
        parseCourseUrl('https://myetl.snu.ac.kr/courses/1', SNU_SPEC)
      )
    ).toBe('강의실')
    expect(
      defaultCourseLinkLabel(parseCourseUrl('https://www.cs.snu.ac.kr/', SNU_SPEC))
    ).toBe('cs.snu.ac.kr')
  })
})
