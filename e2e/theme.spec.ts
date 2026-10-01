import { expect, test, type Page } from '@playwright/test'
import { launchBandal } from './helpers/launch'

async function expectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--bg-app')
          .trim()
      )
    )
    .toBe(theme === 'light' ? '#ffffff' : '#212121')
  expect(await page.locator('html').getAttribute('data-palette')).toBeNull()
}

test('system is the installation default and synchronizes the main window', async () => {
  const bandal = await launchBandal({
    extraSettings: { theme: undefined }
  })
  try {
    const { app, page } = bandal
    const settings = await page.evaluate(() =>
      window.bandal.invoke('settings:get', {})
    )
    expect(settings.theme).toBe('system')
    for (const window of app.windows())
      await window.emulateMedia({ colorScheme: null })
    for (const theme of ['light', 'dark', 'light'] as const) {
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme
      }, theme)
      await expectTheme(page, theme)
      const backgrounds = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((win) =>
            /index.html/.test(win.webContents.getURL())
          )
          .map((win) => win.getBackgroundColor().toLowerCase())
      )
      expect(backgrounds).toEqual([
        theme === 'light' ? '#ffffff' : '#212121'
      ])
    }
    await page.evaluate(() =>
      window.bandal.invoke('settings:set', { theme: 'dark' })
    )
    await expectTheme(page, 'dark')
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await expectTheme(page, 'dark')
  } finally {
    await bandal.close()
  }
})

test('legacy themes migrate by brightness and stored palettes cannot override the application', async () => {
  const bandal = await launchBandal({ keepProfileOnClose: true })
  const profileDir = bandal.profileDir
  try {
    for (const [legacy, theme] of [
      ['midnight', 'dark'],
      ['graphite', 'dark'],
      ['sepia', 'light'],
      ['high-contrast', 'light']
    ] as const) {
      await bandal.page.evaluate(async (theme) => {
        await (
          window.bandal.invoke as (
            channel: string,
            req: unknown
          ) => Promise<unknown>
        )('settings:set', {
          theme,
          palette: 'moss',
          pluginTheme: 'example-theme:green',
          fontScale: 1.1,
          editorFont: 'serif',
          density: 'compact'
        })
      }, legacy)
      await expectTheme(bandal.page, theme)
      expect(
        (
          await bandal.page.evaluate(() =>
            window.bandal.invoke('settings:get', {})
          )
        ).theme
      ).toBe(theme)
    }
  } finally {
    await bandal.close()
  }
  const restored = await launchBandal({ reuseProfileDir: profileDir })
  try {
    await expectTheme(restored.page, 'light')
    await expect(restored.page.locator('html')).toHaveAttribute(
      'data-editor-font',
      'serif'
    )
    await expect(restored.page.locator('html')).toHaveAttribute(
      'data-density',
      'compact'
    )
    await restored.page
      .getByRole('button', { name: '설정', exact: true })
      .click()
    await restored.page.locator('[data-category="appearance"]').click()
    const choices = restored.page.getByRole('radiogroup', { name: '테마 선택' })
    await expect(choices.getByRole('radio')).toHaveCount(3)
    await choices.getByRole('radio', { name: /^라이트/ }).focus()
    await restored.page.keyboard.press('ArrowRight')
    await expectTheme(restored.page, 'dark')
    await expect(choices.getByRole('radio', { name: /^다크/ })).toBeFocused()
  } finally {
    await restored.close()
  }
})
