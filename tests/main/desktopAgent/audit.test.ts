import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createDesktopAuditRepo,
  type DesktopAuditRepo
} from '../../../src/main/features/desktopAgent/audit'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('desktop audit repo', () => {
  let ctx: TestDb
  let repo: DesktopAuditRepo
  let clock: Date

  beforeEach(() => {
    ctx = createTestDb()
    clock = new Date('2026-08-21T00:00:00.000Z')
    repo = createDesktopAuditRepo(ctx.db, () => clock)
  })

  afterEach(() => ctx.cleanup())

  test('records course, conversation, action and safe target metadata', () => {
    repo.record({
      courseId: 'course-a',
      conversationId: 'conversation-a',
      action: 'screenshot',
      target: 'display-1',
      detail: '화면 캡처 완료'
    })

    expect(repo.recent('course-a')).toMatchObject([
      {
        courseId: 'course-a',
        conversationId: 'conversation-a',
        action: 'screenshot',
        target: 'display-1',
        detail: '화면 캡처 완료',
        createdAt: '2026-08-21T00:00:00.000Z'
      }
    ])
  })

  test('returns only the requested course, newest first, with a limit', () => {
    repo.record({
      courseId: 'course-a',
      conversationId: 'one',
      action: 'frontmost',
      target: 'Finder',
      detail: '첫 기록'
    })
    clock = new Date('2026-08-21T00:01:00.000Z')
    repo.record({
      courseId: 'course-a',
      conversationId: 'two',
      action: 'clipboard',
      target: 'clipboard',
      detail: '둘째 기록'
    })
    repo.record({
      courseId: 'course-b',
      conversationId: 'other',
      action: 'windows',
      target: 'display-2',
      detail: '다른 과목'
    })

    expect(repo.recent('course-a', 1)).toMatchObject([
      { conversationId: 'two', action: 'clipboard' }
    ])
  })

  test('redacts long numeric identifiers before persisting them', () => {
    repo.record({
      courseId: 'course-a',
      conversationId: 'conversation-a',
      action: 'denied',
      target: 'Student 202612345',
      detail: '학번 202612345 때문에 거부'
    })

    const entry = repo.recent('course-a')[0]
    expect(entry?.target).not.toContain('202612345')
    expect(entry?.detail).not.toContain('202612345')
  })

  test('prunes entries older than 90 days and keeps the cutoff boundary', () => {
    const at = new Date('2026-08-21T00:00:00.000Z')
    const day = 24 * 60 * 60 * 1000
    clock = new Date(at.getTime() - 91 * day)
    repo.record({
      courseId: 'course-a',
      conversationId: 'expired',
      action: 'screenshot',
      target: 'display-1',
      detail: '91일 전'
    })
    clock = new Date(at.getTime() - 90 * day)
    repo.record({
      courseId: 'course-a',
      conversationId: 'boundary',
      action: 'windows',
      target: 'display-1',
      detail: '정확히 90일 전'
    })

    repo.prune(at)

    expect(repo.recent('course-a').map((entry) => entry.conversationId)).toEqual([
      'boundary'
    ])
  })
})
