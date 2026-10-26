import { afterEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../helpers/testDb'
import { createProfileManager, resolveActiveProfile } from '../../../src/main/features/account/profileManager'
const fault = vi.hoisted(() => ({ afterReadDirectory: undefined as ((directory: string) => void) | undefined }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: async (...args: Parameters<typeof actual.readdir>) => {
    const entries = await actual.readdir(...args)
    fault.afterReadDirectory?.(String(args[0]))
    return entries
  } }
})
const cleanup: Array<() => void> = []
afterEach(() => { fault.afterReadDirectory = undefined; cleanup.splice(0).reverse().forEach(fn => fn()) })
function fixture() {
  const testDb = createTestDb(); cleanup.push(testDb.cleanup)
  const destination = mkdtempSync(join(tmpdir(), 'bandal-backup-test-')); cleanup.push(() => rmSync(destination, { recursive: true, force: true }))
  const source = join(testDb.dir, 'external-course'); mkdirSync(source)
  writeFileSync(join(source, 'local.md'), '# 보존할 자료')
  testDb.db.prepare("INSERT INTO courses (id,name,slug,folder_path,color,created_at,updated_at,sort_order) VALUES ('course','학습','course',?,'blue','now','now',0)").run(source)
  mkdirSync(join(testDb.dir, 'auth')); writeFileSync(join(testDb.dir, 'auth/session.enc'), 'not-portable')
  const relaunch = vi.fn(), pause = vi.fn(), resume = vi.fn()
  const manager = createProfileManager({ db: testDb.db, baseRoot: testDb.dir, root: testDb.dir, chooseDestination: async () => join(destination, 'export.bandalbackup'), pause, resume, relaunch })
  return { ...testDb, source, destination, manager, relaunch, pause, resume }
}
test('verified full content backup precedes isolated profile switch', async () => {
  const f = fixture()
  mkdirSync(join(f.dir, 'workspace-previews'))
  writeFileSync(join(f.dir, 'workspace-previews/window.jpg'), 'local-only screenshot cache')
  const result = await f.manager.newProfile()
  expect(result.ok).toBe(true)
  expect(readFileSync(join(result.path!, 'courses/course/local.md'), 'utf8')).toBe('# 보존할 자료')
  expect(existsSync(join(result.path!, 'profile/auth/session.enc'))).toBe(false)
  expect(existsSync(join(result.path!, 'profile/workspace-previews'))).toBe(false)
  expect(JSON.parse(readFileSync(join(result.path!, 'manifest.json'), 'utf8')).databaseSha256).toMatch(/^[a-f0-9]{64}$/)
  const active = resolveActiveProfile(f.dir)
  expect(active).not.toBe(f.dir)
  expect(JSON.parse(readFileSync(join(active, 'settings.json'), 'utf8')).dataRoot).toBe(join(active, 'Courses'))
  expect(existsSync(join(active, 'auth/session.enc'))).toBe(false)
  expect(existsSync(join(active, 'workspace-previews'))).toBe(false)
  expect(readFileSync(join(f.source, 'local.md'), 'utf8')).toBe('# 보존할 자료')
  expect(f.relaunch).toHaveBeenCalledOnce()
  expect(f.manager.busy()).toBe(true)
  expect(f.resume).not.toHaveBeenCalled()
})
test('failed profile relaunch restores the old pointer and releases the verified backup pause', async () => {
  const f = fixture()
  f.relaunch.mockImplementation(() => { throw new Error('relaunch-failed') })
  await expect(f.manager.newProfile()).rejects.toThrow('relaunch-failed')
  expect(resolveActiveProfile(f.dir)).toBe(f.dir)
  expect(f.manager.busy()).toBe(false)
  expect(f.resume).toHaveBeenCalledOnce()
  expect(existsSync(join(f.destination, 'export.bandalbackup', 'manifest.json'))).toBe(true)
  expect(readFileSync(join(f.source, 'local.md'), 'utf8')).toBe('# 보존할 자료')
})
test('cancelled application quit restores the selected profile before editing resumes', async () => {
  const f = fixture()
  await f.manager.newProfile()
  expect(resolveActiveProfile(f.dir)).not.toBe(f.dir)
  expect(f.manager.busy()).toBe(true)
  f.manager.cancelSwitch()
  expect(resolveActiveProfile(f.dir)).toBe(f.dir)
  expect(f.manager.busy()).toBe(false)
  expect(f.resume).toHaveBeenCalledOnce()
})
test('cancelled backup never changes the active profile', async () => {
  const f = fixture()
  const manager = createProfileManager({ db: f.db, baseRoot: f.dir, root: f.dir, chooseDestination: async () => null, pause: vi.fn(), resume: vi.fn(), relaunch: f.relaunch })
  expect(await manager.newProfile()).toMatchObject({ ok: false, cancelled: true })
  expect(resolveActiveProfile(f.dir)).toBe(f.dir)
  expect(f.relaunch).not.toHaveBeenCalled()
})

