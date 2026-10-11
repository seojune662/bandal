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

test('multi-tab drags cancel without splitting, enter and drop into a cold course, and insert in the chosen target group', async () => {
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

    // Entering the row selects the destination immediately, including when its
    // Dockview has not mounted yet. Releasing there completes the held transfer.
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
    await expect(folder(page, cold.name)).toHaveAttribute('data-selected', 'true')
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-tab-dragging', 'true')
    await page.mouse.up()
    expect(await page.evaluate(() => (window as any).__courseAtDirectDrop)).toBe(cold.name)
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
    // Leave the selected folder horizontally before moving up to its header.
    // A diagonal path would enter other course rows and correctly select them.
    const selectedRow = (await folder(page, split.name).boundingBox())!
    await page.mouse.move(point.x + 3, selectedRow.y + selectedRow.height / 2, { steps: 8 })
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

test('repeated last-tab moves recover the course welcome after cancel, retry, close and restart', async ({}, info) => {
  test.setTimeout(180_000)
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const stages: string[] = []
  try {
    let page = bandal.page
    const names = ['반복 이동 원본', '반복 이동 둘', '반복 이동 셋', '반복 이동 넷']
    for (const name of names) await createCourse(page, name)
    const all = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const courseCycle = names.map(name => all.find(course => course.name === name)!)
    const welcome = async (name: string): Promise<void> => {
      await expect(visibleWorkspace(page).locator('.dv-tab')).toHaveCount(0)
      await expect(visibleWorkspace(page).locator('.workspace-welcome h1')).toHaveText(name)
      await expect(visibleWorkspace(page).locator('.workspace-watermark__moon')).toBeVisible()
      await expect(page.locator('.workspace-panel-content:visible')).toHaveCount(0)
    }
    await openNotes(page, courseCycle[0]!, 'repeat', 1)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('이동해도 보존하는 본문')
    await page.evaluate(() => { (window as any).__repeatMoveEditor = document.querySelector('.note-tab .ProseMirror') })

    // More courses than the retained-workspace limit exercise both mounted and
    // rehydrated destinations. Every retry starts from a real canceled drag.
    for (let index = 0; index < 8; index++) {
      const source = courseCycle[index % courseCycle.length]!
      const destination = courseCycle[(index + 1) % courseCycle.length]!
      stages.push(`cancel ${index}: ${source.name} -> ${destination.name}`)
      await beginDrag(page, tab(page, 'repeat-0'))
      await hoverFolder(page, destination.name)
      await welcome(destination.name)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(folder(page, source.name)).toHaveAttribute('data-selected', 'true')
      await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
      await expect(tab(page, 'repeat-0')).toBeVisible()

      stages.push(`move ${index}: ${source.name} -> ${destination.name}`)
      await beginDrag(page, tab(page, 'repeat-0'))
      await hoverFolder(page, destination.name)
      if (index % 2 === 0) {
        const bounds = (await visibleWorkspace(page).boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 10 })
        await page.mouse.move(bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2)
        await expect(page.locator('.course-tab-move-preview')).toBeVisible()
      }
      await page.mouse.up()
      await expect(folder(page, destination.name)).toHaveAttribute('data-selected', 'true')
      await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
      await expect(tab(page, 'repeat-0')).toBeVisible()
      await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('이동해도 보존하는 본문')
      expect(await page.evaluate(() => (window as any).__repeatMoveEditor === document.querySelector('.note-tab:has(.ProseMirror) .ProseMirror'))).toBe(true)
      await expect.poll(() => page.locator('.workspace-panel-content:visible').evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const workspace = document.querySelector('.workspace-course:not([hidden])')!.getBoundingClientRect()
        return bounds.width > 100 && bounds.height > 100 && bounds.left >= workspace.left - 1 && bounds.right <= workspace.right + 1
      })).toBe(true)
      await expect.poll(() => page.evaluate(async ({ sourceId, targetId }) => {
        const layouts = await Promise.all([sourceId, targetId].map(courseId => window.bandal.invoke('layout:get', { courseId })))
        return layouts.map(({ layout }) => Object.keys((layout as any)?.panels ?? {}).length)
      }, { sourceId: source.id, targetId: destination.id })).toEqual([0, 1])
      await folder(page, source.name).locator('.course-row__select').click()
      await welcome(source.name)
      await folder(page, destination.name).locator('.course-row__select').click()
      await expect(tab(page, 'repeat-0')).toBeVisible()
    }

    const finalCourse = courseCycle[0]!
    stages.push('close last tab')
    await tab(page, 'repeat-0').getByRole('button', { name: 'repeat-0 탭 닫기', exact: true }).click()
    await welcome(finalCourse.name)
    await expect.poll(() => page.evaluate(async courseId => Object.keys(((await window.bandal.invoke('layout:get', { courseId })).layout as any)?.panels ?? {}).length, finalCourse.id)).toBe(0)
    stages.push('restart empty courses')
    const profileDir = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    await expect(folder(page, finalCourse.name)).toHaveAttribute('data-selected', 'true')
    for (const course of courseCycle) {
      await folder(page, course.name).locator('.course-row__select').click()
      await welcome(course.name)
    }
    await page.screenshot({ path: info.outputPath('repeated-last-tab-welcome-restored.png') })
  } catch (error) {
    await info.attach('repeated-move-stages', { body: JSON.stringify(stages, null, 2), contentType: 'application/json' })
    await bandal.page.screenshot({ path: info.outputPath('repeated-last-tab-move-failure.png') }).catch(() => {})
    throw error
  } finally { await bandal.close() }
})

