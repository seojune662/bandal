import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

async function beginDrag(page: Page, source: Locator, x: number, y: number): Promise<void> {
  const box = (await source.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 3 })
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.move(x + 1, y)
}

test('reorders, splits, merges, cancels and edge-scrolls tabs without losing edits', async ({}, testInfo) => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profileDir = bandal.profileDir
  try {
    let page = bandal.page
    await createCourse(page, '탭 이동 검사')
    const folder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())!
    const dir = join(bandal.dataRoot, folder.name)
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, `move-${i}.md`), `# 이동 ${i}\n`)
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    for (let i = 0; i < 3; i++) await page.locator(`[data-material-path="move-${i}.md"]`).click()
    const tab = (index: number): Locator => page.locator('.dv-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^move-${index}$`) }) })
    const titles = (): Promise<string[]> => page.locator('.dv-tab .workspace-tab__title').allTextContents()
    await tab(0).click()
    const editor = page.locator('.note-tab:visible .ProseMirror').first()
    await editor.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.keyboard.type(' saved while moving')
    const last = (await tab(2).boundingBox())!
    await beginDrag(page, tab(0), last.x + last.width - 3, last.y + last.height / 2)
    await page.mouse.up()
    await expect.poll(titles).toEqual(['move-1', 'move-2', 'move-0'])
    await expect(editor).toContainText('saved while moving')

    const content = (await page.locator('.dv-content-container:visible').first().boundingBox())!
    await beginDrag(page, tab(0), content.x + content.width - 8, content.y + content.height / 2)
    const drop = page.locator('.dv-drop-target-anchor.dv-drop-target-right:visible').first()
    await expect(drop).toBeVisible()
    await expect.poll(async () => (await drop.boundingBox())!.width).toBeGreaterThan(content.width * 0.4)
    const preview = await drop.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      label: getComputedStyle(element, '::after').content
    }))
    expect(preview.background).toMatch(/(?:\/\s*0\.\d+|rgba\(.+,\s*0\.\d+\))/)
    expect(preview.label).toContain('오른쪽으로 이동')
    await page.screenshot({ path: testInfo.outputPath('tab-drag-dark.png') })
    await page.mouse.up()
    await expect(page.locator('.dv-groupview')).toHaveCount(2)
    await expect(page.locator('.note-tab:visible .ProseMirror').filter({ hasText: 'saved while moving' })).toBeVisible()

    const destination = (await tab(1).boundingBox())!
    await beginDrag(page, tab(0), destination.x + destination.width / 2, destination.y + destination.height / 2)
    await page.mouse.up()
    await expect(page.locator('.dv-groupview')).toHaveCount(1)
    await expect(page.locator('.dv-tab')).toHaveCount(3)
    const order = await titles()
    await beginDrag(page, tab(0), content.x + content.width - 8, content.y + content.height / 2)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect.poll(titles).toEqual(order)
    await expect(page.locator('.dv-groupview')).toHaveCount(1)

    for (let i = 3; i < 20; i++) await page.locator(`[data-material-path="move-${i}.md"]`).click()
    const strip = page.locator('.dv-tabs-container.dv-horizontal')
    await strip.evaluate((node) => { node.scrollLeft = 0 })
    const stripBox = (await strip.boundingBox())!
    await beginDrag(page, page.locator('.dv-tab').first(), stripBox.x + stripBox.width - 3, stripBox.y + stripBox.height / 2)
    await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBeGreaterThan(120)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
    const finalOrder = await titles()
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    await expect.poll(titles).toEqual(finalOrder)
    await page.locator('[data-material-path="move-0.md"]').click()
    await expect(page.locator('.note-tab:visible .ProseMirror').first()).toContainText('saved while moving')
  } finally {
    await bandal.close()
  }
})


