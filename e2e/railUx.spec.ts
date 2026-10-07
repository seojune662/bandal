import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import type { UpdateStatus } from '../src/shared/types/update'

const currentVersion = '0.0.0'
const version = '9.99.0'
const available: UpdateStatus = { phase: 'available', currentVersion, version, notes: null }
const ready: UpdateStatus = { phase: 'ready', currentVersion, version }

async function updateFixture(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow, ipcMain, app }, initial) => {
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    const probe = { status: initial, downloads: 0, installs: 0, installAllowed: false, release: null as (() => void) | null, failWrites: false }
    ;(globalThis as any).__railUpdate = probe
    // Packaged runs must also stay on this fixture when their startup check fires.
    const load = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`)
    load('electron-updater').autoUpdater.checkForUpdates = async () => { host.webContents.send('update:changed', probe.status); return null }
    for (const name of ['update:status', 'update:check', 'update:download', 'update:install']) ipcMain.removeHandler(name)
    ipcMain.handle('update:status', () => probe.status)
    ipcMain.handle('update:check', () => probe.status)
    ipcMain.handle('update:download', async () => {
      probe.downloads += 1
      probe.status = { phase: 'downloading', currentVersion: '0.0.0', version: '9.99.0', percent: 0 }
      host.webContents.send('update:changed', probe.status)
      await new Promise<void>(resolve => { probe.release = resolve })
      probe.release = null
      probe.status = { phase: 'ready', currentVersion: '0.0.0', version: '9.99.0' }
      host.webContents.send('update:changed', probe.status)
      // A stale response must not replace the newer ready push.
      return initial
    })
    ipcMain.handle('update:install', () => { probe.installs += 1; return { ok: probe.installAllowed } })
    const write = (ipcMain as any)._invokeHandlers.get('notes:write')
    ipcMain.removeHandler('notes:write')
    ipcMain.handle('notes:write', (event, input) => {
      if (probe.failWrites) throw new Error('Fixture write unavailable')
      return write(event, input)
    })
    host.webContents.send('update:changed', initial)
  }, available)
}

async function pushUpdate(bandal: BandalApp, status: UpdateStatus): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, status) => {
    ;(globalThis as any).__railUpdate.status = status
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('update:changed', status)
  }, status)
}

async function signInFixture(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ ipcMain }) => {
    const profile = { phase: 'signed-in', profile: { id: 'rail-user', nickname: '서준', avatarColor: '#64748b', avatarEmoji: '🌙' }, email: 'student@example.test', avatarUrl: null, online: true, errorCode: null }
    const probe = { calls: 0, fail: true, release: null as (() => void) | null }
    ;(globalThis as any).__railSignOut = probe
    ;(globalThis as any).__railAuth = profile
    ipcMain.removeHandler('auth:getState'); ipcMain.handle('auth:getState', () => profile)
    ipcMain.removeHandler('auth:signOut'); ipcMain.handle('auth:signOut', async () => {
      probe.calls += 1
      await new Promise<void>(resolve => { probe.release = resolve })
      probe.release = null
      if (probe.fail) throw new Error('Fixture signout failed')
      return { ok: true }
    })
  })
  await bandal.page.locator('.global-navigation').getByRole('button', { name: '계정', exact: true }).click()
  await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('auth:changed', (globalThis as any).__railAuth))
  await expect(bandal.page.getByRole('button', { name: '계정: 서준', exact: true })).toBeVisible()
  await bandal.page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
}

async function assertMenuBounds(page: Page): Promise<void> {
  expect(await page.getByRole('menu', { name: '계정 관리' }).evaluate(element => {
    const b = element.getBoundingClientRect()
    return b.left >= 7 && b.top >= 7 && b.right <= innerWidth - 7 && b.bottom <= innerHeight - 7
  })).toBe(true)
}

async function captureWindow(bandal: BandalApp, path: string): Promise<void> {
  const capture = await bandal.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.capturePage()).toDataURL())
  writeFileSync(path, Buffer.from(capture.split(',')[1]!, 'base64'))
}

test('rail update downloads once, tracks progress, and waits for saved notes and explicit restart', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const { page, app } = bandal
    await expect(page.locator('.rail-update-button')).toHaveCount(0)
    await updateFixture(bandal)
    const download = page.getByRole('button', { name: `새 버전 ${version} 다운로드`, exact: true })
    await expect(download).toBeVisible()
    expect(await download.evaluate(button => {
      const update = button.getBoundingClientRect(), account = document.querySelector('.global-navigation__bottom .sidebar-account, .global-navigation__bottom [aria-label="계정"]')!.getBoundingClientRect()
      return update.bottom <= account.top && getComputedStyle(button).borderRadius !== '0px'
    })).toBe(true)
    await page.screenshot({ path: info.outputPath('rail-update-light.png') })
    await download.dblclick()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__railUpdate.downloads)).toBe(1)
    await pushUpdate(bandal, { phase: 'downloading', currentVersion, version, percent: 57 })
    await expect(page.getByRole('button', { name: /업데이트 다운로드 중.*57/ })).toBeDisabled()
    expect(await app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(0)
    await app.evaluate(() => (globalThis as any).__railUpdate.release())
    const restart = page.getByRole('button', { name: '업데이트 적용하고 다시 시작', exact: true })
    await expect(restart).toBeEnabled()
    expect(await app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(0)
    await createCourse(page, '업데이트 저장 검사')
    await page.locator('.course-row').filter({ has: page.locator('.course-row__name', { hasText: /^업데이트 저장 검사$/ }) }).locator('.course-row__select').click()
    await page.locator('.workspace-watermark').getByRole('button', { name: /^새 필기/ }).click()
    const editor = page.locator('.note-tab:visible .ProseMirror')
    await expect(editor).toBeVisible()
    await app.evaluate(() => { (globalThis as any).__railUpdate.failWrites = true })
    await editor.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.keyboard.type('Update must preserve this draft')
    await restart.click()
    await page.getByRole('button', { name: '업데이트 오류 확인', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /업데이트/ })).toBeVisible()
    expect(await app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(0)
    await app.evaluate(() => { (globalThis as any).__railUpdate.failWrites = false })
    await page.getByRole('dialog', { name: /업데이트/ }).getByRole('button', { name: '다시 시도', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(1)
    await page.getByRole('button', { name: '업데이트 오류 확인', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /업데이트/ })).toBeVisible()
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const note = await page.evaluate(async id => (await window.bandal.invoke('materials:tree', { courseId: id })).find(node => node.kind === 'note')!, courses[0]!.id)
    expect(readFileSync(join(courses[0]!.folderPath, note.relPath), 'utf8')).toContain('Update must preserve this draft')
    await app.evaluate(() => { (globalThis as any).__railUpdate.installAllowed = true })
    await page.getByRole('dialog', { name: /업데이트/ }).getByRole('button', { name: '다시 시도', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(2)
    await expect(page.getByRole('dialog', { name: /업데이트/ })).toHaveCount(0)
    await expect(page.locator('.rail-update-button')).toBeDisabled()
    await pushUpdate(bandal, { ...ready, restartCancelled: true })
    await expect(page.getByRole('button', { name: '업데이트 오류 확인', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '업데이트 오류 확인', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /업데이트/ })).toContainText('취소')
    await page.getByRole('dialog', { name: /업데이트/ }).getByRole('button', { name: '다시 시도', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__railUpdate.installs)).toBe(3)
    await pushUpdate(bandal, { phase: 'idle', currentVersion, lastCheckedAt: Date.now() })
    await expect(page.locator('.rail-update-button')).toHaveCount(0)
  } finally { await bandal.app.evaluate(() => (globalThis as any).__railUpdate?.release?.()).catch(() => {}); await bandal.close() }
})

test('profile and more menus remain compact and reachable across themes, zoom, keyboard and signout recovery', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const { page, app } = bandal
    await updateFixture(bandal); await signInFixture(bandal)
    const trigger = page.getByRole('button', { name: '계정: 서준', exact: true })
    const menu = page.getByRole('menu', { name: '계정 관리' })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const compact of [false, true]) {
        await app.evaluate(({ BrowserWindow }, compact) => {
          const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
          host.setContentSize(compact ? 1024 : 1440, compact ? 640 : 900)
          host.webContents.setZoomFactor(compact ? 1.25 : 1)
        }, compact)
        await trigger.click(); await expect(menu).toBeVisible(); await assertMenuBounds(page)
        await expect(menu).toContainText('student@example.test')
        expect(await menu.getByRole('menuitem').allTextContents()).toEqual(['계정 설정', '앱 설정', '로그아웃'])
        await captureWindow(bandal, info.outputPath(`profile-${theme}-${compact ? 'compact' : 'wide'}.png`))
        await page.keyboard.press('End'); await expect(menu.getByRole('menuitem', { name: '로그아웃', exact: true })).toBeFocused()
        await page.keyboard.press('Home'); await expect(menu.getByRole('menuitem', { name: '계정 설정', exact: true })).toBeFocused()
        await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: '앱 설정', exact: true })).toBeFocused()
        await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused()
        await page.locator('.global-navigation').getByRole('button', { name: '더 보기', exact: true }).click()
        await expect(page.locator('.help-menu')).toBeVisible()
        await captureWindow(bandal, info.outputPath(`more-${theme}-${compact ? 'compact' : 'wide'}.png`))
        await page.keyboard.press('Escape')
      }
    }
    await trigger.click(); await menu.getByRole('menuitem', { name: '앱 설정', exact: true }).click()
    await expect(page.locator('.shell-settings-overlay')).toBeVisible()
    await page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
    await trigger.click(); await menu.getByRole('menuitem', { name: '로그아웃', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: '로그아웃 중…', exact: true })).toBeDisabled()
    expect(await app.evaluate(() => (globalThis as any).__railSignOut.calls)).toBe(1)
    await app.evaluate(() => (globalThis as any).__railSignOut.release())
    await expect(menu.getByRole('alert')).toContainText('로그아웃')
    await page.keyboard.press('Escape'); await trigger.click()
    await expect(menu.getByRole('alert')).toBeVisible()
    await app.evaluate(() => { (globalThis as any).__railSignOut.fail = false })
    await menu.getByRole('menuitem', { name: '로그아웃', exact: true }).click()
    await app.evaluate(() => (globalThis as any).__railSignOut.release())
    await expect(trigger).toHaveCount(0); await expect(menu).toHaveCount(0)
  } finally { await bandal.app.evaluate(() => (globalThis as any).__railSignOut?.release?.()).catch(() => {}); await bandal.close() }
})
