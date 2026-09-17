import { expect, test, type Locator, type Page } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
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

test('reorders, splits, merges, cancels and edge-scrolls tabs without losing edits', async () => {
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
