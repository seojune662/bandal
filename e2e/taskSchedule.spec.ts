import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('academic calendar schedule ranges', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  let prefix: string
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '일정 검증')
    prefix = await bandal.page.evaluate(() => {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    await bandal.page.getByRole('button', { name: '학업 보드 열기', exact: true }).click()
    await bandal.page.getByRole('button', { name: '달력', exact: true }).click()
  })
  test.afterAll(async () => { await bandal?.close() })

  test('a 23:59 deadline stays on one day', async () => {
    const page = bandal.page
    await page.locator(`[data-date-key="${prefix}-08"] .calendar-day__number`).click()
    const form = page.locator('.calendar-form')
    await form.getByLabel('제목', { exact: true }).fill('하루 마감 과제')
    await form.getByLabel('하루 종일', { exact: true }).uncheck()
    await form.getByLabel('마감 시각', { exact: true }).fill('23:59')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator(`[data-date-key="${prefix}-08"] .calendar-entry`).filter({ hasText: '하루 마감 과제' })).toBeVisible()
    await expect(page.locator(`[data-date-key="${prefix}-09"] .calendar-entry`)).toHaveCount(0)
    const task = await page.evaluate(async () => (await window.bandal.invoke('board:listTasks', {})).find(t => t.title === '하루 마감 과제'))
    expect(task?.startAt).toBeNull()
  })

  test('creates an inclusive three-day event and preserves its range in the board editor', async () => {
    const page = bandal.page
    await page.locator(`[data-date-key="${prefix}-10"] .calendar-day__number`).click()
    const form = page.locator('.calendar-form')
    await form.getByLabel('제목', { exact: true }).fill('사흘 프로젝트')
    await form.getByLabel('기간 지정', { exact: true }).check()
    await form.getByLabel('종료일', { exact: true }).fill(`${prefix}-12`)
    await form.getByRole('button', { name: '저장', exact: true }).click()
    for (const day of ['10', '11', '12']) {
      await expect(page.locator(`[data-date-key="${prefix}-${day}"] .calendar-entry`).filter({ hasText: '사흘 프로젝트' })).toBeVisible()
    }
    await expect(page.locator(`[data-date-key="${prefix}-13"] .calendar-entry`)).toHaveCount(0)
    await page.getByRole('button', { name: '목록', exact: true }).click()
    await page.getByRole('button', { name: '사흘 프로젝트 상세 편집', exact: true }).click()
    const editor = page.locator('.board-editor')
    await expect(editor.getByLabel('기간 지정')).toBeChecked()
    await expect(editor.getByLabel('시작일', { exact: true })).toHaveValue(`${prefix}-10`)
    await expect(editor.getByLabel('종료일', { exact: true })).toHaveValue(`${prefix}-12`)
    await editor.getByLabel('제목', { exact: true }).fill('수정한 사흘 프로젝트')
    await editor.getByRole('button', { name: '저장', exact: true }).click()
    await page.getByRole('button', { name: '달력', exact: true }).click()
    await expect(page.locator('.calendar-entry').filter({ hasText: '수정한 사흘 프로젝트' })).toHaveCount(3)
  })

  test('validates times, keeps midnight exclusive and can return to a single-day deadline', async () => {
    const page = bandal.page
    await page.locator(`[data-date-key="${prefix}-15"] .calendar-day__number`).click()
    const form = page.locator('.calendar-form')
    await form.getByLabel('제목', { exact: true }).fill('시간 지정 실험')
    await form.getByLabel('기간 지정').check()
    await form.getByLabel('하루 종일').uncheck()
    await form.getByLabel('시작 시각').fill('20:00')
    await form.getByLabel('종료 시각').fill('19:00')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('종료 날짜와 시각')
    await form.getByLabel('종료일', { exact: true }).fill(`${prefix}-16`)
    await form.getByLabel('종료 시각').fill('00:00')
    await page.screenshot({ path: '/tmp/bandal-schedule-range.png' })
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator(`[data-date-key="${prefix}-15"] .calendar-entry`).filter({ hasText: '시간 지정 실험' })).toBeVisible()
    await expect(page.locator(`[data-date-key="${prefix}-16"] .calendar-entry`)).toHaveCount(0)
    // Reload the calendar from the database before editing.
    await page.getByRole('button', { name: '목록', exact: true }).click()
    await page.getByRole('button', { name: '달력', exact: true }).click()
    await page.locator(`[data-date-key="${prefix}-15"] .calendar-entry`).filter({ hasText: '시간 지정 실험' }).click()
    await expect(form.getByLabel('시작 시각')).toHaveValue('20:00')
    await expect(form.getByLabel('종료 시각')).toHaveValue('00:00')
    await form.getByLabel('기간 지정').uncheck()
    await form.getByLabel('하루 종일').check()
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator(`[data-date-key="${prefix}-16"] .calendar-entry`).filter({ hasText: '시간 지정 실험' })).toBeVisible()
    await expect(page.locator(`[data-date-key="${prefix}-15"] .calendar-entry`)).toHaveCount(0)
  })

  test('keeps editing and context menus inside a resized, zoomed window', async () => {
    const page = bandal.page
    await page.getByRole('button', { name: '목록', exact: true }).click()
    await page.getByRole('button', { name: '수정한 사흘 프로젝트 상세 편집', exact: true }).click()
    const editor = page.locator('.board-editor')
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setContentSize(1000, 620)
      window.webContents.setZoomFactor(1.25)
    })
    const inside = async (selector: string) => page.locator(selector).evaluate(node => {
      const rect = node.getBoundingClientRect()
      return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
    })
    await expect.poll(() => inside('.board-editor')).toBe(true)
    await editor.getByLabel('하루 종일').uncheck()
    await expect.poll(() => inside('.board-editor')).toBe(true)
    await editor.getByLabel('종료 시각').fill('18:00')
    await page.keyboard.press('Tab')
    expect(await editor.evaluate(node => node.contains(document.activeElement))).toBe(true)
    await page.screenshot({ path: '/tmp/bandal-schedule-small-window.png' })
    await editor.getByRole('button', { name: '저장', exact: true }).click()
    await page.getByRole('button', { name: '수정한 사흘 프로젝트 상세 편집', exact: true }).click({ button: 'right' })
    await expect.poll(() => inside('.board-context-menu')).toBe(true)
    await page.getByRole('menuitem', { name: '진행 중', exact: true }).click()
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.webContents.setZoomFactor(1)
      window.setContentSize(1440, 900)
    })
  })
})
