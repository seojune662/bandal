import { expect, test } from '@playwright/test'
import { launchBandal, type BandalApp } from './helpers/launch'

/**
 * Settings search + deep links (Orca-style catalog): the sidebar keeps only
 * matching categories, panels hide non-matching rows, ⌘P lists settings and
 * jumps to the row, and kit controls persist through settings:set.
 */
test.describe('settings search and deep links', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('a query filters categories and rows; Esc clears before it closes', async () => {
    const { page } = bandal
    await page.keyboard.press('ControlOrMeta+,')
    const nav = page.locator('.settings-nav')
    await expect(nav).toBeVisible()
    const search = page.locator('.settings-search input')
    await search.fill('다크')
    await expect(nav.locator('[data-category="appearance"]')).toBeVisible()
    await expect(nav.locator('[data-category="general"]')).toHaveCount(0)
    await expect(nav.locator('[data-category="appearance"]')).toHaveAttribute('aria-current', 'page')
    // English aliases reach Korean rows.
    await search.fill('search engine')
    await expect(nav.locator('[data-category="browser"]')).toBeVisible()
    await search.fill('존재하지않는설정')
    await expect(page.getByText('“존재하지않는설정”에 맞는 설정이 없습니다.')).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(nav).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nav).toHaveCount(0)
  })

  test('⌘P lists settings and deep-links to the highlighted row', async () => {
    const { page } = bandal
    await page.keyboard.press('ControlOrMeta+p')
    const input = page.getByRole('combobox', { name: '파일 검색어' })
    await expect(input).toBeEnabled()
    await input.fill('검색 엔진')
    const option = page.getByRole('option').filter({ hasText: '설정 · 브라우저' }).first()
    await expect(option).toBeVisible()
    await option.click()
    await expect(page.locator('.settings-nav [data-category="browser"]')).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.settings-panel [data-highlighted="true"]')).toContainText('검색 엔진')
  })

  test('a kit switch saves through settings:set and survives reopening', async () => {
    const { page } = bandal
    await page.locator('.settings-nav [data-category="general"]').click()
    const row = page.locator('[data-settings-target="general.tabs.openBeside"]')
    const toggle = row.getByRole('switch')
    const before = await toggle.getAttribute('aria-checked')
    await toggle.click()
    const expected = before === 'true' ? false : true
    await expect
      .poll(() => page.evaluate(() => window.bandal.invoke('settings:get', {}).then(s => s.openAdjacentTab)))
      .toBe(expected)
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="general"]').click()
    await expect(page.locator('[data-settings-target="general.tabs.openBeside"]').getByRole('switch')).toHaveAttribute('aria-checked', String(expected))
  })
})
