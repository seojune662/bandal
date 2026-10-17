import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '../../lib/atomicWrite'

export interface NoteFileWrite { target: string; bytes: Buffer }
/** Durable intent precedes publication. A SQLite receipt decides restart recovery;
 * originals stay in recovery storage after success as well as after rollback. */
export function createNoteFileTransaction(db: any, root: string) {
  db.exec('CREATE TABLE IF NOT EXISTS pdf_note_file_commits(id TEXT PRIMARY KEY)')
  mkdirSync(root, { recursive: true })
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const restore = (entries: Array<{ target: string; existed: boolean; backup: string; beforeHash?: string; afterHash: string }>) => {
    // A newer outside edit is not ours to roll back. Keep intent and both versions.
    for (const entry of entries) if (existsSync(entry.target)) {
      const current = hash(readFileSync(entry.target))
      if (current !== entry.beforeHash && current !== entry.afterHash) throw new Error('노트 복구 중 외부 변경을 발견했습니다. 원본과 변경본을 보존했습니다.')
    }
    for (const entry of entries) {
      if (entry.existed) writeFileAtomic(entry.target, readFileSync(entry.backup))
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
  const publish = (writes: NoteFileWrite[], commit: () => void): void => {
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
        for (const write of writes) { mkdirSync(dirname(write.target), { recursive: true }); writeFileAtomic(write.target, write.bytes) }
        commit(); db.prepare('INSERT INTO pdf_note_file_commits(id) VALUES(?)').run(id)
      })()
      committed = true
      rmSync(intentPath)
    } catch (error) {
      if (!committed) { restore(entries); rmSync(intentPath) }
      throw error
    }
  }
  return Object.assign(publish, { recover })
}
