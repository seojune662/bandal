import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { startFileServer, type FileServer } from './helpers/fileServer'

// Local fixture pages exercise real webview navigation and persisted history.
test.describe('browser address and shortcuts', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  let server: FileServer
  const path = '/watch?v=lecture&list=course&reload=9&app=desktop&hl=ko&gl=KR'
  let url: string

  test.beforeAll(async () => {
    const html = (title: string) => ({
      fileName: 'page.html', attachment: false, contentType: 'text/html; charset=utf-8',
      body: `<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`
    })
    server = await startFileServer({
      [path]: html('동역학 강의 자료'), '/other': html('다른 페이지')
    })
    url = `${server.origin}${path}`
    bandal = await launchBandal()
    await createCourse(bandal.page, '브라우저 검증')
    const page = bandal.page
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByLabel('새 탭 검색').fill(url)
    await page.getByRole('option', { name: `${url} 열기` }).click()
    await expect(page.locator('.workspace-tab__title', { hasText: '동역학 강의 자료' })).toBeVisible()
  })
  test.afterAll(async () => {
    await bandal?.close()
    await server?.close()
  })

  test('compact display keeps the actual URL and focus selects it in full', async () => {
    const page = bandal.page
    const input = page.getByRole('combobox', { name: '주소 또는 검색어' })
    await expect(page.locator('.browser-address__display')).toHaveText(server.origin)
    await input.click()
    await expect(input).toHaveValue(url)
    expect(await input.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart!, node.selectionEnd!))).toBe(url)
    await input.press('Enter')
    await expect(input).toHaveValue(url)
    await expect(page.locator('.browser-address__display')).toHaveText(server.origin)
    await input.click()
    await input.fill('취소할 검색어')
    await input.press('Escape')
    await expect(input).toHaveValue(url)
    await expect(page.getByRole('listbox', { name: '주소 및 검색 제안' })).toHaveCount(0)
  })

  test('recent visits appear under shortcuts, and mouse selection navigates over the guest', async () => {
    const page = bandal.page
    const input = page.getByRole('combobox', { name: '주소 또는 검색어' })
    await input.click()
    await input.fill(`${server.origin}/other`)
    await input.press('Enter')
    await expect(page.locator('.workspace-tab__title', { hasText: '다른 페이지' })).toBeVisible()
    await input.click()
    const list = page.getByRole('listbox', { name: '주소 및 검색 제안' })
    const history = list.locator('[data-kind=history]').filter({ hasText: '동역학 강의 자료' })
    await expect(history).toBeVisible()
    await expect(list).toContainText('바로가기')
    await input.fill('자료 동역학')
    await expect(history).toBeVisible()
    await expect(list.getByRole('option').first()).toHaveAttribute('data-kind', 'search')
    await page.screenshot({ path: '/tmp/bandal-browser-address-dark.png' })
    // A real mouse click proves the portal is above the separately hosted webview.
    await history.click()
    await expect(input).toHaveValue(url)
    await expect(page.locator('.workspace-tab__title', { hasText: '동역학 강의 자료' })).toBeVisible()
  })

  test('keyboard selection opens a shortcut and Escape cancels without navigation', async () => {
    const page = bandal.page
    const input = page.getByRole('combobox', { name: '주소 또는 검색어' })
    await input.click()
    await input.fill('다른 페이지')
    const history = page.locator('.browser-suggestion[data-kind=history]').filter({ hasText: '다른 페이지' })
    await expect(history).toBeVisible()
    await input.press('ArrowDown')
    await expect(history).toHaveAttribute('aria-selected', 'true')
    await input.press('Enter')
    await expect(input).toHaveValue(`${server.origin}/other`)
    await input.click()
    await input.fill('동역학')
    await input.press('Escape')
    await expect(input).toHaveValue(`${server.origin}/other`)
  })

  test('suggestions stay visible at narrow sizes and large zoom', async () => {
    const page = bandal.page
    await page.getByRole('button', { name: '자료 사이드바 접기', exact: true }).click()
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setMinimumSize(640, 480)
      window.setContentSize(820, 560)
      window.webContents.setZoomFactor(1.25)
    })
    const input = page.getByRole('combobox', { name: '주소 또는 검색어' })
    await input.click()
    await input.fill('동역학')
    const list = page.getByRole('listbox', { name: '주소 및 검색 제안' })
    await expect(list.locator('[data-kind=history]')).toBeVisible()
    expect(await list.evaluate((node) => {
      const r = node.getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    })).toBe(true)
    await page.screenshot({ path: '/tmp/bandal-browser-address-small.png' })
    await input.press('Escape')
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.webContents.setZoomFactor(1)
      window.setContentSize(1440, 900)
    })
  })
})
