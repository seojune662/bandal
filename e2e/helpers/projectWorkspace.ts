import { expect, type Page } from '@playwright/test'

export async function showProjects(page: Page): Promise<void> {
  await page.locator('.app-rail:not([hidden])').getByRole('tab', { name: '프로젝트', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '프로젝트 목록', exact: true })).toBeVisible()
}
export async function newProject(page: Page): Promise<void> {
  await showProjects(page)
  await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
  await page.getByRole('menuitem', { name: '새 프로젝트', exact: true }).click()
}
export async function openProjectResource(page: Page, title: string): Promise<void> {
  const toggle = page.getByRole('button', { name: '오른쪽 사이드바 펼치기', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByRole('tab', { name: '자료', exact: true }).click()
  await page.locator('.project-materials').getByRole('button', { name: title === '단어장' ? /^단어장(?:\s|$)/ : title, exact: title !== '단어장' }).click()
}
export async function projectSettings(page: Page, name: string): Promise<void> {
  await showProjects(page)
  await page.getByRole('complementary', { name: '프로젝트 목록', exact: true }).getByRole('button', { name: `${name} 더보기`, exact: true }).click()
  await page.getByRole('menuitem', { name: '프로젝트 설정', exact: true }).click()
}
