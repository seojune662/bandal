import { expect, test, type Locator } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('menus in short and zoomed windows', () => {
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '화면 경계 검증')
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setContentSize(1024, 640)
      window.webContents.setZoomFactor(1.25)
    })
  })
  test.afterAll(async () => { await bandal?.close() })
  const expectInside = async (locator: Locator) => {
    await expect(locator).toBeVisible()
    await expect.poll(() => locator.evaluate(node => {
      const r = node.getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    })).toBe(true)
  }

  test('course actions stay reachable when anchored near the screen edge', async () => {
    const page = bandal.page
    await page.getByRole('button', { name: '화면 경계 검증 과목 메뉴', exact: true }).click()
    const menu = page.getByRole('menu', { name: '화면 경계 검증 과목 메뉴', exact: true })
    await expectInside(menu)
    await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded()
    await expectInside(menu.getByRole('menuitem').last())
    await page.keyboard.press('Escape')
  })

  test('new-tab and help menus fit and remain scrollable', async () => {
    const page = bandal.page
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    const menu = page.getByRole('dialog', { name: '새 탭 열기' })
    await expectInside(menu)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '도움말', exact: true }).click()
    await expectInside(page.locator('.help-menu'))
    const last = page.locator('.help-menu').getByRole('menuitem').last()
    await last.scrollIntoViewIfNeeded()
    await expectInside(last)
    await page.keyboard.press('Escape')
  })
})
