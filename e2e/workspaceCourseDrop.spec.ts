import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

const visibleWorkspace = (page: Page): Locator => page.locator('.workspace-course:not([hidden])')
const folder = (page: Page, name: string): Locator => page.locator('.course-row').filter({ has: page.locator('.course-row__name', { hasText: new RegExp(`^${name}$`) }) })
const tab = (page: Page, title: string): Locator => visibleWorkspace(page).locator('.dv-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^${title}$`) }) })
const groupTitles = (page: Page): Promise<string[][]> => visibleWorkspace(page).locator('.dv-groupview').evaluateAll(groups => groups.map(group => [...group.querySelectorAll('.workspace-tab__title')].map(title => title.textContent ?? '')))

async function beginDrag(page: Page, source: Locator): Promise<void> {
  const box = (await source.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 })
  await expect(page.locator('.workspace-host')).toHaveAttribute('data-tab-dragging', 'true')
}

async function hoverFolder(page: Page, name: string): Promise<void> {
  const box = (await folder(page, name).boundingBox())!
  await page.mouse.move(box.x + Math.min(80, box.width / 2), box.y + box.height / 2, { steps: 8 })
  await page.mouse.move(box.x + Math.min(80, box.width / 2) + 1, box.y + box.height / 2)
  await expect(folder(page, name)).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.course-tab-move-preview:visible')).toHaveCount(0)
  await expect(page.locator('.dv-drop-target-anchor:visible, .dv-drop-target-selection:visible')).toHaveCount(0)
}

async function openNotes(page: Page, course: { name: string; folderPath: string }, prefix: string, count: number): Promise<void> {
  for (let index = 0; index < count; index++) writeFileSync(join(course.folderPath, `${prefix}-${index}.md`), `# ${prefix}-${index}\n\n이동해도 보존하는 본문\n`)
  await folder(page, course.name).locator('.course-row__select').click()
  await page.getByRole('button', { name: '자료 새로고침' }).click()
  for (let index = 0; index < count; index++) await page.locator(`[data-material-path="${prefix}-${index}.md"]`).click()
}

test('multi-tab drags cancel without splitting, drop directly into a cold course, and insert in the chosen target group', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  try {
    let page = bandal.page
    for (const name of ['이동 원본', '빠른 이동 대상', '분할 이동 대상']) await createCourse(page, name)
    const all = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const source = all.find(course => course.name === '이동 원본')!, cold = all.find(course => course.name === '빠른 이동 대상')!, split = all.find(course => course.name === '분할 이동 대상')!
    await openNotes(page, split, 'target', 3)
    await tab(page, 'target-2').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '오른쪽에 분할해서 열기', exact: true }).click()
    await expect(visibleWorkspace(page).locator('.dv-groupview')).toHaveCount(2)
    await openNotes(page, source, 'source', 3)
    await expect.poll(() => page.evaluate(async courseId => Object.keys(((await window.bandal.invoke('layout:get', { courseId })).layout as any)?.panels ?? {}).length, source.id)).toBe(3)
    const profileDir = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    await expect(tab(page, 'source-0')).toBeVisible()
    await expect(page.locator(`[data-workspace-course="${cold.id}"]`)).toHaveCount(0)
    const original = await groupTitles(page)

    // Passing through a split edge and canceling on the sidebar must not turn
    // Dockview's synthetic dragend into a stale split of the three-tab source.
    for (const cancelWithEscape of [true, false]) {
      await beginDrag(page, tab(page, 'source-0'))
      const content = (await visibleWorkspace(page).locator('.dv-content-container').first().boundingBox())!
      // Stay inside the split band beyond the sidebar separator's hit area.
      await page.mouse.move(content.x + 16, content.y + content.height / 2, { steps: 8 })
      await page.mouse.move(content.x + 17, content.y + content.height / 2)
      await expect(page.locator('.course-tab-move-preview')).toBeVisible()
      const heading = (await page.getByRole('complementary', { name: '과목 목록' }).locator('.rail-heading h2').boundingBox())!
      await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2, { steps: 8 })
      await expect(page.locator('.course-tab-move-preview:visible')).toHaveCount(0)
      if (cancelWithEscape) await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
      expect(await groupTitles(page)).toEqual(original)
    }

    // Release before the 300 ms hover timer: the row itself is the destination,
    // including when no target Dockview has been mounted in this app session.
    await page.evaluate(() => {
      document.addEventListener('drop', event => {
        if (!(event.target instanceof Element) || !event.target.closest('.course-row')) return
        ;(window as any).__courseAtDirectDrop = document.querySelector('.course-row[data-selected="true"] .course-row__name')?.textContent
      }, true)
    })
    await beginDrag(page, tab(page, 'source-0'))
    const row = (await folder(page, cold.name).boundingBox())!
    await page.mouse.move(row.x + 80, row.y + row.height / 2, { steps: 8 })
    await page.mouse.move(row.x + 81, row.y + row.height / 2)
    await page.mouse.up()
    expect(await page.evaluate(() => (window as any).__courseAtDirectDrop)).toBe(source.name)
    await expect(folder(page, cold.name)).toHaveAttribute('data-selected', 'true')
    await expect(tab(page, 'source-0')).toBeVisible()
    await expect.poll(() => page.evaluate(async ({ sourceId, targetId }) => {
      const [a, b] = await Promise.all([window.bandal.invoke('layout:get', { courseId: sourceId }), window.bandal.invoke('layout:get', { courseId: targetId })])
      return [Object.keys((a.layout as any)?.panels ?? {}).length, Object.keys((b.layout as any)?.panels ?? {}).length]
    }, { sourceId: source.id, targetId: cold.id })).toEqual([2, 1])
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => { (window as any).__copiedMovedPath = text } })
    })
    await tab(page, 'source-0').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '경로 복사', exact: true }).click()
    expect(await page.evaluate(() => (window as any).__copiedMovedPath)).toBe(join(source.folderPath, 'source-0.md'))

    // Choose a header insertion point in an already split target. The source
    // still has multiple tabs, and unrelated target groups must keep their order.
    await folder(page, source.name).locator('.course-row__select').click()
    await beginDrag(page, tab(page, 'source-1'))
    await hoverFolder(page, split.name)
    const targetGroups = visibleWorkspace(page).locator('.dv-groupview')
    await expect(targetGroups).toHaveCount(2)
    const beforeInsert = await groupTitles(page)
    const targetHeader = targetGroups.first().locator('.dv-tab').nth(1)
    const point = (await targetHeader.boundingBox())!
    await page.mouse.move(point.x + 3, point.y + point.height / 2, { steps: 8 })
    await page.mouse.move(point.x + 4, point.y + point.height / 2)
    await expect(page.locator('.course-tab-move-preview')).toHaveAttribute('data-tab-insertion', 'true')
    await page.mouse.up()
    await expect.poll(() => groupTitles(page)).toEqual([[beforeInsert[0]![0]!, 'source-1', ...beforeInsert[0]!.slice(1)], beforeInsert[1]!])
    const afterInsert = await groupTitles(page)

    // A later canceled hop must restore its origin without losing either pane.
    await beginDrag(page, tab(page, 'source-1'))
    await hoverFolder(page, source.name)
    await page.keyboard.press('Escape'); await page.mouse.up()
    await expect(folder(page, split.name)).toHaveAttribute('data-selected', 'true')
    expect(await groupTitles(page)).toEqual(afterInsert)
    await folder(page, source.name).locator('.course-row__select').click()
    expect(await groupTitles(page)).toEqual([['source-2']])
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('이동해도 보존하는 본문')
  } finally { await bandal.close() }
})
