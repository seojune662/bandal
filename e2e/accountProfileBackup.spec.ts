import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

interface BackupManifest {
  version: number
  databaseSha256: string
  courses: Array<{ id: string; folder_path: string }>
  entries: Array<{ source: string; target: string; sha256: string; size: number }>
  excluded: string[]
}
const hash = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const backupButton = (bandal: BandalApp) => bandal.page.getByRole('button', { name: '전체 자료 백업', exact: true })

async function openAccountSettings(bandal: BandalApp): Promise<void> {
  await bandal.page.keyboard.press('ControlOrMeta+,')
  await bandal.page.locator('.settings-nav [data-category="account"]').click()
  await expect(backupButton(bandal)).toBeVisible()
}

/** Hold the native picker open so the real main/preload/renderer ACK can be observed. */
async function chooseBackup(bandal: BandalApp, destination: string | null): Promise<void> {
  await bandal.app.evaluate(({ dialog }) => {
    const state = { opened: false, resolve: null as null | ((result: { canceled: boolean; filePath?: string }) => void) }
    ;(globalThis as typeof globalThis & { __backupPicker?: typeof state }).__backupPicker = state
    dialog.showSaveDialog = (() => new Promise(resolve => {
      state.opened = true
      state.resolve = resolve
    })) as typeof dialog.showSaveDialog
  })
  await backupButton(bandal).click()
  await expect.poll(() => bandal.app.evaluate(() => (globalThis as typeof globalThis & { __backupPicker?: { opened: boolean } }).__backupPicker?.opened)).toBe(true)
  await expect.poll(() => bandal.page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(true)
  await bandal.app.evaluate((_electron, path) => {
    const state = (globalThis as typeof globalThis & { __backupPicker?: { resolve: ((result: { canceled: boolean; filePath?: string }) => void) | null } }).__backupPicker
    state!.resolve!({ canceled: path === null, ...(path === null ? {} : { filePath: path }) })
  }, destination)
  if (destination !== null) await expect(bandal.page.getByText('백업 절차를 마쳤습니다.', { exact: true })).toBeVisible()
  await expect(backupButton(bandal)).toBeEnabled()
  await expect.poll(() => bandal.page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(false)
}

async function expectWorkspaceOpen(bandal: BandalApp): Promise<string[]> {
  await expect(bandal.page.getByRole('heading', { name: '반달에 로그인', exact: true })).toHaveCount(0)
  await expect(bandal.page.locator('aside.app-rail--left:visible')).toBeVisible()
  return bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).map(course => course.name))
}

function verifyBackup(destination: string, source: string, expected: string): BackupManifest {
  const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')) as BackupManifest
  expect(manifest.version).toBe(1)
  expect(manifest.databaseSha256).toBe(hash(join(destination, 'bandal.db')))
  const entry = manifest.entries.find(item => item.source === source)
  expect(entry).toBeDefined()
  expect(entry!.sha256).toBe(hash(source))
  expect(hash(join(destination, entry!.target))).toBe(entry!.sha256)
  expect(readFileSync(join(destination, entry!.target), 'utf8')).toBe(expected)
  expect(readFileSync(source, 'utf8')).toBe(expected)
  return manifest
}

test('without signing in, a canceled and a completed backup both leave the workspace usable', async () => {
  const bandal = await launchBandal()
  try {
    const notes = join(bandal.userDataDir, 'Preserved Notes')
    mkdirSync(notes)
    const source = join(notes, 'draft.md'), text = '# 로그인 없이 만든 원본\n\n백업으로 보존할 초안\n'
    writeFileSync(source, text)
    const namedLikeRuntime = join(notes, 'DIPS-journal'), userJournal = '사용자가 보관한 동명 자료\n'
    writeFileSync(namedLikeRuntime, userJournal)
    await openAccountSettings(bandal)
    await chooseBackup(bandal, null)
    await expectWorkspaceOpen(bandal)
    const destination = join(bandal.profileDir, 'signed-out.bandalbackup')
    await chooseBackup(bandal, destination)
    const manifest = verifyBackup(destination, source, text)
    verifyBackup(destination, namedLikeRuntime, userJournal)
    for (const name of ['DIPS', 'DIPS-journal', 'DIPS-wal', 'DIPS-shm']) {
      expect(manifest.excluded).toContain(name)
      expect(manifest.entries.some(entry => entry.source === join(bandal.userDataDir, name))).toBe(false)
      expect(existsSync(join(destination, 'profile', name))).toBe(false)
    }
    expect(manifest.courses).toEqual([])
    expect(existsSync(join(bandal.userDataDir, 'active-profile.json'))).toBe(false)
    await expectWorkspaceOpen(bandal)
  } finally { await bandal.close() }
})

test('a receipt left by older versions, even locked or damaged, no longer blocks the workspace', async () => {
  const initial = await launchBandal({ keepProfileOnClose: true })
  let reopened: BandalApp | undefined
  let initialClosed = false
  try {
    await createCourse(initial.page, '이전 버전 자료')
    await initial.close(); initialClosed = true
    const receipt = join(initial.userDataDir, 'profile-access.json')
    const locked = JSON.stringify({ version: 1, profileID: '22222222-2222-4222-8222-222222222222', boundUserID: '11111111-1111-4111-8111-111111111111', verifiedAt: '2026-10-17T00:00:00.000Z', locked: true })
    writeFileSync(receipt, locked)
    reopened = await launchBandal({ reuseProfileDir: initial.profileDir, keepProfileOnClose: true })
    expect(await expectWorkspaceOpen(reopened)).toContain('이전 버전 자료')
    await reopened.close(); reopened = undefined
    const damaged = '{broken-account-receipt'
    writeFileSync(receipt, damaged)
    reopened = await launchBandal({ reuseProfileDir: initial.profileDir })
    expect(await expectWorkspaceOpen(reopened)).toContain('이전 버전 자료')
    expect(readFileSync(receipt, 'utf8')).toBe(damaged)
  } finally {
    if (reopened) await reopened.close()
    if (!initialClosed) await initial.close()
    rmSync(initial.profileDir, { recursive: true, force: true })
  }
})
