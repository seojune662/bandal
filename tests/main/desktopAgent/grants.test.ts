import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createDesktopGrantsRepo,
  DESKTOP_GRANT_DAYS,
  type DesktopGrantsRepo
} from '../../../src/main/features/desktopAgent/grants'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('desktop grants repo', () => {
  let ctx: TestDb
  let repo: DesktopGrantsRepo
  let clock: Date

  beforeEach(() => {
    ctx = createTestDb()
    clock = new Date('2026-08-21T00:00:00.000Z')
    repo = createDesktopGrantsRepo(ctx.db, () => clock)
  })

  afterEach(() => ctx.cleanup())

  test('grants one capability in one course for 30 days', () => {
    repo.grant('course-a', 'screen')

    const grant = repo.find('course-a', 'screen')
    expect(grant).not.toBeNull()
    expect(grant?.expiresAt).toBe('2026-09-20T00:00:00.000Z')
    expect(repo.find('course-a', 'clipboard')).toBeNull()
    expect(repo.find('course-b', 'screen')).toBeNull()
    expect(DESKTOP_GRANT_DAYS).toBe(30)
  })

  test('expired grants stop authorizing and disappear from the live list', () => {
    repo.grant('course-a', 'screen', 1)
    clock = new Date('2026-08-22T00:00:00.001Z')

    expect(repo.find('course-a', 'screen')).toBeNull()
    expect(repo.list('course-a')).toEqual([])
  })

  test('revokes one capability or every capability in a course', () => {
    repo.grant('course-a', 'screen')
    repo.grant('course-a', 'clipboard')
    repo.grant('course-b', 'screen')

    expect(repo.revoke('course-a', 'screen')).toBe(1)
    expect(repo.find('course-a', 'screen')).toBeNull()
    expect(repo.find('course-a', 'clipboard')).not.toBeNull()
    expect(repo.revoke('course-a')).toBe(1)
    expect(repo.list('course-a')).toEqual([])
    expect(repo.find('course-b', 'screen')).not.toBeNull()
  })

  test('touch records the last time a grant was used', () => {
    repo.grant('course-a', 'screen')
    const id = repo.find('course-a', 'screen')?.id
    expect(id).toBeDefined()
    expect(repo.list('course-a')[0]?.lastUsedAt).toBeNull()

    clock = new Date('2026-08-23T12:30:00.000Z')
    repo.touch(id!)
    expect(repo.list('course-a')[0]?.lastUsedAt).toBe(
      '2026-08-23T12:30:00.000Z'
    )
  })
})
