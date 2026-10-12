import { expect, type Locator, type Page } from '@playwright/test'

/** Use the same visible toolbar or overflow-menu route available to a person. */
export async function clickBrowserToolbarAction(
  page: Page,
  name: string,
  panel: Locator = page.locator('.browser-panel:visible').first()
): Promise<void> {
  const toolbar = panel.locator('.browser-toolbar')
  await expect(toolbar).toBeVisible()
  const direct = toolbar.getByRole('button', { name, exact: true })
  if (await direct.isVisible()) {
    await direct.click()
    return
  }

  await toolbar.getByRole('button', { name: '브라우저 도구 더 보기', exact: true }).click()
  const menu = page.getByRole('dialog', { name: '브라우저 도구', exact: true })
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name, exact: true }).click()
  await expect(menu).toHaveCount(0)
}
