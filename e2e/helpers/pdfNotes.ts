import { expect, type Page } from '@playwright/test'

/** The shared paper sheet is the sole entry for a new editable PDF notebook. */
export async function createPdfNote(page: Page, title = '노트 검증'): Promise<void> {
  await page.getByRole('tab', { name: '자료', exact: true }).click()
  await page.getByRole('button', { name: '생성하기', exact: true }).click()
  await page.getByRole('menuitem', { name: '새 노트', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '새 노트', exact: true })
  await sheet.getByLabel('제목').fill(title)
  await sheet.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(page.locator('.pdf-page[data-pdf-page="1"]:visible')).toBeVisible({ timeout: 30000 })
}
