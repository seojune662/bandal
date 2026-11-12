import { expect, type Page } from '@playwright/test'

const aiButton = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: 'AI', exact: true })

/** The rail's AI button opens AI in the slot beside the rail; this only ever opens it. */
export async function openAiRail(page: Page): Promise<void> {
  if (await aiButton(page).getAttribute('aria-expanded') !== 'true') await aiButton(page).click()
  await expect(aiButton(page)).toHaveAttribute('aria-expanded', 'true')
}

/** Pressing the open AI button folds it. */
export async function closeAiRail(page: Page): Promise<void> {
  await aiButton(page).click()
  await expect(aiButton(page)).toHaveAttribute('aria-expanded', 'false')
}

/** Home and AI share one slot: opening AI folds home away; bring it back. */
export async function showCourseRail(page: Page): Promise<void> {
  if (await page.locator('#course-rail[aria-hidden="true"]').count()) await page.getByRole('button', { name: '홈', exact: true }).click()
  await expect(page.locator('#course-rail')).not.toHaveAttribute('aria-hidden', 'true')
}

/** Help, community, plugins and updates moved from the rail into the profile menu. */
export async function openProfileItem(page: Page, name: string | RegExp): Promise<void> {
  const menu = page.getByRole('menu', { name: '프로필' })
  if (!await menu.isVisible()) await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: /^프로필/ }).click()
  await menu.getByRole('menuitem', { name }).click()
}
