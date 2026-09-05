import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

/**
 * [v0.40] Catalog install end to end against the live official index: the
 * card appears, 설치 downloads + verifies + unpacks the zip, and the card
 * flips to 설치됨. Needs network; skipped when the index is unreachable.
 */
test.describe('plugin catalog', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('installs the official sample extension from the catalog', async () => {
    const { page } = bandal
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav [data-category="packs"]').click()
    const card = page.locator('.settings-catalog-card').first()
    try {
      await expect(card).toBeVisible({ timeout: 20_000 })
    } catch {
      test.skip(true, 'catalog index unreachable')
    }
    await expect(card).toContainText('bandal')
    await card.getByRole('button', { name: '설치' }).click()
    await expect(card).toContainText('설치됨', { timeout: 30_000 })
    await expect(page.locator('.settings-catalog-card')).toHaveCount(1)
  })
})
