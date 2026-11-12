import { expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

/**
 * v0.96 design refresh: the iPad layout, glass and decor palettes, captured on
 * synthetic data. Screenshots go to BANDAL_UI_ARTIFACTS for the comparison
 * page; assertions cover the rail's one-slot rule and the palette's reach.
 */
test('design refresh: rail slot, glass and palettes', async ({}, info) => {
  test.setTimeout(240_000)
  const bandal = await launchBandal()
  const { page, app } = bandal
  const dir = process.env.BANDAL_UI_ARTIFACTS ?? info.outputPath('screens')
  mkdirSync(dir, { recursive: true })
  const shot = (name: string) => page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled' })
  const settle = () => page.waitForTimeout(450)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('appleCalendar:state')
      ipcMain.handle('appleCalendar:state', () => ({ supported: false, authorization: 'not-determined', connected: false, calendars: [], selectedCalendarIds: [], destinationCalendarId: null }))
      ipcMain.removeHandler('agent:models')
      ipcMain.handle('agent:models', () => ({ models: [] }))
    })
    await createCourse(page, '운동체역학')
    await createCourse(page, '선형대수')
    const [course] = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    copyFileSync(join(__dirname, '../web-demo/public/sample.pdf'), join(course!.folderPath, 'Lecture.pdf'))
    writeFileSync(join(course!.folderPath, '강의 정리.md'), '# 강의 정리\n\n오늘의 학습 목표\n\n- 운동 방정식 이해하기\n- 예제의 좌표계 정하기\n')
    await page.evaluate(async () => window.bandal.invoke('settings:set', {
      university: { ...(await window.bandal.invoke('settings:get', {})).university, universityId: 'snu' },
      homeSites: { pinned: [], hidden: [], custom: [{ id: 'custom:chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/' }, { id: 'custom:notion', title: 'Notion', url: 'https://www.notion.so/' }] }
    }))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440)

    const home = page.getByRole('button', { name: '홈', exact: true })
    const ai = page.getByRole('button', { name: 'AI', exact: true })
    const shell = page.locator('.app-shell')

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.bandal.invoke('settings:set', { theme, decor: { palette: 'dawn', intensity: 0.55 } }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.locator('[data-material-path="강의 정리.md"]').click().catch(() => undefined)
      await settle()
      await shot(`home-${theme}`)

      // One slot: AI replaces home; pressing the open one folds it.
      await ai.click()
      await expect(shell).toHaveAttribute('data-ai-rail', 'open')
      await expect(shell).toHaveAttribute('data-course-rail', 'closed')
      await settle()
      await shot(`ai-${theme}`)
      await ai.click()
      await expect(shell).toHaveAttribute('data-ai-rail', 'closed')
      await settle()
      await shot(`closed-${theme}`)
      await home.click()
      await expect(shell).toHaveAttribute('data-course-rail', 'open')
      await expect(shell).toHaveAttribute('data-ai-rail', 'closed')

      await page.getByRole('button', { name: /^프로필/ }).click()
      await expect(page.getByRole('menu', { name: '프로필' })).toBeVisible()
      await settle()
      await shot(`profile-${theme}`)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: '학업 보드 열기', exact: true }).click()
      await expect(page.locator('.board')).toBeVisible()
      await settle()
      await shot(`board-${theme}`)
      await page.locator('.board-overlay__close').click()

      await page.getByRole('button', { name: '설정', exact: true }).click()
      await page.locator('.settings-nav__item[data-category="appearance"]').click()
      await expect(page.getByRole('radiogroup', { name: '색 선택' })).toBeVisible()
      await settle()
      await shot(`settings-${theme}`)
      await page.keyboard.press('Escape')
    }

    // Every palette reaches the glass: rail and selection change with it.
    const rails = new Set<string>()
    for (const palette of ['dawn', 'blossom', 'sunset', 'forest', 'ocean', 'lavender', 'ink', 'mono']) {
      await page.evaluate(palette => window.bandal.invoke('settings:set', { theme: 'light', decor: { palette, intensity: 0.75 } } as never), palette)
      await expect(page.locator('html')).toHaveAttribute('data-decor', palette)
      rails.add(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-selection')))
      await settle()
      await shot(`palette-${palette}`)
    }
    expect(rails.size).toBe(8)

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 680))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1024)
    await page.evaluate(() => window.bandal.invoke('settings:set', { decor: { palette: 'ocean', intensity: 0.55 } } as never))
    await settle()
    await shot('narrow-light')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    // The greeting a returning user sees once after the update.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('bandal:open-design-refresh')))
    await expect(page.getByRole('dialog', { name: '반달이 새로워졌어요' })).toBeVisible()
    await settle()
    await shot('welcome-light')
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await settle()
    await shot('welcome-dark')
    expect(errors).toEqual([])
  } finally {
    await bandal.close()
  }
})

test('the design greeting shows once to returning users, before the iPad news, and sets the decor', async () => {
  const first = await launchBandal({ keepProfileOnClose: true, extraSettings: { dismissedAnnouncements: [] } })
  try {
    const dialog = first.page.getByRole('dialog', { name: '반달이 새로워졌어요' })
    await expect(dialog).toBeVisible()
    await expect(first.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toHaveCount(0)
    await dialog.getByRole('radio', { name: '다크', exact: true }).click()
    await expect(first.page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await dialog.getByRole('radio', { name: /숲/ }).click()
    await expect(first.page.locator('html')).toHaveAttribute('data-decor', 'forest')
    await dialog.getByRole('button', { name: '시작하기' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => first.page.evaluate(() => window.bandal.invoke('settings:get', {}))).toMatchObject({ theme: 'dark', decor: { palette: 'forest' }, dismissedAnnouncements: ['design-refresh-0-96'] })
  } finally { await first.close() }
  const second = await launchBandal({ reuseProfileDir: first.profileDir })
  try {
    await expect(second.page.locator('html')).toHaveAttribute('data-decor', 'forest')
    await expect(second.page.getByRole('dialog', { name: 'iPad에서도 반달' })).toBeVisible({ timeout: 5_000 })
    await expect(second.page.getByRole('dialog', { name: '반달이 새로워졌어요' })).toHaveCount(0)
  } finally { await second.close() }
})

test('first-run users pick the color in onboarding instead', async () => {
  const bandal = await launchBandal({ extraSettings: { dismissedAnnouncements: [], onboarding: { flowVersion: 0, closedAt: null, lastCompletedStep: 0 } } })
  try {
    const card = bandal.page.locator('.onboarding-card')
    await expect(card).toBeVisible()
    await card.getByRole('radio', { name: /바다/ }).click()
    await expect(bandal.page.locator('html')).toHaveAttribute('data-decor', 'ocean')
    await bandal.page.waitForTimeout(1_500)
    await expect(bandal.page.getByRole('dialog', { name: '반달이 새로워졌어요' })).toHaveCount(0)
  } finally { await bandal.close() }
})
