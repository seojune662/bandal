import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_CATEGORIES } from '../src/shared/settingsCategories'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

/**
 * [v0.37] Settings shell smoke: every category renders, row search finds a
 * setting inside a panel, ⌘/ lands on the shortcuts panel. Screenshots are
 * written only when BANDAL_E2E_SHOT_DIR is set (they are review aids, not
 * fixtures).
 */
const SHOT_DIR = process.env['BANDAL_E2E_SHOT_DIR']
const VIEWPORT = { width: 1280, height: 800 }

async function shot(bandal: BandalApp, name: string): Promise<void> {
  if (SHOT_DIR === undefined) return
  mkdirSync(SHOT_DIR, { recursive: true })
  await bandal.page.screenshot({ path: join(SHOT_DIR, `${name}.png`) })
}

test.describe('settings shell', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')
    await bandal.app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
    }, VIEWPORT)
    await expect
      .poll(() => bandal.page.evaluate(() => window.innerWidth))
      .toBe(VIEWPORT.width)
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('every category opens from the sidebar', async () => {
    const { page } = bandal
    await page.keyboard.press('Meta+,')
    const nav = page.locator('.settings-nav')
    await expect(nav).toBeVisible()
    await expect(nav.locator('.settings-nav__group-label')).toHaveCount(7)

    // The launcher disables safeStorage, so the encrypted registry (mcp) and
    // saved logins (university) render without a keychain prompt.
    for (const { id } of SETTINGS_CATEGORIES) {
      const item = nav.locator(`[data-category="${id}"]`)
      await expect(item).toBeVisible()
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.settings-panel')).toBeVisible()
      await shot(bandal, `settings-${id}`)
    }
  })

  test('row search surfaces the category that holds the setting', async () => {
    const { page } = bandal
    if ((await page.locator('.settings-nav').count()) === 0) {
      await page.keyboard.press('Meta+,')
    }
    const search = page.locator('.settings-search input')
    await search.fill('기본 줌')
    const nav = page.locator('.settings-nav')
    await expect(nav.locator('[data-category="browser"]')).toBeVisible()
    await expect(nav.locator('[data-category="about"]')).toHaveCount(0)
    await expect(nav.locator('.settings-nav__hits')).toContainText('기본 줌')
    await shot(bandal, 'settings-search')
    await search.fill('')
  })

  test('⌘/ opens the shortcuts panel directly', async () => {
    const { page } = bandal
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-nav')).toHaveCount(0)
    await page.keyboard.press('Meta+/')
    await expect(
      page.locator('.settings-nav [data-category="shortcuts"]')
    ).toHaveAttribute('aria-current', 'page')
  })
})
