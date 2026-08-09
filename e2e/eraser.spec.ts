import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('eraser', () => {
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '알고리즘')
  })
  test.afterAll(async () => { await bandal.close() })

  test('an erased stroke stays gone after leaving and coming back', async () => {
    const { page } = bandal
    await page.locator('.whiteboards-group').getByRole('button', { name: '새 화이트보드 만들기' }).click()
    const layer = page.locator('.ink-layer')
    await expect(layer).toBeVisible()
    const box = (await layer.boundingBox())!

    await page.getByRole('button', { name: /펜/ }).first().click()
    await page.mouse.move(box.x + 150, box.y + 150)
    await page.mouse.down()
    await page.mouse.move(box.x + 420, box.y + 300, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.ink-layer path')).toHaveCount(1)
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: /지우개/ }).first().click()
    await page.mouse.move(box.x + 150, box.y + 150)
    await page.mouse.down()
    await page.mouse.move(box.x + 420, box.y + 300, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.ink-layer path')).toHaveCount(0)
    await page.waitForTimeout(1200)

    // Leave and come back — a tab close drops the component entirely.
    await page.locator('.workspace-tab', { hasText: '화이트보드' })
      .getByRole('button', { name: /탭 닫기/ }).click()
    await page.waitForTimeout(500)
    await page.locator('.whiteboards-group__row').first().click()
    await expect(page.locator('.ink-layer')).toBeVisible()
    await page.waitForTimeout(1500)

    console.log('AFTER REOPEN paths=', await page.locator('.ink-layer path').count())
    await expect(page.locator('.ink-layer path')).toHaveCount(0)
  })
})
