/**
 * Preset-catalog integrity.
 *
 * These are contract tests against docs/university-sites.md, not snapshot
 * tests: they encode the facts an engineer can get wrong while editing the
 * catalog (a duplicated id silently shadowing a service, a school losing its
 * external-only flag, a Canvas spec pointed at a front host).
 */

import { describe, expect, test } from 'vitest'
import {
  CATALOG_VERIFIED_AT,
  COMMON_SERVICES,
  findUniversity,
  resolveServices,
  resolveUniversity,
  searchUniversities,
  serviceTierIds,
  UNIVERSITIES
} from '../../../src/shared/universities'
import { normalizeHttpUrl } from '../../../src/shared/universities/courseLink'
import { DEFAULT_UNIVERSITY_SETTINGS } from '../../../src/shared/types/university'

const ALL_SERVICES = UNIVERSITIES.flatMap((university) =>
  university.services.map((service) => ({ university, service }))
)

describe('catalog shape', () => {
  test('covers the 18 schools the research doc verified', () => {
    expect(UNIVERSITIES).toHaveLength(18)
    for (const id of [
      'snu',
      'yonsei',
      'korea',
      'skku',
      'hanyang',
      'cau',
      'khu',
      'sogang',
      'ewha',
      'kaist',
      'postech',
      'konkuk',
      'dongguk',
      'pusan',
      'knu',
      'inha',
      'ajou',
      'sejong'
    ]) {
      expect(findUniversity(id), `missing university: ${id}`).not.toBeNull()
    }
  })

  test('university ids are unique', () => {
    const ids = UNIVERSITIES.map((university) => university.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('service ids are unique across the whole catalog', () => {
    const ids = ALL_SERVICES.map((entry) => entry.service.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  test('every service id is namespaced under its university id', () => {
    for (const { university, service } of ALL_SERVICES) {
      expect(
        service.id.startsWith(`${university.id}.`),
        `${service.id} is not namespaced under ${university.id}`
      ).toBe(true)
    }
  })

  test('every service URL is a well-formed http(s) URL', () => {
    for (const { service } of ALL_SERVICES) {
      expect(normalizeHttpUrl(service.url), `bad URL on ${service.id}`).not.toBeNull()
    }
  })

  test('every service has a short Korean label', () => {
    for (const { service } of ALL_SERVICES) {
      expect(service.label.trim().length).toBeGreaterThan(0)
      expect(service.label.length, `${service.id} label too long`).toBeLessThanOrEqual(12)
    }
  })

  test('every school carries the verification date', () => {
    for (const university of UNIVERSITIES) {
      expect(university.verifiedAt).toBe(CATALOG_VERIFIED_AT)
    }
  })

  test('every school has a homepage and an LMS entry point', () => {
    for (const university of UNIVERSITIES) {
      const kinds = university.services.map((service) => service.kind)
      expect(kinds, `${university.id} has no homepage`).toContain('homepage')
      expect(kinds, `${university.id} has no lms`).toContain('lms')
    }
  })
})

describe('common services', () => {
  test('ids live in the common. namespace and never collide with a preset', () => {
    const presetIds = new Set(ALL_SERVICES.map((entry) => entry.service.id))
    const ids = COMMON_SERVICES.map((service) => service.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id.startsWith('common.'), `${id} is not in the common. namespace`).toBe(true)
      expect(presetIds.has(id), `${id} collides with a preset`).toBe(false)
    }
  })

  test('every common service has an https URL and a short label', () => {
    for (const service of COMMON_SERVICES) {
      expect(service.url.startsWith('https://'), service.id).toBe(true)
      expect(normalizeHttpUrl(service.url), `bad URL on ${service.id}`).not.toBeNull()
      expect(service.label.length, `${service.id} label too long`).toBeLessThanOrEqual(12)
    }
  })

  test('에브리타임 ships as a primary, embedded community link', () => {
    const everytime = COMMON_SERVICES.find((service) => service.id === 'common.everytime')
    expect(everytime?.kind).toBe('community')
    expect(everytime?.secondary).toBeUndefined()
    expect(everytime?.opensExternally).toBeUndefined()
  })
})

describe('embedded-browser blocks', () => {
  const externalIds = ALL_SERVICES.filter(
    (entry) => entry.service.opensExternally === true
  ).map((entry) => entry.service.id)

  test('every external-only service explains why', () => {
    for (const { service } of ALL_SERVICES) {
      if (service.opensExternally === true) {
        expect(
          service.externalReason,
          `${service.id} is external without a reason`
        ).toBeDefined()
      } else {
        expect(service.externalReason).toBeUndefined()
      }
    }
  })

  test('UA-sniffing portals that fail closed are external-only', () => {
    // 연세대 포털 / KAIST 수강신청 both end browserCheck.js with
    // `default: returnVal = false`; 서강대 SAINT answers "iView를 열 수 없습니다".
    for (const id of ['yonsei.portal', 'kaist.registration', 'sogang.portal']) {
      expect(externalIds, `${id} must open externally`).toContain(id)
    }
  })

  test('native-plugin sites are external-only', () => {
    // 아주대 AIMS2 is NPAPI/ActiveX; 세종대 포털 loads INCA nProtect, which
    // does not error — it simply never submits the login form.
    for (const id of [
      'ajou.aims',
      'sejong.portal',
      'korea.cert',
      'postech.cert',
      'inha.cert'
    ]) {
      expect(externalIds, `${id} must open externally`).toContain(id)
    }
  })

  test('Google/Microsoft-backed webmail is external-only', () => {
    for (const id of [
      'snu.mail',
      'skku.mail',
      'hanyang.mail',
      'ewha.mail',
      'inha.mail',
      'ajou.mail',
      'cau.mail',
      'konkuk.mail',
      'postech.mail',
      'sejong.mail'
    ]) {
      expect(externalIds, `${id} must open externally`).toContain(id)
    }
  })

  test('self-hosted webmail stays inside the app', () => {
    // Not every 웹메일 is federated: these are the school's own systems.
    for (const id of [
      'kaist.mail',
      'korea.mail',
      'khu.mail',
      'yonsei.mail',
      'dongguk.mail',
      'pusan.mail',
      'knu.mail'
    ]) {
      expect(externalIds, `${id} should stay embedded`).not.toContain(id)
    }
  })
})

describe('course deep links', () => {
  test('15 of 18 schools are Canvas or Moodle (the duopoly)', () => {
    const platforms = UNIVERSITIES.map(
      (university) => university.courseLink?.platform ?? 'none'
    )
    const canvas = platforms.filter((platform) => platform === 'canvas').length
    const moodle = platforms.filter((platform) => platform === 'moodle').length

    expect(canvas).toBe(7)
    expect(moodle).toBe(8)
    expect(canvas + moodle).toBe(15)
  })

  test('every school has a course-link spec, anchored and single-capture', () => {
    for (const university of UNIVERSITIES) {
      const spec = university.courseLink
      expect(spec, `${university.id} has no courseLink`).toBeDefined()
      if (spec === undefined) continue
      expect(spec.idPattern.startsWith('^')).toBe(true)
      expect(spec.template).toContain('{id}')
      expect(spec.hint.trim().length).toBeGreaterThan(0)
      expect(new RegExp(`${spec.idPattern}|`).exec('')?.length).toBe(2)
    }
  })

  test('서울대 points at the Canvas 강의실, not the eTL catalog', () => {
    const spec = findUniversity('snu')?.courseLink
    expect(spec?.platform).toBe('canvas')
    expect(spec?.template).toBe('https://myetl.snu.ac.kr/courses/{id}')
    expect(spec?.idPattern).not.toContain('etl\\.snu\\.ac\\.kr/course/view')
  })

  test('iLOS and Blackboard schools are flagged unreliable (베타)', () => {
    for (const id of ['sogang', 'konkuk', 'ajou']) {
      expect(findUniversity(id)?.courseLink?.reliable, id).toBe(false)
    }
  })
})

describe('search', () => {
  test('finds 서울대 by 한글 alias, English name and domain', () => {
    for (const query of ['서울대', 'SNU', 'seoul national', 'snu.ac.kr']) {
      expect(
        searchUniversities(query).map((university) => university.id),
        query
      ).toContain('snu')
    }
  })

  test('ignores spacing and case', () => {
    expect(searchUniversities('  kaist ').map((u) => u.id)).toContain('kaist')
    expect(searchUniversities('seoulnational').map((u) => u.id)).toContain('snu')
  })

  test('an empty query returns the whole catalog', () => {
    expect(searchUniversities('   ')).toHaveLength(UNIVERSITIES.length)
  })

  test('an unknown school yields nothing (→ 직접 추가)', () => {
    expect(searchUniversities('한밭대학교')).toHaveLength(0)
  })
})

describe('resolveUniversity / resolveServices', () => {
  test('no school chosen yet resolves to null', () => {
    expect(resolveUniversity(DEFAULT_UNIVERSITY_SETTINGS)).toBeNull()
    expect(resolveUniversity(null)).toBeNull()
  })

  test('a preset id resolves to its catalog entry', () => {
    expect(
      resolveUniversity({ ...DEFAULT_UNIVERSITY_SETTINGS, universityId: 'kaist' })?.id
    ).toBe('kaist')
  })

  test('a custom id only resolves with a matching definition', () => {
    const custom = {
      id: 'custom:abc',
      nameKo: '한밭대학교',
      nameEn: '',
      aliases: [],
      domain: '',
      services: [],
      verifiedAt: CATALOG_VERIFIED_AT
    }
    expect(
      resolveUniversity({
        ...DEFAULT_UNIVERSITY_SETTINGS,
        universityId: 'custom:abc',
        customUniversity: custom
      })?.nameKo
    ).toBe('한밭대학교')
    expect(
      resolveUniversity({
        ...DEFAULT_UNIVERSITY_SETTINGS,
        universityId: 'custom:abc',
        customUniversity: null
      })
    ).toBeNull()
  })

  test('hidden ids drop out and overrides beat the preset both ways', () => {
    const snu = findUniversity('snu')
    const services = resolveServices(snu, {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu',
      hiddenServiceIds: ['snu.food'],
      openExternallyOverrides: {
        // A student who got Gmail working in-app can pull it back in…
        'snu.mail': false,
        // …and push a preset-embedded service out.
        'snu.registration': true
      }
    })

    expect(services.map((service) => service.id)).not.toContain('snu.food')
    expect(services.find((s) => s.id === 'snu.mail')?.opensExternally).toBe(false)
    expect(services.find((s) => s.id === 'snu.registration')?.opensExternally).toBe(
      true
    )
  })

  test('custom services render after presets and are marked as custom', () => {
    const services = resolveServices(findUniversity('snu'), {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu',
      customServices: [
        {
          id: 'snu.custom.lab',
          kind: 'other',
          label: '연구실',
          url: 'https://lab.snu.ac.kr/',
          verification: 'unverified'
        }
      ]
    })

    const last = services[services.length - 1]
    expect(last?.id).toBe('snu.custom.lab')
    expect(last?.isCustom).toBe(true)
    expect(services.filter((service) => service.isCustom)).toHaveLength(1)
  })

  test('common services sit after presets and before custom, non-secondary', () => {
    const snu = findUniversity('snu')
    const presetCount = snu?.services.length ?? 0
    const services = resolveServices(snu, {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu',
      customServices: [
        {
          id: 'snu.custom.lab',
          kind: 'other',
          label: '연구실',
          url: 'https://lab.snu.ac.kr/',
          verification: 'unverified'
        }
      ]
    })

    const everytime = services[presetCount]
    expect(everytime?.id).toBe('common.everytime')
    expect(everytime?.secondary).toBe(false)
    expect(everytime?.isCustom).toBe(false)
    expect(everytime?.opensExternally).toBe(false)
    expect(services[presetCount + 1]?.id).toBe('snu.custom.lab')
  })

  test('resolved services carry the preset tier when nothing overrides it', () => {
    const services = resolveServices(findUniversity('snu'), {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu'
    })
    expect(services.find((s) => s.id === 'snu.portal')?.secondary).toBe(false)
    expect(services.find((s) => s.id === 'snu.food')?.secondary).toBe(true)
  })

  test('secondaryOverrides promote and demote across the 더보기 line', () => {
    const services = resolveServices(findUniversity('snu'), {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu',
      secondaryOverrides: { 'snu.food': false, 'snu.portal': true }
    })

    expect(services.find((s) => s.id === 'snu.food')?.secondary).toBe(false)
    expect(services.find((s) => s.id === 'snu.portal')?.secondary).toBe(true)

    const tiers = serviceTierIds(services)
    expect(tiers.primary).toContain('snu.food')
    expect(tiers.primary).not.toContain('snu.portal')
    expect(tiers.secondary).toContain('snu.portal')
    expect(tiers.primary.length + tiers.secondary.length).toBe(services.length)
  })

  test('serviceOrder reorders the list and hidden ids still drop out', () => {
    const services = resolveServices(findUniversity('snu'), {
      ...DEFAULT_UNIVERSITY_SETTINGS,
      universityId: 'snu',
      serviceOrder: ['common.everytime', 'snu.food', 'snu.mail', 'does.not.exist'],
      hiddenServiceIds: ['snu.food']
    })

    const ids = services.map((service) => service.id)
    expect(ids.slice(0, 2)).toEqual(['common.everytime', 'snu.mail'])
    expect(ids).not.toContain('snu.food')
    expect(ids).not.toContain('does.not.exist')
    expect(ids[2]).toBe('snu.portal')
  })
})
