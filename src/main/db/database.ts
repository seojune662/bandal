/**
 * SQLite database access (STUB — M0).
 *
 * M1 will open a better-sqlite3 database at
 * `join(app.getPath('userData'), 'bandal.db')` and run migrations.
 *
 * NOTE for implementers: better-sqlite3 is a native module compiled against
 * the Node ABI at install time. Before requiring it inside Electron's main
 * process, rebuild it for Electron (e.g. `pnpm exec electron-rebuild -f -w
 * better-sqlite3` or via electron-builder's install-app-deps). It is
 * intentionally NOT imported in M0 so the dev app boots without a rebuild.
 */

import type { Database } from 'better-sqlite3'

let db: Database | null = null

/** Returns the open database. Throws until M1 implements initialization. */
export function getDatabase(): Database {
  if (db === null) {
    throw new Error('[db] Database not initialized (M0 stub — implemented in M1)')
  }
  return db
}

/** Opens the database and runs migrations. No-op stub in M0. */
export function initDatabase(): void {
  // M1: lazily require('better-sqlite3'), open userData/bandal.db,
  // then runMigrations(db) from ./migrations.
}

/** Closes the database if open. */
export function closeDatabase(): void {
  if (db !== null) {
    db.close()
    db = null
  }
}
