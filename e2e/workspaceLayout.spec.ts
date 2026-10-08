import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

async function chooseLayout(page: Page, name: string): Promise<void> {
  const layout = page.getByRole('button', { name: '작업 공간 배치', exact: true }).first()
  if (await layout.isVisible()) {
    await layout.click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else {
    await page.locator('.workspace-course:not([hidden]) .workspace-open-tabs-button').first().click()
    await page.getByRole('dialog', { name: /열린 탭/ }).getByRole('button', { name, exact: true }).click()
  }
}

async function resizeAt(page: Page, sash: Locator, direction: 'x' | 'y', fraction: number): Promise<void> {
  const box = (await sash.boundingBox())!
  const point = direction === 'x'
    ? { x: box.x + box.width / 2, y: box.y + box.height * fraction }
    : { x: box.x + box.width * fraction, y: box.y + box.height / 2 }
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.dv-sash'), point)).toBe(true)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + (direction === 'x' ? 36 : 0), point.y + (direction === 'y' ? 28 : 0), { steps: 8 })
  await page.mouse.up()
}

for (const scenario of [{ theme: 'dark', width: 1440, height: 900, zoom: 1 }, { theme: 'light', width: 1024, height: 640, zoom: 1.25 }] as const) {
  test(`${scenario.theme} ${scenario.width} four panes retain editors, resize through content and restore empty cells`, async ({}, info) => {
    test.setTimeout(150_000)
    let bandal = await launchBandal({ keepProfileOnClose: true, extraSettings: { theme: scenario.theme } })
    const profile = bandal.profileDir
    try {
      let page = bandal.page
      await bandal.app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        host.setContentSize(width, height); host.webContents.setZoomFactor(zoom)
      }, scenario)
      await createCourse(page, '네 영역 검증')
      const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
      const course = courses.find(entry => entry.name === '네 영역 검증')!
      for (let index = 0; index < 12; index++) writeFileSync(join(course.folderPath, `pane-${index}.md`), `# pane-${index}\n\nDraft ${index}\n`)
      await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
      for (let index = 0; index < 12; index++) await page.locator(`[data-material-path="pane-${index}.md"]`).click()
      await page.getByRole('button', { name: '자료 사이드바 접기', exact: true }).click()
      await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '과목', exact: true }).click()
      const editor = page.locator('.note-tab:visible .ProseMirror')
      await editor.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
      await page.keyboard.type(' preserved draft')
      await editor.evaluate(element => { (window as any).__preservedPaneEditor = element })
      await chooseLayout(page, '2×2 4분할')
      const workspace = page.locator('.workspace-course:not([hidden])')
      let groups = workspace.locator('.dv-groupview')
      await expect(groups).toHaveCount(4)
      await expect(workspace.locator('.dv-active-tab')).toHaveCount(4)
      await expect(page.locator('.note-tab:visible .ProseMirror')).toHaveCount(4)
      expect(await page.evaluate(() => (window as any).__preservedPaneEditor.isConnected && (window as any).__preservedPaneEditor.textContent.includes('preserved draft'))).toBe(true)
      expect(await workspace.locator('.workspace-chrome-spacer').count()).toBeLessThanOrEqual(1)
      await expect(page.getByRole('button', { name: '자료 사이드바 펼치기', exact: true })).toHaveCount(1)
      const before = await groups.first().boundingBox()
      const vertical = workspace.locator('.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled').first()
      for (const fraction of [0.05, 0.5, 0.94]) await resizeAt(page, vertical, 'x', fraction)
      await expect.poll(async () => (await groups.first().boundingBox())!.width).not.toBe(before!.width)
      const horizontal = workspace.locator('.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled').first()
      await resizeAt(page, horizontal, 'y', 0.6)
      // The last pane is focused; opening from the first pane must honor its +.
      const first = groups.first()
      await first.getByRole('button', { name: '새 탭 열기', exact: true }).click()
      await page.locator('.new-tab-menu').getByRole('option').filter({ hasText: '새 마크다운' }).first().click()
      await expect(first.locator('.dv-tab')).toHaveCount(4)
      expect(await groups.evaluateAll(elements => elements.map(element => element.querySelectorAll('.dv-tab').length))).toEqual([4, 3, 3, 3])
      for (let count = 4; count > 0; count--) {
        await first.locator('.dv-tab').first().click({ button: 'middle' })
        await expect(first.locator('.dv-tab')).toHaveCount(count - 1)
      }
      await expect(groups).toHaveCount(4)
      await expect(page.locator('.workspace-empty-pane')).toHaveCount(1)
      await page.screenshot({ path: info.outputPath('four-panes.png') })
      await bandal.close()
      bandal = await launchBandal({ reuseProfileDir: profile })
      page = bandal.page
      groups = page.locator('.workspace-course:not([hidden]) .dv-groupview')
      await expect(groups).toHaveCount(4)
      await expect(page.locator('.workspace-empty-pane')).toHaveCount(1)
      await expect(page.locator('.note-tab:visible .ProseMirror').filter({ hasText: 'preserved draft' })).toHaveCount(1)
      await page.getByRole('button', { name: '빈 영역 닫기', exact: true }).click()
      await expect(groups).toHaveCount(3)
      await chooseLayout(page, '단일 영역')
      await expect(groups).toHaveCount(1)
      await expect(groups.locator('.dv-tab')).toHaveCount(9)
    } finally { await bandal.close() }
  })
}
