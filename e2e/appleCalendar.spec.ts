import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('Apple Calendar settings and calendar entry points', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')
    // The native permission dialog and personal calendar database are never touched by E2E.
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = { supported: true, connected: false, authorization: 'not-determined', calendars: [] as { id: string; title: string; source: string; color: string; writable: boolean }[], selectedCalendarIds: [] as string[], destinationCalendarId: null as string | null }
      const changed = () => BrowserWindow.getAllWindows().forEach(w => w.webContents.send('appleCalendar:changed', {}))
      const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('appleCalendar:state', () => state)
      handle('appleCalendar:connect', () => { Object.assign(state, { connected: true, authorization: 'authorized', selectedCalendarIds: ['study'], destinationCalendarId: 'study', calendars: [{ id: 'study', title: '공부 일정', source: 'iCloud', color: '#3a7751', writable: true }, { id: 'holidays', title: '공휴일', source: '구독', color: '#ff6666', writable: false }] }); changed(); return state })
      handle('appleCalendar:configure', req => { Object.assign(state, req); changed(); return state })
      handle('appleCalendar:disconnect', () => { state.connected = false; changed(); return state })
      handle('appleCalendar:events', () => [])
      handle('appleCalendar:export', () => ({ eventId: 'fixture-export', updated: true }))
    })
  })
  test.afterAll(async () => { await bandal.close() })
  test('opens the same settings panel from the calendar menu, connects and selects calendars', async () => {
    const page = bandal.page
    await page.getByRole('button', { name: '학업 보드 열기', exact: true }).click()
    await page.getByRole('button', { name: '달력', exact: true }).click()
    await page.getByLabel('달력 더 보기').click()
    await page.getByRole('button', { name: '달력 설정 · Apple 캘린더' }).click()
    await expect(page.locator('[data-category="calendar"]')).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Apple 캘린더 연결', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: /공부 일정/ })).toBeChecked()
    await page.getByRole('checkbox', { name: /공휴일/ }).check()
    await expect(page.getByRole('status')).toContainText('저장했어요')
    await expect(page.locator('.apple-calendar-destination option')).toHaveCount(2)
    await page.screenshot({ path: '/tmp/bandal-calendar-settings.png' })
    await page.getByRole('button', { name: '연결 해제', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Apple 캘린더 연결', exact: true })).toBeVisible()
  })
  test('settings search discovers Calendar, and an edited task can be saved and exported', async () => {
    const page = bandal.page
    await page.locator('.settings-search input').fill('iCloud')
    await expect(page.locator('[data-category="calendar"]')).toBeVisible()
    await page.locator('.settings-search input').fill('')
    await page.getByRole('button', { name: 'Apple 캘린더 연결', exact: true }).click()
    await page.getByRole('button', { name: '앱으로 돌아가기' }).click()
    const dateKey = await page.evaluate(async () => {
      const date = new Date(), key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
      await window.bandal.invoke('board:createTask', { courseId: null, title: '캘린더 전송 과제', dueAt: key, allDay: true })
      return key
    })
    await page.locator(`[data-date-key="${dateKey}"]`).getByRole('button', { name: /캘린더 전송 과제/ }).click()
    await page.locator('.calendar-form').getByLabel('제목', { exact: true }).fill('수정하고 전송한 과제')
    await page.getByRole('button', { name: '저장하고 Apple 캘린더로 보내기' }).click()
    await expect(page.locator('.calendar-agenda__notice')).toContainText('기존 일정을 갱신')
    expect(await page.evaluate(async () => (await window.bandal.invoke('board:listTasks', {})).some(t => t.title === '수정하고 전송한 과제'))).toBe(true)
  })
})
