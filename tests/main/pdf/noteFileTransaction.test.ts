import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createNoteFileTransaction } from '../../../src/main/features/pdf/noteFileTransaction'

const faults = vi.hoisted(() => ({ rename: undefined as ((source: string, target: string) => void) | undefined }))
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, renameSync: (...args: Parameters<typeof actual.renameSync>) => {
    faults.rename?.(String(args[0]), String(args[1]))
    return actual.renameSync(...args)
  } }
})

let ctx: TestDb
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const lock = (): NodeJS.ErrnoException => Object.assign(new Error('PDF is open by a pending reader'), { code: 'EPERM' })
beforeEach(() => {
  ctx = createTestDb()
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(() => {
  faults.rename = undefined
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platform)
  ctx.cleanup()
})
function fixture() {
  const pdf = join(ctx.dir, 'note.pdf'), note = join(ctx.dir, 'linked.md'), recovery = join(ctx.dir, 'Recovery')
  writeFileSync(pdf, 'two pages'); writeFileSync(note, 'two sections')
  const publish = createNoteFileTransaction(ctx.db, recovery)
  const writes = [{ target: pdf, bytes: Buffer.from('three pages') }, { target: note, bytes: Buffer.from('three sections') }]
  const intents = (): string[] => readdirSync(recovery).map(directory => join(recovery, directory, 'intent.json')).filter(existsSync)
  const receipts = (): number => (ctx.db.prepare('SELECT COUNT(*) AS count FROM pdf_note_file_commits').get() as { count: number }).count
  return { pdf, note, writes, publish, intents, receipts }
}

test('PDF replacement yields so a pending reader can release its Windows lock, without rewriting the untouched original', async () => {
  const f = fixture(), blockingWait = vi.spyOn(Atomics, 'wait'), commit = vi.fn()
  let locked = true, attempts = 0
  faults.rename = (_source, target) => {
    if (target !== f.pdf) return
    attempts++
    if (!locked) return
    setImmediate(() => { locked = false })
    throw lock()
  }
  await f.publish.publishAsync(f.writes, commit)
  expect(attempts).toBe(2)
  expect(blockingWait).not.toHaveBeenCalled()
  expect(readFileSync(f.pdf, 'utf8')).toBe('three pages')
  expect(readFileSync(f.note, 'utf8')).toBe('three sections')
  expect(commit).toHaveBeenCalledOnce()
  expect(f.receipts()).toBe(1)
  expect(f.intents()).toEqual([])
})

test('a lock after the PDF write restores all files and SQLite before yielding, then commits once', async () => {
  const f = fixture(), commit = vi.fn()
  let locked = true
  faults.rename = (_source, target) => { if (target === f.note && locked) throw lock() }
  const wait = vi.fn(async () => {
    expect(ctx.db.inTransaction).toBe(false)
    expect(readFileSync(f.pdf, 'utf8')).toBe('two pages')
    expect(readFileSync(f.note, 'utf8')).toBe('two sections')
    expect(f.receipts()).toBe(0)
    expect(f.intents()).toEqual([])
    locked = false
  })
  await f.publish.publishAsync(f.writes, commit, { wait })
  expect(wait).toHaveBeenCalledExactlyOnceWith(50)
  expect(readFileSync(f.pdf, 'utf8')).toBe('three pages')
  expect(readFileSync(f.note, 'utf8')).toBe('three sections')
  expect(commit).toHaveBeenCalledOnce()
  expect(f.receipts()).toBe(1)
})

test('an outside change while waiting is preserved instead of publishing a stale PDF recipe', async () => {
  const f = fixture(), commit = vi.fn()
  faults.rename = (_source, target) => { if (target === f.pdf) throw lock() }
  await expect(f.publish.publishAsync(f.writes, commit, { wait: async () => { writeFileSync(f.pdf, 'outside edit') } })).rejects.toThrow('자료가 변경')
  expect(readFileSync(f.pdf, 'utf8')).toBe('outside edit')
  expect(readFileSync(f.note, 'utf8')).toBe('two sections')
  expect(commit).not.toHaveBeenCalled()
  expect(f.receipts()).toBe(0)
})

test('an exhausted lock keeps the original error and original files without a second rollback rename', async () => {
  const f = fixture(), error = lock(), wait = vi.fn(async (_milliseconds: number) => {})
  let attempts = 0
  faults.rename = (_source, target) => { if (target === f.pdf) { attempts++; throw error } }
  await expect(f.publish.publishAsync(f.writes, vi.fn(), { wait })).rejects.toBe(error)
  expect(attempts).toBe(6)
  expect(wait.mock.calls.map(args => args[0])).toEqual([50, 100, 200, 400, 800])
  expect(readFileSync(f.pdf, 'utf8')).toBe('two pages')
  expect(readFileSync(f.note, 'utf8')).toBe('two sections')
  expect(f.receipts()).toBe(0)
  expect(f.intents()).toEqual([])
})

test('failed rollback retains the journal and both errors and never retries a partially restored transaction', async () => {
  const f = fixture(), wait = vi.fn(async () => {}), error = lock()
  let pdfAttempts = 0
  faults.rename = (_source, target) => {
    if (target === f.pdf && ++pdfAttempts > 1) throw error
    if (target === f.note) throw error
  }
  await expect(f.publish.publishAsync(f.writes, vi.fn(), { wait })).rejects.toMatchObject({ errors: [error, error] })
  expect(wait).not.toHaveBeenCalled()
  expect(f.intents()).toHaveLength(1)
  expect(f.receipts()).toBe(0)
  faults.rename = undefined
  f.publish.recover()
  expect(readFileSync(f.pdf, 'utf8')).toBe('two pages')
  expect(f.intents()).toEqual([])
})
