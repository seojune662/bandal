import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'
import { createTestDb, type TestDb } from './helpers/testDb'

describe('migrations', () => {
  let ctx: TestDb

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('records applied migrations in the migrations table', () => {
    // Arrange (db migrated in beforeEach) / Act
    const rows = ctx.db
      .prepare('SELECT version, name FROM migrations ORDER BY version')
      .all() as { version: number; name: string }[]

    // Assert
    expect(rows).toEqual([
      { version: 1, name: 'initial-schema' },
      { version: 2, name: 'agent-session-resume-record' },
      { version: 3, name: 'course-folder-source' },
      { version: 4, name: 'course-links' },
      { version: 5, name: 'phase2-group-links-and-cache' },
      { version: 6, name: 'pdf-drawings' },
      { version: 7, name: 'favorites' },
      { version: 8, name: 'course-links-into-favorites' },
      { version: 9, name: 'activity-events' },
      { version: 10, name: 'whiteboard-local-mirror' },
      { version: 11, name: 'personal-whiteboards' },
      { version: 12, name: 'board-task-kind-and-allday' },
      { version: 13, name: 'whiteboard-background' },
      { version: 14, name: 'whiteboard-pages' },
      { version: 15, name: 'agent-actions' },
      { version: 16, name: 'agent-session-titles' },
      { version: 17, name: 'course-groups' },
      { version: 18, name: 'media-progress' }
    ])
  })

  test('creates course_groups and courses.group_id (migration 017)', () => {
    // Arrange
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO course_groups (id, name, sort_order, created_at, updated_at)
         VALUES ('g1', '1학기', 0, ?, ?)`
      )
      .run(now, now)
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, group_id, created_at, updated_at)
         VALUES ('c1', '자료구조', 'ds', '#000', '/tmp/ds', 0, 0, 'g1', ?, ?)`
      )
      .run(now, now)

    // Act — a pre-017 style row written without group_id defaults to NULL.
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c2', '운영체제', 'os', '#000', '/tmp/os', 0, 1, ?, ?)`
      )
      .run(now, now)

    // Assert
    const grouped = ctx.db
      .prepare('SELECT group_id FROM courses WHERE id = ?')
      .get('c1') as { group_id: string | null }
    const ungrouped = ctx.db
      .prepare('SELECT group_id FROM courses WHERE id = ?')
      .get('c2') as { group_id: string | null }
    expect(grouped.group_id).toBe('g1')
    expect(ungrouped.group_id).toBeNull()
  })

  test('creates course_links with a cascading course FK (migration 004)', () => {
    // Arrange
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', '자료구조', 'ds', '#000', '/tmp/ds', 0, 0, ?, ?)`
      )
      .run(now, now)
    ctx.db
      .prepare(
        `INSERT INTO course_links (id, course_id, label, url, raw_url, kind,
                                   sort_order, created_at, updated_at)
         VALUES ('l1', 'c1', '강의실', 'https://myetl.snu.ac.kr/courses/1',
                 'https://myetl.snu.ac.kr/courses/1', 'lms-course', 0, ?, ?)`
      )
      .run(now, now)

    // Act — deleting the course must take its links with it.
    ctx.db.prepare('DELETE FROM courses WHERE id = ?').run('c1')

    // Assert
    const remaining = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM course_links')
      .get() as { n: number }
    expect(remaining.n).toBe(0)
  })

  test('adds courses.source defaulting to "managed" (migration 003)', () => {
    // Arrange
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', 'Legacy', 'legacy', '#000', '/tmp/legacy', 0, 0, ?, ?)`
      )
      .run(now, now)

    // Act — a row written without `source` (as pre-M7 code did).
    const row = ctx.db.prepare('SELECT source FROM courses WHERE id = ?').get('c1') as {
      source: string
    }

    // Assert
    expect(row.source).toBe('managed')
  })

  test('creates all schema v1 tables', () => {
    // Act
    const tables = (
      ctx.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name)

    // Assert
    for (const table of [
      'courses',
      'materials_index',
      'annotations',
      'board_tasks',
      'tabs_layout',
      'migrations'
    ]) {
      expect(tables).toContain(table)
    }
  })

  test('backfills conversation titles from the earliest user message (migration 016)', () => {
    // Arrange — a pre-016 session: title NULL, two user turns. Replaying the
    // migration is safe by design (PRAGMA guard), so deleting its bookkeeping
    // row and re-running is exactly the lost-bookkeeping case it must survive.
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', 'OS', 'os', '#000', '/tmp/os', 0, 0, ?, ?)`
      )
      .run(now, now)
    ctx.db
      .prepare(
        `INSERT INTO agent_sessions (id, course_id, provider, status, created_at, updated_at)
         VALUES ('s1', 'c1', 'claude-code', 'idle', ?, ?)`
      )
      .run(now, now)
    const insertMessage = ctx.db.prepare(
      `INSERT INTO messages (id, course_id, session_id, role, turn_seq, created_at, updated_at)
       VALUES (?, 'c1', 's1', 'user', ?, ?, ?)`
    )
    const insertBlock = ctx.db.prepare(
      `INSERT INTO message_blocks (id, message_id, ord, kind, payload_json, created_at, updated_at)
       VALUES (?, ?, 0, 'text', ?, ?, ?)`
    )
    insertMessage.run('m2', 2, now, now)
    insertBlock.run('b2', 'm2', JSON.stringify({ text: 'later question' }), now, now)
    insertMessage.run('m1', 1, now, now)
    insertBlock.run(
      'b1',
      'm1',
      JSON.stringify({ text: `  스케줄링\n알고리즘   설명해줘  ${'x'.repeat(80)}` }),
      now,
      now
    )
    ctx.db.prepare('DELETE FROM migrations WHERE version = 16').run()

    // Act
    runMigrations(ctx.db)

    // Assert — earliest turn wins, whitespace collapsed, 60 chars max.
    const row = ctx.db
      .prepare('SELECT title FROM agent_sessions WHERE id = ?')
      .get('s1') as { title: string }
    expect(row.title).toBe(
      `스케줄링 알고리즘 설명해줘 ${'x'.repeat(80)}`.slice(0, 60)
    )
    expect(row.title).toHaveLength(60)
  })

  test('is idempotent when run twice on the same database', () => {
    // Act
    runMigrations(ctx.db)

    // Assert
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as {
      n: number
    }
    expect(count.n).toBe(18)
  })
})
