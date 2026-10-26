import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '../../lib/atomicWrite'
import { retryWindowsFileOperation, type WindowsFileRetryOptions } from '../../lib/retryWindowsFileOperation'

export interface NoteFileWrite { target: string; bytes: Buffer }
/** Durable intent precedes publication. A SQLite receipt decides restart recovery;
 * originals stay in recovery storage after success as well as after rollback. */
export function createNoteFileTransaction(db: any, root: string) {
  db.exec('CREATE TABLE IF NOT EXISTS pdf_note_file_commits(id TEXT PRIMARY KEY)')
  mkdirSync(root, { recursive: true })
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const restore = (entries: Array<{ target: string; existed: boolean; backup: string; beforeHash?: string; afterHash: string }>, retryWindowsLocks = true) => {
    const currentHashes = new Map<string, string>()
    // A newer outside edit is not ours to roll back. Keep intent and both versions.
    for (const entry of entries) if (existsSync(entry.target)) {
      const current = hash(readFileSync(entry.target))
      if (current !== entry.beforeHash && current !== entry.afterHash) throw new Error('노트 복구 중 외부 변경을 발견했습니다. 원본과 변경본을 보존했습니다.')
      currentHashes.set(entry.target, current)
    }
    for (const entry of entries) {
      // A rejected replacement leaves the original intact. Rewriting it can
      // hit the same Windows lock and hide the actual publication failure.
      if (entry.existed && currentHashes.get(entry.target) === entry.beforeHash) continue
      if (entry.existed) writeFileAtomic(entry.target, readFileSync(entry.backup), { retryWindowsLocks })
      else rmSync(entry.target, { force: true })
    }
  }
  const recover = () => { for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name, 'intent.json')
    if (!existsSync(path)) continue
    const intent = JSON.parse(readFileSync(path, 'utf8'))
    if (!db.prepare('SELECT id FROM pdf_note_file_commits WHERE id=?').get(intent.id)) restore(intent.entries)
    rmSync(path)
  } }
  const publish = (writes: NoteFileWrite[], commit: () => void, retryWindowsLocks = true): void => {
    const id = randomUUID(), directory = join(root, id), intentPath = join(directory, 'intent.json')
    mkdirSync(directory, { recursive: true })
    const entries = writes.map((write, index) => {
      const existed = existsSync(write.target), backup = join(directory, `${index}.original`)
      if (existed) {
        copyFileSync(write.target, backup, 1)
        const fd = openSync(backup, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }
      }
      return { target: write.target, existed, backup, ...(existed ? { beforeHash: hash(readFileSync(backup)) } : {}), afterHash: hash(write.bytes) }
    })
    writeFileAtomic(intentPath, JSON.stringify({ id, entries }))
    let committed = false
    try {
      db.transaction(() => {
        for (const write of writes) { mkdirSync(dirname(write.target), { recursive: true }); writeFileAtomic(write.target, write.bytes, { retryWindowsLocks }) }
        commit(); db.prepare('INSERT INTO pdf_note_file_commits(id) VALUES(?)').run(id)
      })()
      committed = true
      // Publication is complete once the receipt commits. A locked journal
      // can be cleaned by recover(); it must not rerun the completed edit.
      try { rmSync(intentPath) } catch { /* Leave the committed receipt for recovery. */ }
    } catch (error) {
      if (!committed) {
        try { restore(entries, retryWindowsLocks); rmSync(intentPath) }
        catch (rollbackError) {
          throw new AggregateError([error, rollbackError], '노트 페이지 변경을 복구하지 못했습니다. 원본과 복구 기록을 보존했습니다.')
        }
      }
      throw error
    }
  }
  const publishAsync = async (writes: NoteFileWrite[], commit: () => void, options?: WindowsFileRetryOptions): Promise<void> => {
    const originals = writes.map(write => ({ target: write.target, revision: existsSync(write.target) ? hash(readFileSync(write.target)) : null }))
    await retryWindowsFileOperation(() => {
      // Check and publish in the same turn so no queued save can slip between
      // revision validation and the synchronous file/SQLite transaction.
      for (const original of originals) {
        const current = existsSync(original.target) ? hash(readFileSync(original.target)) : null
        if (current !== original.revision) throw new Error('페이지 변경을 기다리는 동안 자료가 변경되었습니다. 원본을 보존했습니다. 다시 열어 주세요.')
      }
      publish(writes, commit, false)
    }, options)
  }
  return Object.assign(publish, { recover, publishAsync })
}