test('a whole-group merge keeps inactive tabs accessible and draggable to another course', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '그룹 합치기 원본')
    await createCourse(page, '그룹 합치기 도착')
    const all = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const source = all.find(course => course.name === '그룹 합치기 원본')!
    const destination = all.find(course => course.name === '그룹 합치기 도착')!
    await openNotes(page, source, 'group', 4)
    await page.getByRole('button', { name: '자료 사이드바 접기', exact: true }).click()

    // Put one note below the other three so the source header has usable blank
    // space for Dockview's native whole-group drag handle.
    const content = (await visibleWorkspace(page).locator('.dv-content-container').boundingBox())!
    await beginDrag(page, tab(page, 'group-3'))
    await page.mouse.move(content.x + content.width / 2, content.y + content.height - 8, { steps: 10 })
    await page.mouse.move(content.x + content.width / 2 + 1, content.y + content.height - 8)
    await expect(page.locator('.course-tab-move-preview')).toBeVisible()
    await page.mouse.up()
    await expect.poll(() => groupTitles(page)).toEqual([['group-0', 'group-1', 'group-2'], ['group-3']])
    await tab(page, 'group-2').click()
    await expect(tab(page, 'group-0')).toHaveAttribute('aria-selected', 'false')
    await page.evaluate(() => { (window as any).__groupMergeEditor = [...document.querySelectorAll('.ProseMirror')].find(element => element.textContent?.includes('group-0')) })

    const groups = visibleWorkspace(page).locator('.dv-groupview')
    const handle = (await groups.first().locator('.dv-void-container').boundingBox())!
    expect(handle.width).toBeGreaterThan(8)
    const target = (await groups.nth(1).locator('.dv-content-container').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 12, handle.y + handle.height / 2, { steps: 3 })
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
    await page.mouse.move(target.x + target.width / 2 + 1, target.y + target.height / 2)
    await page.mouse.up()
    await expect(groups).toHaveCount(1)
    await expect.poll(() => groupTitles(page)).toEqual([['group-3', 'group-0', 'group-1', 'group-2']])
    for (const title of ['group-0', 'group-1']) {
      await expect(tab(page, title)).toHaveAttribute('role', 'tab')
      await expect(tab(page, title)).toHaveAttribute('aria-selected', 'false')
    }

    // These headers were inactive throughout the merge, so no visibility event
    // can be relied upon to restore their drag and keyboard handlers.
    await beginDrag(page, tab(page, 'group-0'))
    await hoverFolder(page, destination.name)
    await page.mouse.up()
    await expect(tab(page, 'group-0')).toBeVisible()
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('group-0')
    expect(await page.locator('.note-tab:visible .ProseMirror').evaluate(element => element === (window as any).__groupMergeEditor)).toBe(true)
    await folder(page, source.name).locator('.course-row__select').click()
    await expect.poll(() => groupTitles(page)).toEqual([['group-3', 'group-1', 'group-2']])
  } finally { await bandal.close() }
})
