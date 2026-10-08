import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

test('four panes with both sidebars open keep 32px tabs and all actions reachable at minimum width', async () => {
  test.setTimeout(150_000)
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const page = bandal.page
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      host.setContentSize(1024, 800); host.webContents.setZoomFactor(1.25)
    })
    await createCourse(page, '좁은 탭 검증')
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const course = courses.find(entry => entry.name === '좁은 탭 검증')!
    for (let index = 0; index < 20; index++) writeFileSync(join(course.folderPath, `narrow-${index}.md`), `# narrow-${index}\n\nDraft ${index}\n`)
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    for (let index = 0; index < 20; index++) await page.locator(`[data-material-path="narrow-${index}.md"]`).click()
    await page.getByRole('button', { name: '작업 공간 배치', exact: true }).click()
    await page.getByRole('menuitem', { name: '2×2 4분할', exact: true }).click()
    const workspace = page.locator('.workspace-course:not([hidden])')
    const groups = workspace.locator('.dv-groupview')
    await expect(groups).toHaveCount(4)
    await expect(workspace.locator('[data-tab-header-compact]')).toHaveCount(4)
    await expect.poll(() => groups.evaluateAll(elements => elements.every(group => {
      const selected = group.querySelectorAll<HTMLElement>('.dv-tab[aria-selected="true"]')
      return selected.length === 1 && selected[0]!.classList.contains('dv-active-tab') && selected[0]!.tabIndex === 0
    }))).toBe(true)
    const first = groups.first()
    const sash = workspace.locator('.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled').first()
    const boundary = (await sash.boundingBox())!
    await page.mouse.move(boundary.x + boundary.width / 2, boundary.y + boundary.height / 2)
    await page.mouse.down(); await page.mouse.move(boundary.x - 250, boundary.y + boundary.height / 2, { steps: 12 }); await page.mouse.up()
    // Dockview enforces100px before subtracting each column's4px gutter share.
    await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBeGreaterThanOrEqual(96)
    await expect.poll(async () => Math.round((await first.boundingBox())!.width)).toBeLessThanOrEqual(100)
    await expect.poll(() => workspace.locator('.dv-tabs-and-actions-container').evaluateAll(headers => headers.every(header => {
      const bounds = header.getBoundingClientRect()
      const list = header.querySelector<HTMLElement>('.workspace-open-tabs-button')!
      const button = list.getBoundingClientRect()
      const tabs = [...header.querySelectorAll<HTMLElement>('.dv-tab:not([data-tab-overflow])')]
      return button.width >= 32 && button.left >= bounds.left - 1 && button.right <= bounds.right + 1 &&
        tabs.length > 0 && tabs.some(tab => tab.classList.contains('dv-active-tab')) && tabs.every(tab => {
          const box = tab.getBoundingClientRect()
          return box.width >= 31.9 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1
        })
    }))).toBe(true)
    await expect(first.locator('.workspace-add-tab')).toBeHidden()
    await first.getByRole('button', { name: /열린 탭 .*개 목록/ }).click()
    const list = page.getByRole('dialog', { name: /열린 탭/ })
    await expect(list.locator('.workspace-open-tabs-menu__row')).toHaveCount(5)
    await expect(list.getByRole('button', { name: '2×2 4분할', exact: true })).toBeVisible()
    await list.getByRole('button', { name: '새 탭 열기', exact: true }).click()
    await expect(list).toBeHidden()
    await page.locator('.new-tab-menu').getByRole('option').filter({ hasText: '새 마크다운' }).first().click()
    await expect(first.locator('.dv-tab')).toHaveCount(6)
    await expect(first.locator('.dv-active-tab')).toBeVisible()
    expect((await first.locator('.dv-active-tab').boundingBox())!.width).toBeGreaterThanOrEqual(31.9)
    await first.getByRole('button', { name: /열린 탭 .*개 목록/ }).click()
    await page.getByRole('dialog', { name: /열린 탭/ }).getByRole('button', { name: '단일 영역', exact: true }).click()
    await expect(groups).toHaveCount(1)
    await expect(groups.locator('.dv-active-tab')).toBeFocused()
  } finally { await bandal.close() }
})