test('a second backup cannot enter while the first destination chooser is open', async () => {
  const f = fixture()
  let choose!: (value: string | null) => void
  const resume = vi.fn()
  const manager = createProfileManager({ db: f.db, baseRoot: f.dir, root: f.dir,
    chooseDestination: () => new Promise(resolve => { choose = resolve }), pause: vi.fn(), resume, relaunch: f.relaunch })
  const first = manager.backup()
  expect(manager.busy()).toBe(true)
  await expect(manager.backup()).rejects.toThrow('백업이 진행 중')
  choose(null)
  expect(await first).toMatchObject({ cancelled: true })
  expect(manager.busy()).toBe(false)
  expect(resume).not.toHaveBeenCalled()
})

test('a destination through a symlink into source content is rejected before creating files', async () => {
  const f = fixture(), alias = join(f.destination, 'alias')
  symlinkSync(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const pause = vi.fn(), resume = vi.fn()
  const manager = createProfileManager({ db: f.db, baseRoot: f.dir, root: f.dir,
    chooseDestination: async () => join(alias, 'recursive.bandalbackup'), pause, resume, relaunch: f.relaunch })
  await expect(manager.backup()).rejects.toThrow('자료 폴더 밖')
  expect(existsSync(join(f.source, 'recursive.bandalbackup'))).toBe(false)
  expect(pause).not.toHaveBeenCalled()
  expect(resume).not.toHaveBeenCalled()
  expect(manager.busy()).toBe(false)
})

test('Chromium DIPS deletion during backup does not affect the verified content snapshot', async () => {
  const f = fixture()
  const runtimeFiles = ['DIPS', 'DIPS-journal', 'DIPS-wal', 'DIPS-shm']
  for (const name of runtimeFiles) writeFileSync(join(f.dir, name), 'Chromium bounce tracking state')
  const notes = join(f.dir, 'Preserved Notes'); mkdirSync(notes)
  writeFileSync(join(notes, 'DIPS-journal'), 'A user file with the same name')
  writeFileSync(join(f.source, 'DIPS-journal'), 'A course file with the same name')
  writeFileSync(join(f.dir, 'DIPS-notes.md'), '# Prefixes are not excluded')
  let removed = false
  fault.afterReadDirectory = directory => {
    if (directory === f.dir && !removed) {
      removed = true
      rmSync(join(f.dir, 'DIPS-journal'))
    }
  }
  const result = await f.manager.backup()
  expect(removed).toBe(true)
  expect(result.ok).toBe(true)
  const manifest = JSON.parse(readFileSync(join(result.path!, 'manifest.json'), 'utf8'))
  expect(manifest.excluded).toEqual(expect.arrayContaining(runtimeFiles))
  for (const name of runtimeFiles) expect(existsSync(join(result.path!, 'profile', name))).toBe(false)
  expect(readFileSync(join(result.path!, 'profile/Preserved Notes/DIPS-journal'), 'utf8')).toBe('A user file with the same name')
  expect(readFileSync(join(result.path!, 'courses/course/DIPS-journal'), 'utf8')).toBe('A course file with the same name')
  expect(readFileSync(join(result.path!, 'profile/DIPS-notes.md'), 'utf8')).toBe('# Prefixes are not excluded')
  expect(readFileSync(join(result.path!, 'courses/course/local.md'), 'utf8')).toBe('# 보존할 자료')
  expect(f.manager.busy()).toBe(false)
  expect(f.resume).toHaveBeenCalledOnce()
})

test('a disappearing user file still fails backup without a verified manifest or profile switch', async () => {
  const f = fixture()
  const source = join(f.dir, 'draft.md')
  writeFileSync(source, '# Still required in a verified backup')
  fault.afterReadDirectory = directory => {
    if (directory === f.dir) { fault.afterReadDirectory = undefined; rmSync(source) }
  }
  await expect(f.manager.newProfile()).rejects.toMatchObject({ code: 'ENOENT' })
  expect(existsSync(join(f.destination, 'export.bandalbackup/manifest.json'))).toBe(false)
  expect(resolveActiveProfile(f.dir)).toBe(f.dir)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.manager.busy()).toBe(false)
  expect(f.resume).toHaveBeenCalledOnce()
  expect(readFileSync(join(f.source, 'local.md'), 'utf8')).toBe('# 보존할 자료')
})
