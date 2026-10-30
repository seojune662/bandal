import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { copyClaudeProjects, moveDataRoot, planDataRootMove, recoverDataRootMove, type DataRootMove } from '../../../src/main/features/dataRoot/dataRootMove'
import { createTestDb, type TestDb } from '../helpers/testDb'

let t: TestDb
let legacy: string, target: string, journalPath: string
const now = '2026-10-30T00:00:00.000Z'

function addCourse(id: string, folder: string, source: 'managed' | 'linked' = 'managed'): void {
  t.db.prepare('INSERT INTO courses (id, name, slug, color, folder_path, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, id, 'blue', folder, now, now, source)
}
const folderOf = (id: string): string => (t.db.prepare('SELECT folder_path FROM courses WHERE id = ?').get(id) as { folder_path: string }).folder_path

beforeEach(() => {
  t = createTestDb()
  legacy = join(t.dir, 'Documents', 'Bandal')
  target = join(t.dir, 'userData', 'Courses')
  journalPath = join(t.dir, 'userData', 'data-root-migration.json')
  mkdirSync(join(t.dir, 'userData'), { recursive: true })
  mkdirSync(join(legacy, '선형대수학', '강의자료'), { recursive: true })
  mkdirSync(join(legacy, '선형대수학', '빈 폴더'))
  writeFileSync(join(legacy, '선형대수학', '강의자료', '1주차.pdf'), 'pdf-bytes')
  writeFileSync(join(legacy, '선형대수학', '요약.md'), '# 요약\n')
  addCourse('managed-1', join(legacy, '선형대수학'))
  addCourse('linked-1', join(t.dir, 'Desktop', '외부'), 'linked')
  addCourse('elsewhere-1', join(t.dir, 'Dropbox', 'Bandal', '통계'))
})
afterEach(() => t.cleanup())

describe('planDataRootMove', () => {
  test('selects only managed folders under the legacy root', () => {
    const move = planDataRootMove(t.db, { legacyRoot: legacy, newRoot: target, currentDataRoot: legacy })
    expect(move).toEqual({ from: legacy, to: target, switchSetting: true, folders: [{ from: join(legacy, '선형대수학'), to: join(target, '선형대수학') }] })
  })

  test('keeps a custom data root but still rescues old legacy courses', () => {
    const custom = join(t.dir, 'Dropbox', 'Bandal')
    expect(planDataRootMove(t.db, { legacyRoot: legacy, newRoot: target, currentDataRoot: custom })?.switchSetting).toBe(false)
    t.db.prepare("DELETE FROM courses WHERE id = 'managed-1'").run()
    expect(planDataRootMove(t.db, { legacyRoot: legacy, newRoot: target, currentDataRoot: custom })).toBeNull()
  })
})

describe('moveDataRoot', () => {
  const plan = (): DataRootMove => planDataRootMove(t.db, { legacyRoot: legacy, newRoot: target, currentDataRoot: legacy })!

  test('copies, verifies and rewrites every stored path while leaving the legacy folder intact', async () => {
    t.db.prepare('INSERT INTO agent_sessions (id, course_id, provider, status, created_at, updated_at, launch_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('session-1', 'managed-1', 'claude-code', 'idle', now, now, JSON.stringify({ cwd: join(legacy, '선형대수학'), args: ['-p', '--add-dir', join(legacy, '선형대수학', '강의자료')] }))
    t.db.prepare('INSERT INTO material_added_baselines (course_id, folder) VALUES (?, ?)').run('managed-1', join(legacy, '선형대수학'))
    let dataRoot = legacy
    const progress: number[] = []
    await moveDataRoot(t.db, plan(), { journalPath, setDataRoot: root => { dataRoot = root }, progress: done => progress.push(done) })

    expect(dataRoot).toBe(target)
    expect(folderOf('managed-1')).toBe(join(target, '선형대수학'))
    expect(folderOf('linked-1')).toBe(join(t.dir, 'Desktop', '외부'))
    expect(readFileSync(join(target, '선형대수학', '강의자료', '1주차.pdf'), 'utf8')).toBe('pdf-bytes')
    expect(existsSync(join(target, '선형대수학', '빈 폴더'))).toBe(true)
    expect(readFileSync(join(legacy, '선형대수학', '요약.md'), 'utf8')).toBe('# 요약\n')
    const session = JSON.parse((t.db.prepare("SELECT launch_config_json FROM agent_sessions WHERE id = 'session-1'").get() as { launch_config_json: string }).launch_config_json)
    expect(session).toEqual({ cwd: join(target, '선형대수학'), args: ['-p', '--add-dir', join(target, '선형대수학', '강의자료')] })
    expect((t.db.prepare('SELECT folder FROM material_added_baselines').get() as { folder: string }).folder).toBe(join(target, '선형대수학'))
    expect(progress.at(-1)).toBe(Buffer.byteLength('pdf-bytes') + Buffer.byteLength('# 요약\n'))
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(`${target}.partial`)).toBe(false)
  })

  test('refuses a non-empty target without changing anything', async () => {
    mkdirSync(join(target, '다른 자료'), { recursive: true })
    await expect(moveDataRoot(t.db, plan(), { journalPath, setDataRoot: () => { throw new Error('must not switch') } })).rejects.toThrow('새 자료 위치에 이미 파일이 있어요')
    expect(folderOf('managed-1')).toBe(join(legacy, '선형대수학'))
  })

  test('rolls back paths and folders when the setting cannot be switched', async () => {
    await expect(moveDataRoot(t.db, plan(), { journalPath, setDataRoot: () => { throw new Error('settings write failed') } })).rejects.toThrow('settings write failed')
    expect(folderOf('managed-1')).toBe(join(legacy, '선형대수학'))
    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${target}.partial`)).toBe(false)
    expect(existsSync(journalPath)).toBe(false)
  })
})

describe('recoverDataRootMove', () => {
  test('undoes an uncommitted switch and restores the setting', () => {
    mkdirSync(join(target, '선형대수학'), { recursive: true })
    writeFileSync(journalPath, JSON.stringify({ state: 'switching', from: legacy, to: target, switchSetting: true, folders: [{ from: join(legacy, '선형대수학'), to: join(target, '선형대수학') }] }))
    let dataRoot = target
    recoverDataRootMove(t.db, { journalPath, currentDataRoot: target, setDataRoot: root => { dataRoot = root } })
    expect(dataRoot).toBe(legacy)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(journalPath)).toBe(false)
    expect(existsSync(join(legacy, '선형대수학', '요약.md'))).toBe(true)
  })

  test('finishes a committed switch whose setting write was lost', () => {
    t.db.prepare("UPDATE courses SET folder_path = ? WHERE id = 'managed-1'").run(join(target, '선형대수학'))
    writeFileSync(journalPath, JSON.stringify({ state: 'switching', from: legacy, to: target, switchSetting: true, folders: [{ from: join(legacy, '선형대수학'), to: join(target, '선형대수학') }] }))
    let dataRoot = legacy
    recoverDataRootMove(t.db, { journalPath, currentDataRoot: legacy, setDataRoot: root => { dataRoot = root } })
    expect(dataRoot).toBe(target)
    expect(existsSync(journalPath)).toBe(false)
  })

  test('drops a half-copied staging folder and a corrupt journal', () => {
    mkdirSync(`${target}.partial`, { recursive: true })
    writeFileSync(journalPath, JSON.stringify({ state: 'copying', from: legacy, to: target, switchSetting: true, folders: [] }))
    recoverDataRootMove(t.db, { journalPath, currentDataRoot: legacy, setDataRoot: () => { throw new Error('unexpected') } })
    expect(existsSync(`${target}.partial`)).toBe(false)
    writeFileSync(journalPath, '{broken')
    recoverDataRootMove(t.db, { journalPath, currentDataRoot: legacy, setDataRoot: () => { throw new Error('unexpected') } })
    expect(existsSync(journalPath)).toBe(false)
  })
})

test('copyClaudeProjects copies the cwd-keyed session folder without overwriting', async () => {
  const claude = join(t.dir, '.claude')
  const encode = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')
  const folder = { from: join(legacy, '선형대수학'), to: join(target, '선형대수학') }
  mkdirSync(join(claude, 'projects', encode(folder.from)), { recursive: true })
  writeFileSync(join(claude, 'projects', encode(folder.from), 'session.jsonl'), '{}\n')
  expect(await copyClaudeProjects([folder], claude)).toBe(1)
  expect(readFileSync(join(claude, 'projects', encode(folder.to), 'session.jsonl'), 'utf8')).toBe('{}\n')
  expect(readFileSync(join(claude, 'projects', encode(folder.from), 'session.jsonl'), 'utf8')).toBe('{}\n')
  expect(await copyClaudeProjects([folder], claude)).toBe(0)
})
