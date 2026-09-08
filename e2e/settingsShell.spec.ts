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
    await page.keyboard.press('Meta+,')
    const nav = page.locator('.settings-nav')
    await expect(nav).toBeVisible()
    await expect(nav.locator('.settings-nav__group-label')).toHaveCount(SETTINGS_GROUPS.length)

    // The launcher disables safeStorage, so the encrypted registry (mcp) and
    // saved logins (university) render without a keychain prompt.
    for (const { id } of SETTINGS_CATEGORIES) {
      const item = nav.locator(`[data-category="${id}"]`)
      await expect(item).toBeVisible()
      await item.click()
      await expect(item).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.settings-panel')).toBeVisible()

      const clippedCards = await page.locator('.settings-card').evaluateAll(
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
      await page.keyboard.press('Meta+,')
    }
    const search = page.locator('.settings-search input')
    await search.fill('기본 줌')
    const nav = page.locator('.settings-nav')
    await expect(nav.locator('[data-category="browser"]')).toBeVisible()
    await expect(nav.locator('[data-category="about"]')).toHaveCount(0)
    await expect(nav.locator('.settings-nav__hits')).toContainText('기본 줌')
    await nav.locator('.settings-search-hit', { hasText: '기본 줌' }).click()
    await expect(page.locator('.settings-panel [data-search-match="true"]')).toContainText('기본 줌')
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

  test('keeps selectable content and footer actions inset from card outlines', async () => {
    const { page } = bandal
    const nav = page.locator('.settings-nav')

    await nav.locator('[data-category="university"]').click()
    await page.getByRole('option', { name: /^서울대학교/ }).click()
    const universityCard = page.locator('.settings-card').first()
    const clearUniversity = universityCard.getByRole('button', {
      name: '학교 선택 해제'
    })
    await expect(clearUniversity).toBeVisible()
    const universityInset = await universityCard.evaluate((card) => {
      const action = card.querySelector('.settings-card__footer-row button')
      if (!(action instanceof HTMLElement)) return null
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
    const densityCard = page.locator('.settings-card', {
      has: page.getByRole('heading', { name: '밀도' })
    })
    const densityGap = await densityCard.evaluate((card) => {
      const choices = card.querySelectorAll('.theme-grid--density .theme-choice')
      const lastChoice = choices.item(choices.length - 1)
      if (!(lastChoice instanceof HTMLElement)) return null
      return card.getBoundingClientRect().bottom - lastChoice.getBoundingClientRect().bottom
    })
    expect(densityGap).toBeGreaterThanOrEqual(16)

    await nav.locator('[data-category="advanced"]').click()
    const maintenanceCard = page.locator('.settings-card').last()
    const dangerGap = await maintenanceCard.evaluate((card) => {
      const row = card.querySelector('.settings-advanced-danger-row')
      if (!(row instanceof HTMLElement)) return null
      return card.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom
    })
    expect(dangerGap).toBeGreaterThanOrEqual(0)
  })
})
