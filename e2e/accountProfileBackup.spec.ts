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
}
const hash = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const backupButton = (bandal: BandalApp) => bandal.page.getByRole('button', { name: '로그인 전 자료 백업·내보내기', exact: true })

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
  if (destination !== null) await expect(bandal.page.getByText('전체 자료 백업과 파일 검증을 완료했어요.', { exact: true })).toBeVisible()
  await expect(backupButton(bandal)).toBeEnabled()
  await expect.poll(() => bandal.page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(false)
}

async function expectWorkspaceLocked(bandal: BandalApp, reason = 'login-required'): Promise<void> {
  await expect(bandal.page.getByRole('heading', { name: '반달에 로그인', exact: true })).toBeVisible()
  await expect(bandal.page.locator('aside.app-rail--left')).toHaveCount(0)
  expect(await bandal.page.evaluate(async () => {
    try { await window.bandal.invoke('courses:list', {}); return '' } catch (error) { return String(error) }
  })).toContain(reason)
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

test('before first login, canceling and completing a verified backup releases the workspace lock', async () => {
  const bandal = await launchBandal({ authenticatedProfile: false })
  try {
    const notes = join(bandal.userDataDir, 'Preserved Notes')
    mkdirSync(notes)
    const source = join(notes, 'draft.md'), text = '# 로그인 전 원본\n\n백업으로 보존할 초안\n'
    writeFileSync(source, text)
    await chooseBackup(bandal, null)
    await expectWorkspaceLocked(bandal)
    const destination = join(bandal.profileDir, 'before-login.bandalbackup')
    await chooseBackup(bandal, destination)
    const manifest = verifyBackup(destination, source, text)
    expect(manifest.courses).toEqual([])
    expect(existsSync(join(bandal.userDataDir, 'active-profile.json'))).toBe(false)
    await expectWorkspaceLocked(bandal)
  } finally { await bandal.close() }
})

test('a damaged account receipt still permits a verified full backup without changing the original profile', async () => {
  const initial = await launchBandal({ keepProfileOnClose: true })
  let reopened: BandalApp | undefined
  let initialClosed = false
  try {
    await createCourse(initial.page, '계정 기록 복구용 자료')
    const course = await initial.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const source = join(course.folderPath, '보존.md'), text = '# 원본 보존\n\n계정 기록이 손상되어도 내보낼 자료\n'
    writeFileSync(source, text)
    await initial.close(); initialClosed = true
    const receipt = join(initial.userDataDir, 'profile-access.json'), damaged = '{broken-account-receipt'
    writeFileSync(receipt, damaged)
    reopened = await launchBandal({ reuseProfileDir: initial.profileDir, authenticatedProfile: false })
    await expect(reopened.page.getByRole('alert')).toContainText('계정 연결 기록을 읽거나 저장하지 못했습니다.')
    const destination = join(reopened.profileDir, 'damaged-receipt.bandalbackup')
    await chooseBackup(reopened, destination)
    const manifest = verifyBackup(destination, source, text)
    expect(manifest.courses).toContainEqual({ id: course.id, folder_path: course.folderPath })
    expect(readFileSync(join(destination, 'courses', course.id, '보존.md'), 'utf8')).toBe(text)
    expect(readFileSync(receipt, 'utf8')).toBe(damaged)
    expect(existsSync(join(reopened.userDataDir, 'active-profile.json'))).toBe(false)
    await expectWorkspaceLocked(reopened, '로컬 계정 연결 기록을 확인할 수 없습니다.')
  } finally {
    if (reopened) await reopened.close()
    else {
      if (!initialClosed) await initial.close()
      rmSync(initial.profileDir, { recursive: true, force: true })
    }
  }
})
