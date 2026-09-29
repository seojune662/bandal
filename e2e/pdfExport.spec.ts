import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { expect, test } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

// One export journey verifies the real IPC, installed font files, saved PDF,
// vector paint, search/copy and (on macOS) the Preview rendering engine.
test('downloaded PDF annotations keep Korean glyphs and searchable text', async ({}, testInfo) => {
  const bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '주석 내보내기')
    const course = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const source = await PDFDocument.create()
    source.addPage([600, 500])
    const sourceBytes = Buffer.from(await source.save())
    const sourcePath = join(course.folderPath, 'source.pdf')
    writeFileSync(sourcePath, sourceBytes)
    const savedPath = join(course.folderPath, 'annotated.pdf')
    await bandal.app.evaluate(({ dialog }, savedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedPath })
    }, savedPath)
    const text = '한글 주석 메모 가나다라 ABC 123'
    await bandal.page.evaluate(async ({ courseId, text }) => {
      for (const [index, style] of [{}, { bold: true }, { italic: true }].entries()) {
        await window.bandal.invoke('drawings:create', {
          courseId, relPath: 'source.pdf', page: 1, kind: 'textbox',
          data: { text, box: { x: 0.05, y: 0.05 + index * 0.2, width: 0.9, height: 0.18 } },
          style: { color: 'ink', width: 0.002, opacity: 1, fontSizePt: 24, ...style }
        })
      }
      await window.bandal.invoke('drawings:create', {
        courseId, relPath: 'source.pdf', page: 1, kind: 'ink',
        data: { points: [{ x: 0.1, y: 0.8, p: 0.5 }, { x: 0.3, y: 0.7, p: 0.8 }, { x: 0.5, y: 0.8, p: 0.5 }] },
        style: { color: 'blue', width: 0.004, opacity: 1 }
      })
      await window.bandal.invoke('pdf:exportAnnotated', { courseId, relPath: 'source.pdf' })
    }, { courseId: course.id, text })
    expect(readFileSync(sourcePath)).toEqual(sourceBytes)
    expect((await PDFDocument.load(readFileSync(savedPath))).getPageCount()).toBe(1)

    // PDF.js must still see real Unicode, even though visible letters are paths.
    Object.assign(globalThis, { DOMMatrix: class {} })
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(savedPath)) }).promise
    try {
      const page = await pdf.getPage(1)
      const content = await page.getTextContent()
      expect(content.items.map((item) => 'str' in item ? item.str : '').join('')).toContain(text)
      const ops = await page.getOperatorList()
      expect(ops.fnArray.filter((op) => op === OPS.constructPath).length).toBeGreaterThan(20)
    } finally { await pdf.destroy() }

    if (process.platform === 'darwin') {
      const png = testInfo.outputPath('preview-render.png')
      const recognized = execFileSync('swift', [resolve('e2e/helpers/renderPdf.swift'), savedPath, png], { encoding: 'utf8', timeout: 60_000 })
      expect(recognized.replace(/\s+/gu, '')).toContain('한글주석메모')
      await testInfo.attach('macOS Preview rendering', { path: png, contentType: 'image/png' })
    }
  } finally { await bandal.close() }
})
