import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityRepo,
  type ActivityRepo
} from '../../../src/main/features/context'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('activityRepo', () => {
  let ctx: TestDb
  let repo: ActivityRepo
  let courseId: string

  beforeEach(() => {
    ctx = createTestDb()
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir })
    courseId = courses.create({ name: '운영체제', color: '#000' }).id
    repo = createActivityRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('recent returns events newest-first', () => {
    const first = repo.record({
      courseId,
      kind: 'material-opened',
      summary: '첫 번째'
    })
    const second = repo.record({
      courseId,
      kind: 'note-edited',
      summary: '두 번째'
    })
    const third = repo.record({
      courseId,
      kind: 'question-asked',
      summary: '세 번째'
    })
    const setTime = ctx.db.prepare(
      'UPDATE activity_events SET created_at = ? WHERE id = ?'
    )
    setTime.run('2026-01-01T00:00:01.000Z', first.id)
    setTime.run('2026-01-01T00:00:03.000Z', second.id)
    setTime.run('2026-01-01T00:00:02.000Z', third.id)

    expect(repo.recent(courseId).map((event) => event.summary)).toEqual([
      '두 번째',
      '세 번째',
      '첫 번째'
    ])
  })

  test('record turns the summary into one line and truncates it to 300 characters', () => {
    const event = repo.record({
      courseId,
      kind: 'study-tool-run',
      summary: `  앞줄\n${'가'.repeat(400)}  `
    })

    expect(event.summary).not.toContain('\n')
    expect(Array.from(event.summary)).toHaveLength(300)
  })

  test('prune retains only the newest 500 events for the course', () => {
    const insert = ctx.db.prepare(
      `INSERT INTO activity_events
         (id, course_id, kind, rel_path, summary, created_at)
       VALUES (?, ?, 'material-opened', NULL, ?, ?)`
    )
    ctx.db.transaction(() => {
      for (let index = 0; index < 510; index += 1) {
        insert.run(
          `event-${index}`,
          courseId,
          `event ${index}`,
          new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
        )
      }
    })()

    repo.prune(courseId)

    const rows = ctx.db
      .prepare(
        `SELECT id FROM activity_events
         WHERE course_id = ? ORDER BY created_at ASC`
      )
      .all(courseId) as { id: string }[]
    expect(rows).toHaveLength(500)
    expect(rows[0]?.id).toBe('event-10')
    expect(rows.at(-1)?.id).toBe('event-509')
  })
})
