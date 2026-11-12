import { expect, test } from '@playwright/test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

/**
 * The corner share button shares whatever tab is open: the note file as is,
 * the PDF with its markup burned in. The native menu is replaced by a recorder,
 * so only the request the button builds is checked here.
 */
test('the corner share button follows the open tab and shares its file', async () => {
  const bandal = await launchBandal()
  const { page, app } = bandal
  try {
    await app.evaluate(({ ipcMain }) => {
      const shares: unknown[] = []
      ;(globalThis as { __shares?: unknown[] }).__shares = shares
      ipcMain.removeHandler('shell:shareTab')
      ipcMain.handle('shell:shareTab', (_event, req: unknown) => { shares.push(req); return { outcome: 'menu' } })
    })
    const shares = () => app.evaluate(() => (globalThis as { __shares?: unknown[] }).__shares ?? [])

    await createCourse(page, '운동체역학')
    const [course] = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    copyFileSync(join(__dirname, '../web-demo/public/sample.pdf'), join(course!.folderPath, 'Lecture.pdf'))
    writeFileSync(join(course!.folderPath, '강의 정리.md'), '# 강의 정리\n\n오늘의 학습 목표\n')

    const share = page.getByRole('group', { name: '작업 공간 보기' }).locator('[data-workspace-control="share"]')
    await expect(share).toBeDisabled()

    await page.locator('[data-material-path="Lecture.pdf"]').dblclick()
    await expect(share).toHaveAccessibleName('PDF 공유')
    await share.click()
    await expect.poll(shares).toEqual([
      { target: { kind: 'file', courseId: course!.id, relPath: 'Lecture.pdf', annotatedPdf: true }, anchor: expect.any(Object) }
    ])

    await page.locator('[data-material-path="강의 정리.md"]').dblclick()
    await expect(share).toHaveAccessibleName('마크다운 공유')
    await share.click()
    await expect.poll(async () => (await shares()).at(-1)).toMatchObject({
      target: { kind: 'file', courseId: course!.id, relPath: '강의 정리.md' }
    })
  } finally {
    await bandal.close()
  }
})
