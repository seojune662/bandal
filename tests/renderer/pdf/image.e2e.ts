import { expect, test } from '@playwright/test'
import { createCanvas } from 'canvas'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from '../../../e2e/helpers/launch'

const PDF_NAME = 'Image placement.pdf'
const IMAGE_NAME = 'diagram.png'

function makeTestPng(): Buffer {
  const canvas = createCanvas(900, 500)
  const context = canvas.getContext('2d')
  context.fillRect(0, 0, 900, 500)
  context.clearRect(45, 45, 810, 150)
  context.font = 'bold 54px sans-serif'
  context.fillText('PDF IMAGE SHAPE', 170, 140)
  context.clearRect(45, 240, 360, 210)
  context.clearRect(450, 240, 405, 210)
  return canvas.toBuffer('image/png')
}

test('renders a course-relative image shape on a PDF page', async () => {
  let bandal: BandalApp | null = null
  try {
    bandal = await launchBandal()
    const { page } = bandal
    await createCourse(page, 'PDF 이미지 검증')
    const folder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find(
      (entry) => entry.isDirectory()
    )
    expect(folder).toBeDefined()
    const courseDir = join(bandal.dataRoot, folder!.name)

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([595, 842]).drawText('Image overlay check', {
      x: 64,
      y: 760,
      size: 28,
      font
    })
    writeFileSync(join(courseDir, PDF_NAME), await pdf.save())
    writeFileSync(join(courseDir, IMAGE_NAME), makeTestPng())

    const courseId = await page.evaluate(async () => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      const courses = await api.invoke('courses:list', {})
      return courses[0].id as string
    })

    const created = await page.evaluate(async (seed) => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      return api.invoke('drawings:create', {
        courseId: seed.courseId,
        relPath: seed.pdfName,
        page: 1,
        kind: 'image',
        data: {
          box: { x: 0.28, y: 0.26, width: 0.44, height: 0.22 },
          image: { relPath: seed.imageName, label: seed.imageName }
        },
        style: { color: 'ink', width: 0.004, opacity: 1 }
      })
    }, {
      courseId,
      pdfName: PDF_NAME,
      imageName: IMAGE_NAME
    })
    expect(created.data.image).toEqual({ relPath: IMAGE_NAME, label: IMAGE_NAME })

    const pdfRow = page.locator('.material-row[data-kind="pdf"]', { hasText: PDF_NAME })
    await expect(async () => {
      if (!(await pdfRow.isVisible())) {
        await page.getByRole('button', { name: '자료 새로고침' }).click()
      }
      await expect(pdfRow).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await pdfRow.click()

    const pageBox = page.locator('.pdf-page').first()
    const imageShape = page.locator('.pdf-page .ink-layer__image').first()
    await expect(pageBox).toBeVisible({ timeout: 30_000 })
    await expect(imageShape).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    })
    await expect(imageShape.locator('img')).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/
    )

    const [pageBounds, imageBounds] = await Promise.all([
      pageBox.boundingBox(),
      imageShape.boundingBox()
    ])
    expect(pageBounds).not.toBeNull()
    expect(imageBounds).not.toBeNull()
    expect(imageBounds!.width).toBeLessThan(pageBounds!.width / 2)
    expect(imageBounds!.height).toBeLessThan(pageBounds!.height / 3)

    const screenshotDir = resolve(__dirname, '__screenshots__')
    mkdirSync(screenshotDir, { recursive: true })
    await pageBox.screenshot({
      path: join(screenshotDir, 'pdf-image-shape.png'),
      animations: 'disabled'
    })
  } finally {
    await bandal?.close()
  }
})
