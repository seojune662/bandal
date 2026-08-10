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
    await page.waitForTimeout(1200)

    // Every one of these would open the keychain on a signed-in machine.
    const calls = await page.evaluate(
      () => (window as unknown as { __authCalls: number }).__authCalls
    )
    expect(calls).toBe(0)

    // And the way back in is still offered, without claiming to be signed out.
    await expect(
      page.getByRole('button', { name: '함께하기 시작하기' })
    ).toBeVisible()
  })

  test('a new browser tab opens the start page, named as one', async () => {
    const { page } = bandal
    await page.keyboard.press('Shift+Meta+KeyB')

    await expect(page.locator('.browser-start')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('.workspace-tab__title', { hasText: '새 탭' })
    ).toBeVisible()
    // The sections that make it feel like a browser rather than a bare field.
    await expect(page.locator('.browser-start__section')).toHaveCount(3)
  })
})
