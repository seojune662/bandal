import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createSeenRepo,
  itemKey,
  type SeenRepo
} from '../../../src/main/features/browserAgent/seenRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('itemKey', () => {
  test('uses the platform id when there is one', () => {
    expect(itemKey('7', '휴강 공지', null)).toBe('7')
    expect(itemKey('  7  ', 'x', null)).toBe('7')
  })

  test('falls back to a stable hash of title and date', () => {
    const a = itemKey(null, '휴강 공지', '2026-08-19T00:00:00Z')
    const b = itemKey('', '휴강 공지', '2026-08-19T00:00:00Z')
    expect(a).toBe(b)
    expect(a).toHaveLength(32)
  })

  test('a retitled item is a different item', () => {
    // Better to re-report once than to hide a changed announcement.
    expect(itemKey(null, '휴강', '2026-08-19')).not.toBe(
      itemKey(null, '보강', '2026-08-19')
    )
  })
})

describe('seenRepo', () => {
  let ctx: TestDb
  let repo: SeenRepo

  const items = (...titles: string[]) =>
    titles.map((title) => ({ key: title, title }))

  beforeEach(() => {
    ctx = createTestDb()
    repo = createSeenRepo(ctx.db)
  })

  afterEach(() => ctx.cleanup())

  test('the first diff on an empty ledger reports everything', () => {
    expect(
      repo.diffAndRecord({
        courseId: 'ds',
        listKey: 'announcements',
        items: items('a', 'b')
      })
    ).toHaveLength(2)
  })

  test('a second diff reports only what is new', () => {
    repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a', 'b')
    })
    const fresh = repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a', 'b', 'c')
    })
    expect(fresh.map((item) => item.key)).toEqual(['c'])
  })

  test('reading and marking are one call, so nothing is reported twice', () => {
    repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a')
    })
    expect(
      repo.diffAndRecord({
        courseId: 'ds',
        listKey: 'announcements',
        items: items('a')
      })
    ).toEqual([])
  })

  test('seeding records without reporting — the first look is not "new"', () => {
    repo.seed({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a', 'b')
    })
    expect(repo.has('ds', 'announcements')).toBe(true)
    expect(
      repo.diffAndRecord({
        courseId: 'ds',
        listKey: 'announcements',
        items: items('a', 'b')
      })
    ).toEqual([])
  })

  test('an item disappearing from the list does not un-see it', () => {
    // A deleted announcement must not come back as "new" if it is restored.
    repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a', 'b')
    })
    repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('b')
    })
    expect(
      repo.diffAndRecord({
        courseId: 'ds',
        listKey: 'announcements',
        items: items('a', 'b')
      })
    ).toEqual([])
  })

  test('lists and courses are independent', () => {
    repo.diffAndRecord({
      courseId: 'ds',
      listKey: 'announcements',
      items: items('a')
    })
    expect(
      repo.diffAndRecord({
        courseId: 'ds',
        listKey: 'assignments',
        items: items('a')
      })
    ).toHaveLength(1)
    expect(
      repo.diffAndRecord({
        courseId: 'algo',
        listKey: 'announcements',
        items: items('a')
      })
    ).toHaveLength(1)
  })

  test('clearing a course forgets only that course', () => {
    repo.seed({ courseId: 'ds', listKey: 'a', items: items('x') })
    repo.seed({ courseId: 'algo', listKey: 'a', items: items('x') })
    repo.clear('ds')
    expect(repo.has('ds', 'a')).toBe(false)
    expect(repo.has('algo', 'a')).toBe(true)
  })

  test('an empty list is not an error', () => {
    expect(
      repo.diffAndRecord({ courseId: 'ds', listKey: 'a', items: [] })
    ).toEqual([])
  })
})