for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 640 }]) {
    test(`${theme} ${viewport.width}×${viewport.height}: background close retains focus and every user close can reopen`, async ({}, testInfo) => {
      const bandal = await launchBandal({ extraSettings: { theme } })
      try {
        const page = bandal.page
        const zoomFactor = viewport.width === 1024 ? 1.25 : 1
        await bandal.app.evaluate(({ BrowserWindow }, { size, zoom }) => {
          const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('index.html'))!
          window.setContentSize(size.width, size.height)
          window.webContents.setZoomFactor(zoom)
        }, { size: viewport, zoom: zoomFactor })
        await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
          width: Math.round(viewport.width / zoomFactor),
          height: Math.round(viewport.height / zoomFactor)
        })
        await createCourse(page, '탭 동작 검사')
        const folder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find(entry => entry.isDirectory())!
        const titles = { first: 'first', second: 'second', third: '자료구조 강의와 실습 정리 — 긴 제목 검증' } as const
        for (const title of Object.values(titles)) writeFileSync(join(bandal.dataRoot, folder.name, `${title}.md`), `# ${title}`)
        await page.getByRole('button', { name: '자료 새로고침' }).click()
        for (const title of Object.values(titles)) await page.locator(`[data-material-path="${title}.md"]`).click()
        const tab = (name: keyof typeof titles): Locator => page.locator('.dv-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^${titles[name]}$`) }) })
        await tab('first').click()
        await tab('third').scrollIntoViewIfNeeded()
        await tab('third').hover()
        const longLabel = tab('third').locator('.workspace-tab__title')
        await expect(longLabel).toHaveText(titles.third)
        expect(await longLabel.evaluate(node => ({
          ellipsis: getComputedStyle(node).textOverflow,
          truncated: node.scrollWidth > node.clientWidth
        }))).toEqual({ ellipsis: 'ellipsis', truncated: true })
        const longClose = tab('third').getByRole('button', { name: `${titles.third} 탭 닫기`, exact: true })
        expect(await longClose.evaluate(node => {
          const button = node.getBoundingClientRect()
          const tab = node.closest('.dv-tab')!.getBoundingClientRect()
          return button.left >= Math.max(0, tab.left) && button.right <= Math.min(innerWidth, tab.right) &&
            button.top >= Math.max(0, tab.top) && button.bottom <= Math.min(innerHeight, tab.bottom)
        })).toBe(true)
        await longClose.click()
        await expect(tab('first')).toHaveClass(/dv-active-tab/)
        await expect(tab('third')).toHaveCount(0)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T')
        await expect(tab('third')).toHaveClass(/dv-active-tab/)
        await tab('first').click()
        await tab('second').click({ button: 'middle' })
        await expect(tab('first')).toHaveClass(/dv-active-tab/)
        await expect(tab('second')).toHaveCount(0)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+T' : 'Control+Shift+T')
        await expect(tab('second')).toHaveClass(/dv-active-tab/)
        await expect.poll(() => page.locator('.dv-tab .workspace-tab__title').allTextContents()).toEqual(Object.values(titles))
        await tab('second').focus()
        await page.keyboard.press('ArrowRight')
        await expect(tab('third')).toBeFocused()
        await expect(tab('third')).toHaveAttribute('aria-selected', 'true')
        // Deferred editor creation must not take focus back from keyboard tab navigation.
        await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText(titles.third)
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect(tab('third')).toBeFocused()
        await tab('third').evaluate(node => {
          node.addEventListener('dragstart', event => {
            node.setAttribute('data-e2e-drag-label', (event as DragEvent).dataTransfer?.getData('text/plain') ?? '')
          }, { once: true })
        })
        const content = (await page.locator('.dv-content-container:visible').first().boundingBox())!
        await beginDrag(page, tab('third'), content.x + 8, content.y + content.height / 2)
        await expect(tab('third')).toHaveAttribute('data-e2e-drag-label', titles.third)
        const drop = page.locator('.dv-drop-target-anchor.dv-drop-target-left:visible').first()
        await expect(drop).toBeVisible()
        await expect.poll(async () => (await drop.boundingBox())!.width).toBeGreaterThan(content.width * 0.4)
        expect(await drop.evaluate(element => getComputedStyle(element, '::after').content)).toContain('왼쪽으로 이동')
        expect(await drop.evaluate(element => getComputedStyle(element, '::after').whiteSpace)).toBe('normal')
        const screenshotName = `tab-drag-${theme}-${viewport.width}.png`
        await page.screenshot({ path: testInfo.outputPath(screenshotName) })
        const screenshotDir = process.env['BANDAL_E2E_SHOT_DIR']
        if (screenshotDir) {
          mkdirSync(screenshotDir, { recursive: true })
          await page.screenshot({ path: join(screenshotDir, screenshotName) })
        }
        await page.keyboard.press('Escape')
        await page.mouse.up()
        await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
        await expect(page.locator('.dv-groupview')).toHaveCount(1)
      } finally { await bandal.close() }
    })
  }
}
