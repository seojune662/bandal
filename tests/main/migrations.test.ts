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

  test('records migration 001 in the migrations table', () => {
    // Arrange (db migrated in beforeEach) / Act
    const rows = ctx.db
      .prepare('SELECT version, name FROM migrations ORDER BY version')
      .all() as { version: number; name: string }[]

    // Assert
    expect(rows).toEqual([{ version: 1, name: 'initial-schema' }])
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
    expect(count.n).toBe(1)
  })
})
