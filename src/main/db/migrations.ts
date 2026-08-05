/**
 * Schema migrations (STUB — M0).
 *
 * Strategy for M1: `PRAGMA user_version` tracks the schema version; each
 * migration bumps it inside a transaction. Migration 1 executes schema.sql.
 */

import type { Database } from 'better-sqlite3'

export interface Migration {
  version: number
  /** Human-readable label for logs. */
  name: string
  up: (db: Database) => void
}

export const migrations: Migration[] = [
  // M1: { version: 1, name: 'initial-schema', up: (db) => db.exec(readSchemaSql()) }
]

/** Applies pending migrations in order. No-op stub in M0. */
export function runMigrations(_db: Database): void {
  // M1: read user_version, apply migrations with version > current inside
  // a transaction, then set user_version.
}
