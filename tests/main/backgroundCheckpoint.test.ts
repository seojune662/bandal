import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
import { startBackgroundCheckpoints } from '../../src/main/db/backgroundCheckpoint'
import { createTestDb, type TestDb } from './helpers/testDb'
let ctx: TestDb
beforeEach(() => { ctx = createTestDb(); vi.useFakeTimers() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); ctx.cleanup() })

test('moves checkpoints to the supplied background lane without reducing durability', async () => {
  const sync = ctx.db.pragma('synchronous', { simple: true })
  const previous = ctx.db.pragma('wal_autocheckpoint', { simple: true })
  const Sqlite = createRequire(import.meta.url)('better-sqlite3-node') as typeof import('better-sqlite3')
  const checkpoint = vi.fn(async () => {
    const other = new Sqlite(ctx.db.name)
    try { other.pragma('wal_checkpoint(PASSIVE)') } finally { other.close() }
  })
  const task = startBackgroundCheckpoints(ctx.db, checkpoint, error => { throw error })
  expect(ctx.db.pragma('wal_autocheckpoint', { simple: true })).toBe(0)
  expect(ctx.db.pragma('synchronous', { simple: true })).toBe(sync)
  ctx.db.exec('CREATE TABLE checkpoint_probe (value TEXT); INSERT INTO checkpoint_probe VALUES (\'saved\')')
  task.request()
  task.request()
  await vi.advanceTimersByTimeAsync(0)
  expect(checkpoint).toHaveBeenCalledTimes(1)
  expect(ctx.db.prepare('SELECT value FROM checkpoint_probe').get()).toEqual({ value: 'saved' })
  await vi.advanceTimersByTimeAsync(15_000)
  expect(checkpoint).toHaveBeenCalledTimes(2)
  task.dispose()
  expect(ctx.db.pragma('wal_autocheckpoint', { simple: true })).toBe(previous)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(checkpoint).toHaveBeenCalledTimes(2)
})

test('coalesces slow checkpoints and retries a failed worker on the next interval', async () => {
  let reject!: (error: Error) => void
  const checkpoint = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail })).mockResolvedValue(null)
  const onError = vi.fn()
  const task = startBackgroundCheckpoints(ctx.db, checkpoint, onError)
  task.request()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(checkpoint).toHaveBeenCalledTimes(1)
  reject(new Error('worker gone'))
  await vi.advanceTimersByTimeAsync(15_000)
  expect(onError).toHaveBeenCalledTimes(1)
  expect(checkpoint).toHaveBeenCalledTimes(2)
  task.dispose()
})
