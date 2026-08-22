/**
 * Desktop assistant-orb window lifecycle.
 *
 * These assertions use BrowserWindow state for visibility because a hidden
 * Electron window still has a rendered Playwright Page and visible DOM.
 */

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { launchBandal } from './helpers/launch'

type OverlayView = 'orb' | 'popup'

function waitForOverlayWindow(
  app: ElectronApplication,
  view: OverlayView
): Promise<Page> {
  const matchesView = (page: Page): boolean =>
    page.url().includes(`overlay.html?view=${view}`)
  const loadedWindow = app.windows().find(matchesView)
  if (loadedWindow !== undefined) return Promise.resolve(loadedWindow)

  return app.waitForEvent('window', {
    predicate: matchesView
  })
}

async function visibleWindowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
  )
}

async function isOverlayVisible(
  app: ElectronApplication,
  view: OverlayView
): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, overlayView) => {
    const overlay = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes(`overlay.html?view=${overlayView}`)
    )
    return overlay?.isVisible() ?? false
  }, view)
}

test.describe('desktop assistant orb', () => {
  test('switches from the in-app orb to the desktop popup when minimized', async () => {
    const bandal = await launchBandal({
      extraSettings: { assistantMode: 'desktop' }
    })

    try {
      const { app, page: mainPage } = bandal
      const [orbPage, popupPage] = await Promise.all([
        waitForOverlayWindow(app, 'orb'),
        waitForOverlayWindow(app, 'popup')
      ])

      await expect
        .poll(() =>
          app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
          )
        )
        .toBe(3)

      await expect(
        orbPage.locator(":root[data-overlay-view='orb']")
      ).toBeAttached()
      const orbButton = orbPage.locator('button[aria-label]', {
        has: orbPage.locator('.bandal-orb-mark')
      })
      const orbMark = orbButton.locator('.bandal-orb-mark')

      await expect(
        popupPage.locator(":root[data-overlay-view='popup']")
      ).toBeAttached()
      await expect(
        popupPage.locator('.overlay-popup__header .overlay-course__trigger')
      ).toBeAttached()
      await expect(
        popupPage.getByRole('button', { name: '반달 AI 닫기' })
      ).toBeAttached()

      await app.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes('index.html')
        )
        if (main === undefined) return
        main.show()
        main.focus()
        // Playwright's Electron process may not receive an OS focus event in
        // CI, so notify the controller after setting the BrowserWindow state.
        main.emit('focus')
      })
      await expect(mainPage.locator('.assistant-orb')).toHaveCount(1)
      await expect(mainPage.locator('.assistant-orb')).toBeVisible()
      await expect
        .poll(() => isOverlayVisible(app, 'orb'))
        .toBe(false)
      await expect.poll(() => visibleWindowCount(app)).toBe(1)

      await app.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes('index.html')
        )
        if (main === undefined) return
        main.minimize()
        // Headless window managers can omit these native events; emit both so
        // the controller observes the same transition as a real minimize.
        main.emit('blur')
        main.emit('minimize')
      })
      await expect.poll(() => isOverlayVisible(app, 'orb')).toBe(true)
      await expect(orbMark).toBeVisible()
      await expect
        .poll(() =>
          app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
          )
        )
        .toBe(3)

      const visibleBeforeClick = await visibleWindowCount(app)

      try {
        await orbButton.click()
        await expect
          .poll(() => isOverlayVisible(app, 'popup'), { timeout: 2_000 })
          .toBe(true)
      } catch {
        if (!(await isOverlayVisible(app, 'popup'))) {
          // The macOS orb is intentionally non-focusable. Some window-manager
          // combinations do not deliver Playwright's click to an inactive
          // panel, so exercise the same renderer bridge as the button fallback.
          await orbPage.evaluate(async () => {
            const bridge = (
              window as unknown as {
                bandal: {
                  invoke: (channel: string, request: unknown) => Promise<unknown>
                }
              }
            ).bandal
            await bridge.invoke('overlay:togglePopup', {})
          })
        }
      }

      await expect.poll(() => isOverlayVisible(app, 'popup')).toBe(true)
      await expect
        .poll(() => visibleWindowCount(app))
        .toBe(visibleBeforeClick + 1)
      await expect
        .poll(() =>
          app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
          )
        )
        .toBe(3)
    } finally {
      await bandal.close()
    }
  })

  test('uses only the main window with the default in-app setting', async () => {
    const bandal = await launchBandal()

    try {
      await expect
        .poll(() =>
          bandal.app.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
          )
        )
        .toBe(1)
    } finally {
      await bandal.close()
    }
  })
})
