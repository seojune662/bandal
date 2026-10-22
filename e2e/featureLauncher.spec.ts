import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })
const launcher = (page: Page) => page.getByRole('complementary', { name: '앱 더보기' })
const feature = (page: Page, label: string) => launcher(page).locator('.launcher-feature').filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${label}$`) }) })
async function openLauncher(page: Page): Promise<void> {
  const opening = !await launcher(page).isVisible()
  if (opening) await rail(page).getByRole('button', { name: '더보기', exact: true }).click()
  await expect(launcher(page)).toBeVisible()
  if (opening) await expect(launcher(page).getByLabel('기능 검색')).toBeFocused()
}

test('launcher preserves search and rail width across courses while installed extension availability updates immediately', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '기능 첫 과목')
    await openLauncher(page)
    const initial = (await launcher(page).boundingBox())!.width
    const resizer = await page.getByRole('separator', { name: '과목 사이드바 폭 조절' }).boundingBox()
    await page.mouse.move(resizer!.x + resizer!.width / 2, resizer!.y + 80)
    await page.mouse.down(); await page.mouse.move(resizer!.x + resizer!.width / 2 + 60, resizer!.y + 80); await page.mouse.up()
    await expect.poll(async () => Math.round((await launcher(page).boundingBox())!.width)).toBe(Math.round(initial + 60))
    await expect(launcher(page).locator('[data-kind="pack"]')).toHaveCount(0)
    await launcher(page).getByLabel('기능 검색').fill('단어 수')
    await rail(page).getByRole('button', { name: '홈', exact: true }).click()
    await createCourse(page, '기능 둘째 과목')
    await openLauncher(page)
    await expect(launcher(page).getByLabel('기능 검색')).toHaveValue('단어 수')
    await expect(launcher(page).getByRole('region', { name: '현재 실행 대상' })).toHaveCount(0)
    expect(Math.round((await launcher(page).boundingBox())!.width)).toBe(Math.round(initial + 60))
    await page.evaluate(path => window.bandal.invoke('plugins:installFromFolder', { path }), resolve(__dirname, '../examples/plugins/word-count'))
    await launcher(page).getByLabel('기능 검색').fill('단어 수')
    const command = feature(page, '현재 과목 필기 단어 수').getByRole('button').first()
    await expect(command).toBeDisabled()
    await page.evaluate(async () => {
      await window.bandal.invoke('plugins:approve', { id: 'bandal.word-count' })
      await window.bandal.invoke('plugins:setEnabled', { id: 'bandal.word-count', enabled: true })
    })
    await expect(command).toBeEnabled()
    await command.click()
    await expect(page.getByText('기능 둘째 과목: 단어 0개 · 글자 0자', { exact: false })).toBeVisible()
    await feature(page, '단어 수').getByRole('button').first().click()
    await expect(page.locator('.plugin-panel[data-state="active"] webview')).toBeAttached()
    await expect.poll(() => bandal.app.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('bandal-plugin://bandal.word-count/ui/') && !contents.isLoading()))).toBe(true)
    await page.evaluate(() => window.bandal.invoke('plugins:setEnabled', { id: 'bandal.word-count', enabled: false }))
    await expect(command).toBeDisabled()
    await expect(feature(page, '단어 수').getByRole('button').first()).toBeDisabled()
    await page.screenshot({ path: info.outputPath('launcher-installed-features.png') })
  } finally { await bandal.close() }
})
