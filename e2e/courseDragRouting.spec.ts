import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

const folder = (page: Page, name: string) => page.locator('.course-row').filter({
  has: page.locator('.course-row__name', { hasText: new RegExp(`^${name}$`) })
})

test('a cold course finishing loading under a stationary pointer accepts the held tab without another movement', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profileDir = bandal.profileDir
  try {
    let page = bandal.page
    await createCourse(page, '늦은 도착'); await createCourse(page, '로딩 출발')
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const source = courses.find(course => course.name === '로딩 출발')!, target = courses.find(course => course.name === '늦은 도착')!
    writeFileSync(join(source.folderPath, 'held.md'), '# held\n\n보존할 본문\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="held.md"]').click()
    await expect(tab(page, 'held')).toBeVisible()
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    await expect(tab(page, 'held')).toBeVisible()
    await bandal.app.evaluate(({ ipcMain }, targetId) => {
      const original = (ipcMain as any)._invokeHandlers.get('layout:get')
      const probe = { started: false, release: null as (() => void) | null }
      ;(globalThis as any).__coldCourseDrag = probe
      ipcMain.removeHandler('layout:get')
      ipcMain.handle('layout:get', async (event, input) => {
        if (input.courseId === targetId) {
          probe.started = true
          await new Promise<void>(resolve => { probe.release = resolve })
        }
        return original(event, input)
      })
    }, target.id)
    const sourceBox = (await tab(page, 'held').boundingBox())!, row = (await folder(page, target.name).boundingBox())!
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2, { steps: 3 })
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2)
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__coldCourseDrag.started)).toBe(true)
    const canvas = (await page.locator('.workspace-host').boundingBox())!
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await expect(page.locator('.course-tab-move-preview')).toHaveCount(0)
    await bandal.app.evaluate(() => (globalThis as any).__coldCourseDrag.release())
    await expect(page.locator('.course-tab-move-preview')).toBeVisible()
    await page.mouse.up()
    await expect(tab(page, 'held')).toBeVisible()
    await expect(folder(page, target.name)).toHaveAttribute('data-selected', 'true')
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('보존할 본문')
  } finally {
    await bandal.app.evaluate(() => (globalThis as any).__coldCourseDrag?.release?.()).catch(() => {})
    await bandal.close()
  }
})
const tab = (page: Page, title: string) => page.locator('.workspace-course:not([hidden]) .dv-tab').filter({
  has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^${title}$`) })
})

test('fast course entry suspends splitting, keeps the held tab through successive courses, and places it at the chosen position', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    for (const name of ['출발', '경유', '도착']) await createCourse(page, name)
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    for (const name of ['도착', '출발']) {
      const course = courses.find(course => course.name === name)!
      const title = name === '출발' ? 'moving' : 'target'
      writeFileSync(join(course.folderPath, `${title}.md`), `# ${title}\n\n드래그 중 보존할 본문\n`)
      await folder(page, name).locator('.course-row__select').click()
      await page.getByRole('button', { name: '자료 새로고침' }).click()
      await page.locator(`[data-material-path="${title}.md"]`).click()
      await expect(tab(page, title)).toBeVisible()
    }
    const instance = await page.locator('.workspace-panel-content:visible').getAttribute('data-panel-instance')
    const host = page.locator('.workspace-host')
    const begin = async () => {
      const bounds = (await tab(page, 'moving').boundingBox())!
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2, { steps: 3 })
    }
    const enter = async (name: string) => {
      const row = (await folder(page, name).boundingBox())!
      await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2)
      // A row entry must choose its course without a dwell timer or wiggle.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      expect(await folder(page, name).getAttribute('data-selected')).toBe('true')
      await expect(host).toHaveAttribute('data-tab-dragging', 'true')
      await expect(host).toHaveAttribute('data-tab-drag-outside', 'true')
      await expect(page.locator('.course-tab-move-preview:visible, .dv-drop-target-anchor:visible, .dv-drop-target-selection:visible')).toHaveCount(0)
    }
    await begin()
    const canvas = (await page.locator('.workspace-course:not([hidden]) .dv-content-container').boundingBox())!
    await page.mouse.move(canvas.x + canvas.width - 8, canvas.y + canvas.height / 2)
    await expect(page.locator('.course-tab-move-preview')).toContainText('여기에 나누어 놓기')
    const rail = (await page.getByRole('complementary', { name: '과목 목록' }).boundingBox())!
    await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height - 12)
    await expect(page.locator('.course-tab-move-preview:visible, .dv-drop-target-anchor:visible, .dv-drop-target-selection:visible')).toHaveCount(0)
    for (const name of ['경유', '도착', '출발', '도착']) await enter(name)
    const target = (await page.locator('.workspace-course:not([hidden]) .dv-content-container').boundingBox())!
    await page.mouse.move(target.x + target.width - 8, target.y + target.height / 2)
    await expect(page.locator('.course-tab-move-preview')).toContainText('여기에 나누어 놓기')
    await page.mouse.up()
    await expect(tab(page, 'moving')).toBeVisible()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-groupview')).toHaveCount(2)
    await expect(page.locator(`[data-panel-instance="${instance}"]`)).toBeVisible()

    // A second gesture crosses the same boundary and cancels without moving.
    await begin(); await enter('출발')
    await page.keyboard.press('Escape'); await page.mouse.up()
    await expect(folder(page, '도착')).toHaveAttribute('data-selected', 'true')
    await expect(tab(page, 'moving')).toBeVisible()
    await expect(host).not.toHaveAttribute('data-tab-dragging')

    // Re-enter the source and then insert before an existing destination tab.
    await begin(); await enter('출발'); await enter('도착')
    const first = (await tab(page, 'target').boundingBox())!
    await page.mouse.move(first.x + first.width / 4, first.y + first.height / 2)
    await expect(page.locator('.course-tab-move-preview')).toHaveAttribute('data-tab-insertion', 'true')
    await page.mouse.up()
    await expect.poll(() => tab(page, 'target').locator('..').locator('.workspace-tab__title').allTextContents()).toEqual(['moving', 'target'])
    await expect(page.locator(`[data-panel-instance="${instance}"]`)).toBeVisible()
  } finally { await bandal.close() }
})
