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
