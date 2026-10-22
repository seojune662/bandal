import { expect, test, type Locator } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

test('material toolbars export current Markdown, annotated PDF and original files without a duplicate title row', async ({}, info) => {
  test.setTimeout(150_000)
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  const { page } = bandal
  const setSize = async (width: number) => {
    await bandal.app.evaluate(({ BrowserWindow }, width) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      if (host.isMaximized()) host.unmaximize()
      host.webContents.setZoomFactor(1)
      host.setContentSize(width, 850)
    }, width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
  }
  const destination = async (filePath: string | null) => {
    await bandal.app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: filePath === null, ...(filePath ? { filePath } : {}) })
    }, filePath)
  }
  const assertToolbar = async (toolbar: Locator) => {
    await expect(toolbar).toBeVisible()
    await expect(page.locator('.tab-assistant-launchbar:visible')).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: '내보내기', exact: true })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'AI 보조 사이드바 펼치기', exact: true })).toBeVisible()
    expect(await toolbar.evaluate(element => {
      const document = element.closest('.tab-document')!
      return Math.abs(element.getBoundingClientRect().top - document.getBoundingClientRect().top)
    })).toBeLessThanOrEqual(1)
  }
  try {
    await setSize(1440)
    await createCourse(page, '자료 공유 검증')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'share.md'), '# 공유 자료\n\n최신 문장\n')
    writeFileSync(join(course.folderPath, 'source.txt'), '원본 그대로 내보내기\r\n')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7HcAAAAASUVORK5CYII=', 'base64')
    writeFileSync(join(course.folderPath, 'source.png'), png)
    const pdf = await PDFDocument.create()
    pdf.addPage([600, 700])
    const originalPdf = Buffer.from(await pdf.save())
    writeFileSync(join(course.folderPath, 'lecture.pdf'), originalPdf)
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()

    await page.locator('[data-material-path="share.md"]').click()
    const noteToolbar = page.locator('.note-tab:visible .note-format-bar')
    await assertToolbar(noteToolbar)
    const editor = page.locator('[aria-label="마크다운 필기 편집기"]:visible')
    await editor.getByText('최신 문장', { exact: true }).click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' — 저장 직전 추가')
    const markdownPath = join(bandal.profileDir, 'shared.md')
    await destination(markdownPath)
    await noteToolbar.getByRole('button', { name: '내보내기', exact: true }).click()
    await expect.poll(() => existsSync(markdownPath) ? readFileSync(markdownPath, 'utf8') : '').toContain('저장 직전 추가')
    expect(readFileSync(markdownPath, 'utf8')).toBe(readFileSync(join(course.folderPath, 'share.md'), 'utf8'))
    await noteToolbar.getByRole('button', { name: 'AI 보조 사이드바 펼치기', exact: true }).click()
    await expect(page.locator('.tab-assistant:visible')).toHaveCount(1)
    await noteToolbar.getByRole('button', { name: 'AI 보조 사이드바 접기', exact: true }).click()
    await expect(page.locator('.tab-assistant:visible')).toHaveCount(0)

    for (const [name, selector, expected] of [
      ['source.txt', '.file-toolbar', Buffer.from('원본 그대로 내보내기\r\n')],
      ['source.png', '.image-viewer__toolbar', png]
    ] as const) {
      await page.locator(`[data-material-path="${name}"]`).click()
      const toolbar = page.locator(`${selector}:visible`)
      await assertToolbar(toolbar)
      const saved = join(bandal.profileDir, `shared-${name}`)
      await destination(saved)
      await toolbar.getByRole('button', { name: '내보내기', exact: true }).click()
      await expect.poll(() => existsSync(saved)).toBe(true)
      expect(readFileSync(saved)).toEqual(expected)
    }

    await page.locator('[data-material-path="lecture.pdf"]').click()
    const pdfToolbar = page.locator('.pdf-tab:visible .pdf-toolbar')
    await assertToolbar(pdfToolbar)
    const drawingLayer = page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    await expect(drawingLayer).toBeVisible()
    await expect(drawingLayer).not.toHaveClass(/is-loading/)
    const annotationToggle = pdfToolbar.getByRole('button', { name: '주석 도구', exact: true })
    await expect(annotationToggle).toHaveAttribute('aria-expanded', 'false')
    await annotationToggle.click()
    await page.getByRole('button', { name: '텍스트', exact: true }).click()
    const bounds = (await drawingLayer.boundingBox())!
    await page.mouse.click(bounds.x + bounds.width * 0.15, bounds.y + bounds.height * 0.2)
    const textbox = page.locator('.ink-layer__textbox-editor-content')
    await expect(textbox).toBeFocused()
    await page.keyboard.insertText('내보내기 직전 필기 ABC 123')
    const annotatedPath = join(bandal.profileDir, 'shared-lecture.pdf')
    await destination(annotatedPath)
    // Export directly while the new textbox is still being edited.
    await pdfToolbar.getByRole('button', { name: '내보내기', exact: true }).click()
    await expect.poll(() => existsSync(annotatedPath)).toBe(true)
    expect(readFileSync(join(course.folderPath, 'lecture.pdf'))).toEqual(originalPdf)
    expect((await PDFDocument.load(readFileSync(annotatedPath))).getPageCount()).toBe(1)
    Object.assign(globalThis, { DOMMatrix: class {} })
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const exportedPdf = await getDocument({ data: new Uint8Array(readFileSync(annotatedPath)) }).promise
    try {
      const content = await (await exportedPdf.getPage(1)).getTextContent()
      expect(content.items.map(item => 'str' in item ? item.str : '').join('').replace(/\s/gu, '')).toContain('내보내기직전필기ABC123')
    } finally { await exportedPdf.destroy() }
    await annotationToggle.click()
    await destination(null)
    await pdfToolbar.getByRole('button', { name: '내보내기', exact: true }).click()
    await expect(pdfToolbar.getByRole('button', { name: '내보내기', exact: true })).toBeEnabled()
    await expect(page.locator('.toast-host')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('material-toolbar-wide.png') })

    // Leave just the two editable materials and exercise real split widths.
    for (const name of ['source.txt', 'source.png']) {
      await page.locator('.workspace-tab').filter({ hasText: name }).click({ button: 'middle' })
    }
    await page.getByRole('button', { name: '작업 공간 배치', exact: true }).click()
    await page.getByRole('menuitem', { name: '좌우 2분할', exact: true }).click()
    await expect(page.locator('.note-tab:visible')).toHaveCount(1)
    await expect(page.locator('.pdf-tab:visible')).toHaveCount(1)
    await setSize(1024)
    for (const toolbar of [noteToolbar, pdfToolbar]) {
      await assertToolbar(toolbar)
      await expect.poll(() => toolbar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      const share = toolbar.getByRole('button', { name: '내보내기', exact: true })
      expect(await share.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
      })).toBe(true)
    }
    const actions = await pdfToolbar.evaluate(element => ['.pdf-toolbar__zoom', '.material-export-button', '.tab-assistant-toggle'].map(selector => {
      const box = element.querySelector(selector)!.getBoundingClientRect()
      return box.y + box.height / 2
    }))
    expect(Math.max(...actions) - Math.min(...actions)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('material-toolbars-light.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await page.screenshot({ path: info.outputPath('material-toolbars-dark.png') })
  } finally { await bandal.close() }
})
