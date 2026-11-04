import { expect, type Page } from '@playwright/test'

/** The left AI column's pull tab is a toggle; this only ever opens it. */
export async function openAiRail(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'AI 열기', exact: true })
  if (await open.isVisible()) await open.click()
  await expect(page.getByRole('button', { name: 'AI 닫기', exact: true })).toBeVisible()
}

export async function closeAiRail(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'AI 닫기', exact: true }).click()
  await expect(page.getByRole('button', { name: 'AI 열기', exact: true })).toBeVisible()
}

/** Opening AI in a narrow window (e.g. Windows CI) collapses the course sidebar; bring it back. */
export async function showCourseRail(page: Page): Promise<void> {
  if (await page.locator('#course-rail[aria-hidden="true"]').count()) await page.getByRole('button', { name: '홈', exact: true }).click()
  await expect(page.locator('#course-rail')).not.toHaveAttribute('aria-hidden', 'true')
}
