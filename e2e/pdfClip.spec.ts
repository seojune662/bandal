/**
 * "화이트보드로" has to do something when clicked.
 *
 * It was a drag-only handle with no click handler, so pressing it did nothing
 * at all — and dragging only works when a whiteboard is already open beside
 * the PDF, which is a lot of setup for "put this page on my board".
 */

import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const SEEDED_PDF = 'Lecture.pdf'

test.describe('pdf clip to whiteboard', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '운영체제')

    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const courseDir = join(bandal.dataRoot, folders[0]!)

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([595, 842])
    page.drawText('Scheduling', { x: 64, y: 720, size: 28, font })
    writeFileSync(join(courseDir, SEEDED_PDF), await pdf.save())
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('clicking the clip button puts the page on a whiteboard', async () => {
    const { page } = bandal
    const row = page.locator('.material-row', { hasText: 'Lecture' })
    await expect(async () => {
      if (!(await row.isVisible())) {
        await page.getByRole('button', { name: '자료 새로고침' }).click()
      }
      await expect(row).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await row.click()

    const clipButton = page
      .getByRole('button', { name: '1 페이지를 화이트보드로 보내기' })
      .first()
    await expect(clipButton).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2500)
    await clipButton.click()
    await page.waitForTimeout(2500)

    // A whiteboard opens even though none was open to drag onto...
    await expect(page.locator('.ink-layer')).toBeVisible({ timeout: 15_000 })
    // ...and the page actually landed on it.
    await expect(page.locator('.ink-layer .ink-layer__clip-group')).toHaveCount(1, {
      timeout: 15_000
    })
    // And the page is actually drawn, not the "원본을 찾을 수 없어요" fallback.
    // ready 클립은 이제 foreignObject 가 아니라 SVG <image> 로 렌더된다
    // (v0.33.0 — 핸들과 픽셀 단위 일치를 위한 ImageShape 패턴).
    await expect(
      page.locator('.ink-layer__clip-group .ink-layer__image-el')
    ).toBeVisible({ timeout: 20_000 })
  })

  test('sending a second page does not hide it under the first', async () => {
    const { page } = bandal
    await page.locator('.workspace-tab__title', { hasText: 'Lecture' }).click()

    const clipButton = page
      .getByRole('button', { name: '1 페이지를 화이트보드로 보내기' })
      .first()
    await expect(clipButton).toBeVisible()
    await clipButton.click()

    const clips = page.locator('.ink-layer .ink-layer__clip-group')
    await expect(clips).toHaveCount(2, { timeout: 15_000 })

    // Offset, not stacked — otherwise the second send looks like nothing
    // happened because it lands exactly under the first.
    const [first, second] = await clips.all()
    const boxes = await Promise.all([first!.boundingBox(), second!.boundingBox()])
    expect(boxes[0]!.x).not.toBeCloseTo(boxes[1]!.x, 0)
    await page.waitForTimeout(1500)
  })
})
