import Database from 'better-sqlite3'
import type { MaterialPathLock } from './materialPathJournal'

/** Dedicated rollback-journal DB: never WAL and never the user's data DB.
 * The sync projector uses this same path and BEGIN EXCLUSIVE protocol.
 * SQLite/OS release the lock if a process exits or is killed. */
export function createMaterialPathLock(path: string, open: (path: string) => Database.Database =
  path => new Database(path, { timeout: 0 })): MaterialPathLock {
  return { tryAcquire() {
    const lock = open(path)
    try { lock.exec('BEGIN EXCLUSIVE') }
    catch (error) {
      lock.close()
      if ((error as { code?: string }).code === 'SQLITE_BUSY' || (error as { code?: string }).code === 'SQLITE_LOCKED') return undefined
      throw error
    }
    let released = false
    return () => { if (released) return; released = true; try { lock.exec('ROLLBACK') } finally { lock.close() } }
  } }
}

/** Path mutations and migrations can overlap a brief project read or creation. Wait
 * before starting the work; never replay a mutation that has already begun. */
export async function withMaterialPathLockWait<T>(lock: MaterialPathLock, action: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; timeoutError?: () => Error } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const release = lock.tryAcquire()
    if (release) {
      try { return await action() } finally { release() }
    }
    if (attempt >= (options.attempts ?? 100)) throw options.timeoutError?.() ?? new Error('자료 동기화가 계속 진행 중이라 기존 노트 이전을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 50))
  }
}
