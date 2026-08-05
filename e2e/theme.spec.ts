import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const SCREENSHOT_DIR = join(__dirname, '__screenshots__')
const VIEWPORT = { width: 1024, height: 640 }

interface BandalBridgeWindow {
  bandal: {
    invoke: (channel: string, req: unknown) => Promise<unknown>
  }
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
}

test.describe('theme', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')

    // Deterministic screenshot geometry: 1024×640 content area.
    await bandal.app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setContentSize(size.width, size.height)
    }, VIEWPORT)
    await expect
      .poll(() => bandal.page.evaluate(() => window.innerWidth))
      .toBe(VIEWPORT.width)
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('renders dark theme without horizontal overflow', async () => {
    const { page } = bandal
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await assertNoHorizontalOverflow(page)
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'theme-dark.png')
    })
  })

  test('switches to light theme via the settings bridge', async () => {
    const { page } = bandal
    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { theme: 'light' })
    })

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await assertNoHorizontalOverflow(page)
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'theme-light.png')
    })

    // Round-trip back to dark: the broadcast keeps working both ways.
    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { theme: 'dark' })
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
