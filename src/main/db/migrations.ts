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
