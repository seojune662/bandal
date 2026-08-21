import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createChatRepo,
  type ChatRepo
} from '../../../src/main/features/agent/chatRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-1'

function insertCourse(ctx: TestDb): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(COURSE_ID, 'Course', COURSE_ID, '#000', '/tmp/course-1', now, now)
}

describe('chatRepo permission grants', () => {
  let ctx: TestDb
  let repo: ChatRepo

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx)
    repo = createChatRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('lists grant details and soft-removes a grant from active listings', () => {
    repo.addGrant(COURSE_ID, 'Write')
    const [grant] = repo.listGrantDetails(COURSE_ID)

    expect(grant).toMatchObject({ rule: 'Write' })
    expect(grant?.id).toEqual(expect.any(String))
    expect(grant?.createdAt).toEqual(expect.any(String))

    repo.removeGrant(grant!.id)

    expect(repo.listGrants(COURSE_ID)).toEqual([])
    expect(repo.listGrantDetails(COURSE_ID)).toEqual([])
    expect(
      ctx.db
        .prepare('SELECT deleted_at FROM permission_grants WHERE id = ?')
        .get(grant!.id)
    ).toEqual({ deleted_at: expect.any(String) })
  })
})
