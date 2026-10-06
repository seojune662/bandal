import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const { createCanvas } = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const canvas = createRequire(require.resolve('pdfjs-dist/package.json'))('@napi-rs/canvas')
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, Path2D: canvas.Path2D, ImageData: canvas.ImageData })
  return { createCanvas: canvas.createCanvas }
})
import { createBoardMediaRenderer, clipPdfBounds } from '../../../src/main/features/canvas/boardMediaPdf'
import type { DrawingShape } from '../../../src/shared/types/drawing'
let folder: string
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'bandal-media-export-')) })
afterEach(() => rmSync(folder, { recursive: true, force: true }))
function shape(kind: 'clip' | 'image'): DrawingShape {
  return { id: 'shape', kind, createdAt: '', updatedAt: '', style: { color: 'ink', width: 0.004, opacity: 1 },
    data: { box: { x: 0, y: 0, width: 1, height: 1 },
      ...(kind === 'clip' ? { clip: { relPath: 'source.pdf', page: 1, label: 'clip', crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } }
        : { image: { relPath: 'photo.png', label: 'photo' } }) } }
}
async function pixels(pdf: PDFDocument) {
  const document = await getDocument({ data: await pdf.save() }).promise
  try {
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const canvas = createCanvas(viewport.width, viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d') as any, canvas: canvas as any, viewport }).promise
    return [...canvas.getContext('2d').getImageData(50, 50, 1, 1).data].slice(0, 3)
  } finally { await document.destroy() }
}
test.each([
  [0, [255, 0, 0]], [90, [0, 0, 255]], [180, [0, 255, 0]], [270, [255, 255, 0]]
])('exports the visible top-left crop of a page rotated %s degrees', async (angle, color) => {
  const source = await PDFDocument.create()
  const sourcePage = source.addPage([200, 400])
  sourcePage.drawRectangle({ x: 0, y: 200, width: 100, height: 200, color: rgb(1, 0, 0) })
  sourcePage.drawRectangle({ x: 0, y: 0, width: 100, height: 200, color: rgb(0, 0, 1) })
  sourcePage.drawRectangle({ x: 100, y: 0, width: 100, height: 200, color: rgb(0, 1, 0) })
  sourcePage.drawRectangle({ x: 100, y: 200, width: 100, height: 200, color: rgb(1, 1, 0) })
  sourcePage.setRotation(degrees(angle as number))
  writeFileSync(join(folder, 'source.pdf'), await source.save())
  const output = await PDFDocument.create()
  await createBoardMediaRenderer(output, folder)(output.addPage([100, 100]), shape('clip'))
  expect(await pixels(output)).toEqual(color)
})
test('uses crop-box offsets when locating the selected PDF region', async () => {
  const source = await PDFDocument.create()
  const page = source.addPage([400, 600])
  page.setCropBox(40, 80, 200, 400)
  expect(clipPdfBounds(page, { x: 0, y: 0, width: 0.5, height: 0.5 }).bounds)
    .toEqual({ left: 40, right: 140, bottom: 280, top: 480 })
})
test('embeds uploaded PNG images and fails explicitly when a referenced file disappears', async () => {
  const picture = createCanvas(4, 4)
  const context = picture.getContext('2d')
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 4, 4)
  writeFileSync(join(folder, 'photo.png'), picture.toBuffer('image/png'))
  const output = await PDFDocument.create()
  await createBoardMediaRenderer(output, folder)(output.addPage([100, 100]), shape('image'))
  expect(await pixels(output)).toEqual([255, 0, 0])
  rmSync(join(folder, 'photo.png'))
  const second = await PDFDocument.create()
  await expect(createBoardMediaRenderer(second, folder)(second.addPage(), shape('image'))).rejects.toThrow('원본 파일')
  await expect(createBoardMediaRenderer(second, folder)(second.addPage(), shape('clip'))).rejects.toThrow('원본 PDF')
})
