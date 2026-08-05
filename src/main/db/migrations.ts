/**
 * Schema migrations.
 *
 * A `migrations` table records every applied migration (numbered, with a
 * human-readable name and timestamp). `runMigrations` applies pending
 * migrations in version order, each inside a transaction.
 *
 * Migration 001 executes schema.sql (the frozen C5 v1 schema). Later
 * milestones append new entries — never edit an applied migration.
 */

import type { Database } from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

export interface Migration {
  version: number
  /** Human-readable label for logs. */
  name: string
  up: (db: Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) => {
      db.exec(schemaSql)
    }
  },
  {
    // [M4-H] Session resume record: the CLI transcript path can diverge from
    // cli_session_id across CLI versions, and respawning needs the original
    // launch configuration — persist both alongside the session row.
    version: 2,
    name: 'agent-session-resume-record',
    up: (db) => {
      db.exec(
        `ALTER TABLE agent_sessions ADD COLUMN transcript_path TEXT;
         ALTER TABLE agent_sessions ADD COLUMN launch_config_json TEXT;`
      )
    }
  },
  {
    // [M7] Folder-based courses: a course folder may now be an arbitrary
    // path the user pointed at. `source` distinguishes the folder Bandal
    // created under the data root ('managed') from a linked one ('linked');
    // every pre-existing row is managed by definition. The index backs the
    // duplicate-registration lookup by folder_path.
    version: 3,
    name: 'course-folder-source',
    up: (db) => {
      db.exec(
        `ALTER TABLE courses ADD COLUMN source TEXT NOT NULL DEFAULT 'managed';
         CREATE INDEX IF NOT EXISTS idx_courses_folder_path
           ON courses (folder_path) WHERE deleted_at IS NULL;`
      )
    }
  },
  {
    // [M8] Per-course shortcuts (docs/university-sites.md §6.4): the LMS
    // 강의실 page for this course, plus any other URL the student pins.
    // `raw_url` keeps exactly what was pasted so normalising to the course
    // root is always reversible; `lms_course_id` is set only when the URL
    // matched the school's CourseLinkSpec, which lets us rebuild the link if
    // the school moves hosts. Additive — nothing existing is touched.
    version: 4,
    name: 'course-links',
    up: (db) => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS course_links (
           id            TEXT PRIMARY KEY,
           course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
           label         TEXT NOT NULL,
           url           TEXT NOT NULL,
           raw_url       TEXT NOT NULL,
           kind          TEXT NOT NULL,
           lms_course_id TEXT,
           sort_order    INTEGER NOT NULL DEFAULT 0,
           created_at    TEXT NOT NULL,
           updated_at    TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_course_links_course
           ON course_links (course_id, sort_order);`
      )
    }
  }
]

/** Creates the bookkeeping table if needed and returns applied versions. */
function appliedVersions(db: Database): Set<number> {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`
  )
  const rows = db.prepare('SELECT version FROM migrations').all() as {
    version: number
  }[]
  return new Set(rows.map((row) => row.version))
}

/** Applies pending migrations in version order, each in a transaction. */
export function runMigrations(db: Database): void {
  const applied = appliedVersions(db)
  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((migration) => !applied.has(migration.version))

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db)
      db.prepare(
        'INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, new Date().toISOString())
    })
    apply()
    console.log(`[db] applied migration ${migration.version} (${migration.name})`)
  }
}
