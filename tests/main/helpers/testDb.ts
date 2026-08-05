/**
 * Test database helper.
 *
 * ABI note: the production `better-sqlite3` copy in node_modules is rebuilt
 * for the ELECTRON ABI by the `postinstall` script (electron-builder
 * install-app-deps), so it cannot be require()d under plain Node. Vitest
 * runs under Node, so tests use `better-sqlite3-node` — a pnpm alias
 * (npm:better-sqlite3@^12) that stays on the Node ABI because
 * install-app-deps only rebuilds production dependencies. The API is
 * identical, so repos + migrations run unmodified against it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { runMigrations } from '../../../src/main/db/migrations'

const nodeRequire = createRequire(import.meta.url)

export interface TestDb {
  db: Database
  /** Temp dir usable as dataRoot / scratch space for the test. */
  dir: string
  cleanup: () => void
}

/** Opens a migrated SQLite DB in a fresh temp dir. */
export function createTestDb(): TestDb {
  const BetterSqlite3 = nodeRequire('better-sqlite3-node') as typeof import('better-sqlite3')
  const dir = mkdtempSync(join(tmpdir(), 'bandal-test-'))
  const db = new BetterSqlite3(join(dir, 'test.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return {
    db,
    dir,
    cleanup: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
