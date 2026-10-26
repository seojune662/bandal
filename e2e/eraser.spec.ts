import { createPdfNote } from './helpers/pdfNotes'
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
    await createPdfNote(page, '지우개 검증')
    await page.getByRole('button', { name: '주석 도구', exact: true }).click()
    const layer = page.locator('.ink-layer')
    await expect(layer).toBeVisible()
    const box = (await layer.boundingBox())!

    await page.getByRole('button', { name: '펜', exact: true }).click()
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.ink-layer path')).toHaveCount(1)
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: '지우개', exact: true }).click()
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4, { steps: 15 })
    await page.mouse.up()
    await expect(page.locator('.ink-layer path')).toHaveCount(0)
    await page.waitForTimeout(1200)

    // Leave and come back — a tab close drops the component entirely.
    await page.locator('.workspace-tab', { hasText: '지우개 검증' })
      .getByRole('button', { name: /탭 닫기/ }).click()
    await page.waitForTimeout(500)
    await page.locator('[data-material-path$="지우개 검증.pdf"]').click()
    await expect(page.locator('.ink-layer')).toBeVisible()
    await page.waitForTimeout(1500)

    await expect(page.locator('.ink-layer path')).toHaveCount(0)
  })
})
