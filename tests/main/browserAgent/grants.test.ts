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
  test('interact and download imply read, never the reverse', () => {
    expect(capabilitySatisfies('interact', 'read')).toBe(true)
    expect(capabilitySatisfies('download', 'read')).toBe(true)
    expect(capabilitySatisfies('read', 'interact')).toBe(false)
    expect(capabilitySatisfies('read', 'download')).toBe(false)
  })

  test('interact does not imply download, nor the reverse', () => {
    // Clicking a page and pulling files off it are separate decisions.
    expect(capabilitySatisfies('interact', 'download')).toBe(false)
    expect(capabilitySatisfies('download', 'interact')).toBe(false)
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

  test('a read grant does not authorise interaction', () => {
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
    ).toBeNull()
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
