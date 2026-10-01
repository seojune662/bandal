/** Cold launch must not reinitialize account authentication when navigating. */

import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('cold launch', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('does not repeatedly restore the account session when creating a course', async () => {
    const { page } = bandal
    await page.evaluate(() => {
      const w = window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => unknown }
        __authCalls: number
      }
      w.__authCalls = 0
      const original = w.bandal.invoke.bind(w.bandal)
      w.bandal.invoke = (channel: string, req: unknown) => {
        if (channel === 'auth:getState') w.__authCalls += 1
        return original(channel, req)
      }
    })
    await createCourse(page, '고체역학')

    await expect(page.locator('.app-rail--right')).toBeVisible()
    await expect(page.getByRole('region', { name: '함께하기' })).toHaveCount(0)

    // Every one of these would open the keychain on a signed-in machine.
    const calls = await page.evaluate(
      () => (window as unknown as { __authCalls: number }).__authCalls
    )
    expect(calls).toBe(0)
  })

  test('starts without a right-rail widget until the user adds one', async () => {
    await expect(bandal.page.locator('.widget-dock')).toHaveCount(0)
  })

  test('a new browser tab opens with chrome, named as one', async () => {
    // The app-rendered start page was retired in the Quiet Chrome redesign;
    // a new tab is now an ordinary guest with the toolbar over it.
    const { page } = bandal
    await page.keyboard.press('ControlOrMeta+Shift+KeyB')

    await expect(page.locator('.browser-toolbar').first()).toBeVisible({
      timeout: 15_000
    })
    const title = page.locator('.workspace-tab__title').last()
    await expect(title).toBeVisible()
    // Once the guest responds it may already be "Google"; the regression was
    // exposing the placeholder host name as if it were a meaningful title.
    await expect(title).not.toHaveText('www.google.com')
  })
})
