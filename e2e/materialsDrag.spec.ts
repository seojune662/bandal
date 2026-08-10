import { expect, test } from '@playwright/test'
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

const BANDAL_IMAGE_MIME = 'application/x-bandal-material-image'
const IMAGE_NAME = 'drag-source.png'
const PDF_NAME = 'drop-target.pdf'

interface DragStartSnapshot {
  types: string[]
  effectAllowed: string
  customData: string
  textData: string
}

test('drags a material image with the ink/PDF payload into a PDF page', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '이미지 드래그 과목')

    const courseFolder = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory())
    expect(courseFolder).toBeDefined()
    const courseDir = join(bandal.dataRoot, courseFolder!.name)
    copyFileSync(
      resolve(__dirname, '..', 'resources', 'icon.png'),
      join(courseDir, IMAGE_NAME)
    )

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const pdfPage = pdf.addPage([595, 842])
    pdfPage.drawText('Image drop target', { x: 64, y: 720, size: 28, font })
    writeFileSync(join(courseDir, PDF_NAME), await pdf.save())

    await page.getByRole('button', { name: '자료 새로고침' }).click()
    const imageRow = page.locator(`[data-material-path="${IMAGE_NAME}"]`)
    const pdfRow = page.locator(`[data-material-path="${PDF_NAME}"]`)
    await expect(imageRow).toBeVisible()
    await expect(imageRow).toHaveAttribute('draggable', 'true')
    await expect(pdfRow).toBeVisible()
    await expect(pdfRow).not.toHaveAttribute('draggable', 'true')
    await pdfRow.click()

    const targetPage = page.locator('.pdf-page').first()
    await expect(targetPage).toBeVisible({ timeout: 30_000 })

    await page.evaluate((mime) => {
      type DiagnosticWindow = Window & {
        __materialImageDragStart?: DragStartSnapshot
      }
      document.addEventListener(
        'dragstart',
        (event) => {
          if (event.dataTransfer === null) return
          ;(window as DiagnosticWindow).__materialImageDragStart = {
            types: [...event.dataTransfer.types],
            effectAllowed: event.dataTransfer.effectAllowed,
            customData: event.dataTransfer.getData(mime),
            textData: event.dataTransfer.getData('text/plain')
          }
        },
        { once: true }
      )
    }, BANDAL_IMAGE_MIME)

    // Uses Chromium's native HTML5 DnD path in the production Electron build.
    await imageRow.dragTo(targetPage)

    const dragStart = await page.evaluate(() => {
      return (
        window as Window & {
          __materialImageDragStart?: DragStartSnapshot
        }
      ).__materialImageDragStart
    })
    expect(dragStart?.types).toContain(BANDAL_IMAGE_MIME)
    expect(dragStart?.types).toContain('text/plain')
    expect(dragStart?.effectAllowed).toBe('copyMove')
    expect(JSON.parse(dragStart?.customData ?? '')).toEqual({
      relPath: IMAGE_NAME,
      label: IMAGE_NAME
    })
    expect(dragStart?.textData).toBe(IMAGE_NAME)

    await expect(page.locator('.ink-layer__image-group')).toHaveCount(1)
    await expect(page.locator('.ink-layer__image')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 }
    )
  } finally {
    await bandal.close()
  }
})
