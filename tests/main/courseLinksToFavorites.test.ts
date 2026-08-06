/**
 * Migration 8 — course_links → favorites.
 *
 * 링크 and 즐겨찾기 collapse into one concept, so existing LMS shortcuts have
 * to survive the move. This is real user data (a student's 강의실 links), so
 * the migration is tested directly rather than trusted: it must be idempotent,
 * must not drop the source table, and must not clobber favorites the user
 * already made.
 *
 * The migration reads rows that exist BEFORE it runs, so each test seeds
 * course_links at the schema state just after migration 7 and then applies
 * the pending ones.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { migrations, runMigrations } from '../../src/main/db/migrations'
import { createTestDb, type TestDb } from './helpers/testDb'

const COURSE_LINKS_MIGRATION = 8

interface FavoriteRow {
  course_id: string | null
  label: string
  descriptor_json: string
  sort_order: number
}

function migrateUpTo(ctx: TestDb, version: number): void {
  ctx.db.exec('DELETE FROM migrations')
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version > version) break
    ctx.db
      .prepare('INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString())
  }
}

function seedCourse(ctx: TestDb, id: string): void {
  const now = new Date().toISOString()
  ctx.db
    .prepare(
      `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                            sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '#000', ?, 0, 0, ?, ?)`
    )
    .run(id, `과목 ${id}`, id, `/tmp/${id}`, now, now)
}

function seedLink(ctx: TestDb, courseId: string, label: string, url: string, order = 0): void {
  const now = new Date().toISOString()
  ctx.db
    .prepare(
      `INSERT INTO course_links
         (id, course_id, label, url, raw_url, kind, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'lms', ?, ?, ?)`
    )
    .run(`link-${label}`, courseId, label, url, url, order, now, now)
}

function favorites(ctx: TestDb): FavoriteRow[] {
  return ctx.db
    .prepare(
      `SELECT course_id, label, descriptor_json, sort_order
         FROM favorites WHERE deleted_at IS NULL ORDER BY sort_order`
    )
    .all() as FavoriteRow[]
}

describe('migration 8 — course_links into favorites', () => {
  let ctx: TestDb

  beforeEach(() => {
    ctx = createTestDb()
    migrateUpTo(ctx, COURSE_LINKS_MIGRATION - 1)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('copies each link into favorites as a browser tab descriptor', () => {
    seedCourse(ctx, 'c1')
    seedLink(ctx, 'c1', 'eTL 강의실', 'https://etl.snu.ac.kr/course/view.php?id=1')

    runMigrations(ctx.db)

    const rows = favorites(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('eTL 강의실')
    expect(rows[0]?.course_id).toBe('c1')

    const descriptor = JSON.parse(rows[0]?.descriptor_json ?? '{}') as {
      kind: string
      payload: { initialUrl: string; tabId: string }
    }
    expect(descriptor.kind).toBe('browser')
    expect(descriptor.payload.initialUrl).toBe(
      'https://etl.snu.ac.kr/course/view.php?id=1'
    )
    // A browser tab's identity is its tabId, so one must be minted.
    expect(descriptor.payload.tabId).toMatch(/[0-9a-f-]{36}/)
  })

  test('leaves course_links intact so the change stays reversible', () => {
    seedCourse(ctx, 'c1')
    seedLink(ctx, 'c1', '강의실', 'https://example.com/a')

    runMigrations(ctx.db)

    const remaining = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM course_links')
      .get() as { n: number }
    expect(remaining.n).toBe(1)
  })

  test('is idempotent — re-running does not duplicate a link', () => {
    seedCourse(ctx, 'c1')
    seedLink(ctx, 'c1', '강의실', 'https://example.com/a')

    runMigrations(ctx.db)
    expect(favorites(ctx)).toHaveLength(1)

    // Force the migration to be considered pending again.
    ctx.db.prepare('DELETE FROM migrations WHERE version = ?').run(COURSE_LINKS_MIGRATION)
    runMigrations(ctx.db)

    expect(favorites(ctx)).toHaveLength(1)
  })

  test('does not clobber a favorite the user already created', () => {
    seedCourse(ctx, 'c1')
    seedLink(ctx, 'c1', '강의실', 'https://example.com/a')
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO favorites (id, course_id, label, descriptor_json, sort_order, created_at, updated_at)
         VALUES ('fav-existing', 'c1', '내 필기', ?, 0, ?, ?)`
      )
      .run(
        JSON.stringify({ kind: 'note', payload: { courseId: 'c1', relPath: 'a.md' } }),
        now,
        now
      )

    runMigrations(ctx.db)

    const rows = favorites(ctx)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.label)).toContain('내 필기')
    expect(rows.map((row) => row.label)).toContain('강의실')
    // Appended after the existing one rather than colliding on sort_order.
    expect(new Set(rows.map((row) => row.sort_order)).size).toBe(2)
  })

  test('skips a url already present as a favorite for that course', () => {
    seedCourse(ctx, 'c1')
    seedLink(ctx, 'c1', '강의실', 'https://example.com/a')
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO favorites (id, course_id, label, descriptor_json, sort_order, created_at, updated_at)
         VALUES ('fav-dup', 'c1', '이미 있음', ?, 0, ?, ?)`
      )
      .run(
        JSON.stringify({
          kind: 'browser',
          payload: { tabId: 'existing', initialUrl: 'https://example.com/a' }
        }),
        now,
        now
      )

    runMigrations(ctx.db)

    expect(favorites(ctx)).toHaveLength(1)
  })

  test('keeps links from different courses separate', () => {
    seedCourse(ctx, 'c1')
    seedCourse(ctx, 'c2')
    seedLink(ctx, 'c1', 'A', 'https://example.com/a')
    seedLink(ctx, 'c2', 'B', 'https://example.com/b')

    runMigrations(ctx.db)

    const rows = favorites(ctx)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.label === 'A')?.course_id).toBe('c1')
    expect(rows.find((row) => row.label === 'B')?.course_id).toBe('c2')
  })

  test('is a no-op when there are no links', () => {
    seedCourse(ctx, 'c1')
    expect(() => runMigrations(ctx.db)).not.toThrow()
    expect(favorites(ctx)).toHaveLength(0)
  })
})
