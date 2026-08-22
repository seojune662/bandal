/**
 * Two things about a cold launch.
 *
 * 1. The macOS keychain prompt was reported FOUR times. Decrypting a stored
 *    group session is legitimate — but it was happening at startup, for every
 *    student, including ones who never open 함께하기. Restoring the session is
 *    now tied to actually using it, so a plain launch must never ask.
 * 2. A fresh browser tab shows the app's own start page. It used to be named
 *    after the placeholder URL, so the tab said "www.google.com" while the
 *    student was looking at 어디로 갈까요?.
 */

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

  test('does not restore the auth session until it is used', async () => {
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

    // The signed-out card is the stable post-create DOM state. Waiting for it
    // replaces a clock delay and verifies the real entry point students see.
    const together = page.getByRole('region', { name: '함께하기' })
    await expect(together).toContainText('친구들과 같이 하려면 로그인해요')
    await expect(
      together.getByRole('button', { name: '로그인', exact: true })
    ).toBeVisible()

    // Every one of these would open the keychain on a signed-in machine.
    const calls = await page.evaluate(
      () => (window as unknown as { __authCalls: number }).__authCalls
    )
    expect(calls).toBe(0)
  })

  test('a new browser tab opens with chrome, named as one', async () => {
    // The app-rendered start page was retired in the Quiet Chrome redesign;
    // a new tab is now an ordinary guest with the toolbar over it.
    const { page } = bandal
    await page.keyboard.press('Shift+Meta+KeyB')

    await expect(page.locator('.browser-toolbar').first()).toBeVisible({
      timeout: 15_000
    })
    await expect(
      page.locator('.workspace-tab__title', { hasText: '새 탭' })
    ).toBeVisible()
  })
})
