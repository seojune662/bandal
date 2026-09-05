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

/** The resolved `--bg-app` — the one token both axes can move. */
async function readBgApp(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-app')
      .trim()
  )
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
      path: join(SCREENSHOT_DIR, 'theme-dark.png'),
      animations: 'disabled'
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
      path: join(SCREENSHOT_DIR, 'theme-light.png'),
      animations: 'disabled'
    })

    // Round-trip back to dark: the broadcast keeps working both ways.
    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { theme: 'dark' })
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('layers a palette over the mode without changing it', async () => {
    const { page } = bandal
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'bandal')
    const bandalBg = await readBgApp(page)

    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { palette: 'moss' })
    })

    // The mode is untouched; only the color family moved.
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'moss')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await readBgApp(page)).not.toBe(bandalBg)
    await assertNoHorizontalOverflow(page)
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'palette-moss-dark.png'),
      animations: 'disabled'
    })

    // A flat mode: 이끼 re-tints the accent but must inherit 흑연's gray surfaces.
    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { theme: 'graphite' })
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite')
    const mossGraphite = await readBgApp(page)

    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { palette: 'bandal' })
    })
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'bandal')
    expect(await readBgApp(page)).toBe(mossGraphite)

    await page.evaluate(async () => {
      const bridge = (window as unknown as BandalBridgeWindow).bandal
      await bridge.invoke('settings:set', { theme: 'dark' })
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})
