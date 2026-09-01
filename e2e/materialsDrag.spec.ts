import { expect, test } from '@playwright/test'
import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

const BANDAL_IMAGE_MIME = 'application/x-bandal-material-image'
const IMAGE_NAME = 'drag-source.png'
const PDF_NAME = 'drop-target.pdf'

test('promotes image rows to native drag and keeps PDF image insertion', async () => {
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
    // PDF rows are draggable too since v0.9.4 — dragstart promotes them to a
    // native OS file drag (startNativeMaterialDrag), HTML5 drag is cancelled.
    await expect(pdfRow).toHaveAttribute('draggable', 'true')
    await pdfRow.click()

    const targetPage = page.locator('.pdf-page').first()
    await expect(targetPage).toBeVisible({ timeout: 30_000 })

    await page.evaluate(() => {
      type DiagnosticWindow = Window & {
        __materialImageDragStart?: boolean
      }
      document.addEventListener(
        'dragstart',
        (event) => {
          if (event.defaultPrevented) return
          ;(window as DiagnosticWindow).__materialImageDragStart = true
        },
        { once: true }
      )
    })

    await imageRow.evaluate((row) => {
      row.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer()
      }))
    })

    const dragStart = await page.evaluate(() => {
      return (
        window as Window & {
          __materialImageDragStart?: boolean
        }
      ).__materialImageDragStart
    })
    expect(dragStart).toBeUndefined()

    await targetPage.evaluate((element, { mime, imageName }) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(mime, JSON.stringify({
        relPath: imageName,
        label: imageName
      }))
      const bounds = element.getBoundingClientRect()
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        dataTransfer
      }
      element.dispatchEvent(new DragEvent('dragover', eventInit))
      element.dispatchEvent(new DragEvent('drop', eventInit))
    }, { mime: BANDAL_IMAGE_MIME, imageName: IMAGE_NAME })

    await expect(page.locator('.ink-layer__image-group')).toHaveCount(1)
    // ready 이미지는 이제 foreignObject <img> 가 아니라 SVG <image> 다 —
    // box 와 픽셀 단위로 일치시키는 v0.32.0 수정의 결과.
    await expect(page.locator('.ink-layer__image-el')).toBeVisible({
      timeout: 20_000
    })
  } finally {
    await bandal.close()
  }
})
