import { expect, test, type Locator } from '@playwright/test'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal, stubFolderPicker } from './helpers/launch'

async function dropImage(target: Locator, base64: string): Promise<void> {
  await target.evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0))
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([bytes], '외부 사진.png', { type: 'image/png' }))
    const bounds = element.getBoundingClientRect()
    const init: DragEventInit = { bubbles: true, cancelable: true, dataTransfer,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + Math.min(50, bounds.height / 2) }
    element.dispatchEvent(new DragEvent('dragover', init))
    element.dispatchEvent(new DragEvent('drop', init))
  }, base64)
}

test('connected folder imports files and external image drops persist in Markdown and PDF', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '외부 자료 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const sourceDir = join(bandal.profileDir, 'source-files')
    mkdirSync(sourceDir)
    writeFileSync(join(sourceDir, '참고.md'), '# 참고\n\nExternal reference\n')
    const imagePath = resolve(__dirname, '..', 'resources', 'icon.png')
    copyFileSync(imagePath, join(sourceDir, '외부 사진.png'))
    await stubFolderPicker(bandal.app, sourceDir)
    await page.getByRole('button', { name: '외부 자료 파일 · 사진', exact: true }).click()
    await page.getByRole('button', { name: '폴더 연결', exact: true }).click()
    await expect(page.locator('.external-source-entry').filter({ hasText: '외부 사진.png' })).toBeVisible()
    await page.getByRole('button', { name: '참고.md 가져오기', exact: true }).click()
    await expect.poll(() => {
      try { return readFileSync(join(course.folderPath, '참고.md'), 'utf8') } catch { return '' }
    }).toContain('External reference')
    const source = page.locator('.external-source-entry').filter({ hasText: '외부 사진.png' })
    await expect(source).toHaveAttribute('draggable', 'true')
    await bandal.app.evaluate(({ ipcMain }) => {
      ipcMain.once('externalSources:startDrag', (_event, payload) => {
        ;(globalThis as unknown as { sourceDragPayload: unknown }).sourceDragPayload = payload
      })
    })
    await source.evaluate(element => element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { sourceDragPayload: unknown }).sourceDragPayload)).toBeTruthy()

    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="참고.md"]').click()
    const editor = page.locator('.note-tab:visible .ProseMirror')
    await expect(editor).toBeVisible()
    await dropImage(editor.locator('p').last(), readFileSync(imagePath).toString('base64'))
    await expect(editor.locator('img[data-material-rel-path]')).toBeVisible()
    // Notes may derive their filename from the live title during autosave.
    await expect.poll(() => readdirSync(course.folderPath).filter(name => name.endsWith('.md'))
      .map(name => readFileSync(join(course.folderPath, name), 'utf8')).join('\n')).toMatch(/!\[.*\]\(/)
    expect(readFileSync(join(sourceDir, '참고.md'), 'utf8')).toBe('# 참고\n\nExternal reference\n')

    const pdf = await PDFDocument.create()
    pdf.addPage([300, 400])
    writeFileSync(join(course.folderPath, '삽입.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="삽입.pdf"]').click()
    const pdfPage = page.locator('.pdf-page').first()
    await expect(pdfPage).toBeVisible()
    await dropImage(pdfPage, readFileSync(imagePath).toString('base64'))
    await expect(page.locator('.ink-layer__image-el')).toBeVisible()
    await info.attach('external-image-in-pdf', { body: await page.screenshot(), contentType: 'image/png' })
    await page.reload()
    await expect(page.locator('.ink-layer__image-el')).toBeVisible({ timeout: 30_000 })
  } finally {
    await bandal.close()
  }
})
