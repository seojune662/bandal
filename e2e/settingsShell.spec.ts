import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_CATEGORIES, SETTINGS_GROUPS } from '../src/shared/settingsCategories'
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
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('.settings-nav')
    await expect(nav).toBeVisible()
    await expect(nav.locator('.settings-nav__group-label')).toHaveCount(SETTINGS_GROUPS.length)

    // 동기화 ships with the iPad app: listed only under BANDAL_SYNC_UI=1.
    await expect(nav.locator('[data-category="sync"]')).toHaveCount(process.env['BANDAL_SYNC_UI'] === '1' ? 1 : 0)
    // The launcher disables safeStorage, so the encrypted registry (mcp) and
    // saved logins (university) render without a keychain prompt.
    for (const { id } of SETTINGS_CATEGORIES.filter(({ id }) => id !== 'sync' || process.env['BANDAL_SYNC_UI'] === '1')) {
      const item = nav.locator(`[data-category="${id}"]`)
      await expect(item).toBeVisible()
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.settings-panel')).toBeVisible()

      const clippedCards = await page.locator('.settings-panel [data-settings-group] > div.rounded-lg').evaluateAll(
        (cards) =>
          cards
            .map((card, index) => ({
              index,
              horizontal: card.scrollWidth - card.clientWidth,
              vertical: card.scrollHeight - card.clientHeight
            }))
            .filter(
              ({ horizontal, vertical }) => horizontal > 1 || vertical > 1
            )
      )
      expect(clippedCards, `${id} 설정 카드가 내용을 잘라서는 안 됩니다`).toEqual([])
      await shot(bandal, `settings-${id}`)
    }
  })

  test('row search surfaces the category that holds the setting', async () => {
    const { page } = bandal
    if ((await page.locator('.settings-nav').count()) === 0) {
      await page.keyboard.press('ControlOrMeta+,')
    }
    const search = page.locator('.settings-search input')
    await search.fill('기본 줌')
    const nav = page.locator('.settings-nav')
    await expect(nav.locator('[data-category="browser"]')).toBeVisible()
    await expect(nav.locator('[data-category="about"]')).toHaveCount(0)
    // Matching rows are listed under their category; unrelated rows are filtered out.
    await expect(nav.locator('.settings-search-hit', { hasText: '기본 줌' })).toBeVisible()
    const panel = page.locator('.settings-panel')
    await expect(panel.locator('[data-settings-target="browser.general.zoom"]')).toBeVisible()
    await expect(panel.locator('[data-settings-target="browser.general.homePage"]')).toHaveCount(0)
    await nav.locator('.settings-search-hit', { hasText: '기본 줌' }).click()
    // A hit deep-links: the row is scrolled to and highlighted for a moment.
    await expect(panel.locator('[data-highlighted="true"]')).toContainText('기본 줌')
    await shot(bandal, 'settings-search')
    await search.fill('')
    // Clearing the query brings every row back.
    await expect(panel.locator('[data-settings-target="browser.general.homePage"]')).toHaveCount(1)
  })

  test('⌘/ opens the shortcuts panel directly', async () => {
    const { page } = bandal
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-nav')).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+/')
    await expect(
      page.locator('.settings-nav [data-category="shortcuts"]')
    ).toHaveAttribute('aria-current', 'page')
  })

  test('keeps selectable content and footer actions inset from card outlines', async () => {
    const { page } = bandal
    const nav = page.locator('.settings-nav')

    await nav.locator('[data-category="university"]').click()
    await page.getByRole('option', { name: /^서울대학교/ }).click()
    const universityCard = page.locator('[data-settings-group="university.school"]')
    const clearUniversity = universityCard.getByRole('button', {
      name: '학교 선택 해제'
    })
    await expect(clearUniversity).toBeVisible()
    const universityInset = await clearUniversity.evaluate((action) => {
      // The kit card is the banded box holding the rows.
      const card = action.closest('[data-settings-target]')?.parentElement
      if (!(card instanceof HTMLElement)) return null
      const outer = card.getBoundingClientRect()
      const inner = action.getBoundingClientRect()
      return {
        left: inner.left - outer.left,
        bottom: outer.bottom - inner.bottom
      }
    })
    expect(universityInset?.left).toBeGreaterThanOrEqual(16)
    expect(universityInset?.bottom).toBeGreaterThanOrEqual(12)
    await shot(bandal, 'settings-university-selected')

    await nav.locator('[data-category="appearance"]').click()
    const densityGroup = page.locator('[data-settings-group="appearance.density"]')
    const densityGap = await densityGroup.evaluate((group) => {
      const choices = group.querySelectorAll('[role="radiogroup"] [role="radio"]')
      const lastChoice = choices.item(choices.length - 1)
      if (!(lastChoice instanceof HTMLElement)) return null
      return group.getBoundingClientRect().bottom - lastChoice.getBoundingClientRect().bottom
    })
    expect(densityGap).toBeGreaterThanOrEqual(16)
  })
})
