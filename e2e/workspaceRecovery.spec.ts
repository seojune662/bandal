import { expect, test } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

test('layout read failure preserves saved tabs and offers a working retry', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal
    await createCourse(page, '열린 과목')
    const seeded = await page.evaluate(async () => {
      const course = await window.bandal.invoke('courses:create', { name: '복원할 과목', color: 'blue' })
      const note = await window.bandal.invoke('notes:create', { courseId: course.id, dirRelPath: '', title: '보존한 필기' })
      const id = `note:${course.id}:${note.relPath}`
      const layout = {
        grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { id: 'saved-group', views: [id], activeView: id } }] }, width: 800, height: 600, orientation: 'HORIZONTAL' },
        panels: { [id]: { id, contentComponent: 'note', title: '보존한 필기', params: { descriptor: { kind: 'note', payload: { courseId: course.id, relPath: note.relPath } } } } },
        activeGroup: 'saved-group'
      }
      await window.bandal.invoke('layout:save', { courseId: course.id, layout })
      return { courseId: course.id, id }
    })
    await app.evaluate(({ ipcMain }, courseId) => {
      const original = (ipcMain as any)._invokeHandlers.get('layout:get')
      const probe = { unavailable: true }
      ;(globalThis as any).__layoutRecovery = probe
      ipcMain.removeHandler('layout:get')
      ipcMain.handle('layout:get', (event, input) => {
        if (input.courseId === courseId && probe.unavailable) throw new Error('Temporary layout read failure')
        return original(event, input)
      })
    }, seeded.courseId)
    await page.getByRole('button', { name: '복원할 과목', exact: true }).click()
    const recovery = page.locator('.workspace-recovery')
    await expect(recovery).toContainText('저장된 탭은 그대로 보존되어 있어요.')
    await page.screenshot({ path: info.outputPath('layout-recovery.png') })
    await app.evaluate(() => { (globalThis as any).__layoutRecovery.unavailable = false })
    const saved = await page.evaluate(async courseId => (await window.bandal.invoke('layout:get', { courseId })).layout, seeded.courseId)
    expect(Object.keys((saved as any).panels)).toEqual([seeded.id])
    await recovery.getByRole('button', { name: '다시 불러오기', exact: true }).click()
    await expect(recovery).toBeHidden()
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('보존한 필기')
  } finally { await bandal.close() }
})
