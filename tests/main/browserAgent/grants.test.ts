import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  capabilitySatisfies,
  createGrantsRepo,
  normalizeOrigin,
  type GrantsRepo
} from '../../../src/main/features/browserAgent/grants'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('normalizeOrigin', () => {
  test('keeps the port — 인하대 :8443 is a different service', () => {
    expect(normalizeOrigin('https://portal.inha.ac.kr:8443/x')).toBe(
      'https://portal.inha.ac.kr:8443'
    )
    expect(normalizeOrigin('https://portal.inha.ac.kr/x')).toBe(
      'https://portal.inha.ac.kr'
    )
  })

  test('rejects non-http schemes', () => {
    expect(normalizeOrigin('file:///etc/passwd')).toBeNull()
    expect(normalizeOrigin('nonsense')).toBeNull()
  })
})

describe('capabilitySatisfies', () => {
  test('one approval covers looking, clicking and fetching', () => {
    // These were three askable capabilities and read did NOT imply interact,
    // so one task across two origins produced FOUR prompts the student had no
    // way to tell apart. The grant now means "look at this site and move
    // around in it" — a single decision, asked once.
    for (const held of ['read', 'interact', 'download'] as const) {
      for (const needed of ['read', 'interact', 'download'] as const) {
        expect(capabilitySatisfies(held, needed), `${held}→${needed}`).toBe(true)
      }
    }
  })
})

describe('grantsRepo', () => {
  let ctx: TestDb
  let repo: GrantsRepo
  let clock: Date

  beforeEach(() => {
    ctx = createTestDb()
    clock = new Date('2026-08-20T00:00:00Z')
    repo = createGrantsRepo(ctx.db, () => clock)
  })

  afterEach(() => ctx.cleanup())

  test('a fresh grant covers its own origin and capability', () => {
    repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/courses/1',
      capability: 'read'
    })
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://myetl.snu.ac.kr/courses/999/files',
        capability: 'read'
      })
    ).not.toBeNull()
  })

  test('does not leak across origins, ports or courses', () => {
    repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read'
    })
    for (const probe of [
      { courseId: 'ds', url: 'https://other.snu.ac.kr/' },
      { courseId: 'ds', url: 'http://myetl.snu.ac.kr/' },
      { courseId: 'ds', url: 'https://myetl.snu.ac.kr:8443/' },
      { courseId: 'algo', url: 'https://myetl.snu.ac.kr/' }
    ]) {
      expect(
        repo.find({ ...probe, capability: 'read' }),
        JSON.stringify(probe)
      ).toBeNull()
    }
  })

  test('one approval authorises interaction on that site', () => {
    repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read'
    })
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://myetl.snu.ac.kr/',
        capability: 'interact'
      })
    ).not.toBeNull()
  })

  test('a course-wide grant covers a site the student never named', () => {
    repo.grant({ courseId: 'ds', url: '*', capability: 'interact' })
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://shine.snu.ac.kr/',
        capability: 'read'
      })
    ).not.toBeNull()
  })

  test('a course-wide grant does not leak into another course', () => {
    repo.grant({ courseId: 'ds', url: '*', capability: 'interact' })
    expect(
      repo.find({
        courseId: 'algo',
        url: 'https://shine.snu.ac.kr/',
        capability: 'read'
      })
    ).toBeNull()
  })

  test('an exact-site grant is preferred over the wildcard', () => {
    // So 설정 shows the student the specific decision they made, and touching
    // it stamps the row they would recognise.
    repo.grant({ courseId: 'ds', url: '*', capability: 'interact' })
    const exact = repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'interact'
    })
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://myetl.snu.ac.kr/',
        capability: 'read'
      })?.id
    ).toBe(exact?.id)
  })

  test('expires — there is no "forever"', () => {
    repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read',
      days: 30
    })
    clock = new Date('2026-09-20T00:00:01Z')
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://myetl.snu.ac.kr/',
        capability: 'read'
      })
    ).toBeNull()
  })

  test('revoking takes effect immediately', () => {
    const grant = repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read'
    })
    expect(grant).not.toBeNull()
    repo.revoke(grant!.id)
    expect(
      repo.find({
        courseId: 'ds',
        url: 'https://myetl.snu.ac.kr/',
        capability: 'read'
      })
    ).toBeNull()
  })

  test('a revoked grant stays listed, so the student can see it happened', () => {
    const grant = repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read'
    })
    repo.revoke(grant!.id)
    const listed = repo.list('ds')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.revokedAt).not.toBeNull()
  })

  test('records last use so a stale grant is visible in settings', () => {
    const grant = repo.grant({
      courseId: 'ds',
      url: 'https://myetl.snu.ac.kr/',
      capability: 'read'
    })
    expect(repo.list('ds')[0]?.lastUsedAt).toBeNull()
    repo.touch(grant!.id, new Date('2026-08-21T00:00:00Z'))
    expect(repo.list('ds')[0]?.lastUsedAt).toBe('2026-08-21T00:00:00.000Z')
  })

  test('refuses to grant on a non-http url', () => {
    expect(
      repo.grant({
        courseId: 'ds',
        url: 'file:///etc/passwd',
        capability: 'read'
      })
    ).toBeNull()
  })

  test('lists every course when asked for all', () => {
    repo.grant({ courseId: 'a', url: 'https://a.ac.kr/', capability: 'read' })
    repo.grant({ courseId: 'b', url: 'https://b.ac.kr/', capability: 'read' })
    expect(repo.list()).toHaveLength(2)
    expect(repo.list('a')).toHaveLength(1)
  })
})
