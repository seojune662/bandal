import { expect, test } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

/**
 * [v0.98.1] A deep link to a panel below its section's first (⌘/ → 단축키 in 일반)
 * stays in view while the panels above finish loading. On the macos-15 runner the
 * v0.98.0 package scrolled to it, then the panels above grew and pushed it away.
 * CPU throttling reproduces that here (the unfixed build fails with ratio 0).
 */
test('⌘/ keeps the shortcuts panel in view on a slow, short window', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '자료구조')
    await bandal.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 700) })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 })
    for (let round = 0; round < 2; round++) {
      await page.keyboard.press('ControlOrMeta+/')
      await expect(page.locator('.settings-nav [data-category="general"]')).toHaveAttribute('aria-current', 'page')
      await page.waitForTimeout(2500)
      await expect(page.locator('.settings-panel [data-settings-panel="shortcuts"]')).toBeInViewport({ timeout: 1000 })
      await page.keyboard.press('Escape')
      await expect(page.locator('.settings-nav')).toHaveCount(0)
    }
  } finally { await bandal.close() }
})
