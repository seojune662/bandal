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
      { version: 3, name: 'course-folder-source' }
    ])
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

  test('is idempotent when run twice on the same database', () => {
    // Act
    runMigrations(ctx.db)

    // Assert
    const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as {
      n: number
    }
    expect(count.n).toBe(3)
  })
})
