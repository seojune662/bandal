import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

/**
 * PDF 텍스트박스 회귀:
 *  - placeholder 가 열린 채 다른 곳을 클릭하면 박스가 클릭 지점으로 따라온다
 *    (예전엔 클릭이 "확정"으로만 소비돼 절반이 사라졌다).
 *  - 내용이 있는 placeholder 는 그 자리에 확정되고 새 박스가 클릭 지점에 열린다.
 *  - 코너 리사이즈가 45° 드래그에서 연속적으로 커진다 (지배축 플립 점프 회귀).
 */
test.describe('pdf textbox', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    const { page } = bandal
    await createCourse(page, '항공역학')
    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const courseDir = join(bandal.dataRoot, folders[0]!)

    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([842, 595]).drawText('Slide', { x: 64, y: 500, size: 28, font })
    writeFileSync(join(courseDir, 'slides.pdf'), await pdf.save())

    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="slides.pdf"]').click()
    await expect(page.locator('.pdf-page').first()).toBeVisible({
      timeout: 30_000
    })
    await page.locator('.pdf-tool-rail__button[aria-label="텍스트"]').click()
    // is-loading 동안은 레이어가 pointer-events:none — 클릭이 그냥 통과한다.
    await expect(
      page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    ).not.toHaveClass(/is-loading/)
    await page.waitForTimeout(400)
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('an open placeholder follows every repositioning click', async () => {
    const { page } = bandal
    const layer = page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    const rect = (await layer.boundingBox())!
    const at = (fx: number, fy: number): [number, number] => [
      rect.x + rect.width * fx,
      rect.y + rect.height * fy
    ]
    const textarea = page.locator('.ink-layer__textbox.is-editing')

    // 첫 클릭: placeholder 가 클릭 지점에 열린다.
    const [ax, ay] = at(0.2, 0.2)
    await page.mouse.click(ax, ay)
    await expect(textarea).toBeVisible()
    const first = (await textarea.boundingBox())!
    expect(Math.abs(first.x - ax)).toBeLessThan(8)
    expect(Math.abs(first.y - ay)).toBeLessThan(8)

    // 빈 채로 다른 곳 클릭: 사라지는 게 아니라 그 지점으로 이동한다.
    const [bx, by] = at(0.55, 0.5)
    await page.mouse.click(bx, by)
    await expect(textarea).toBeVisible()
    const moved = (await textarea.boundingBox())!
    expect(Math.abs(moved.x - bx)).toBeLessThan(8)
    expect(Math.abs(moved.y - by)).toBeLessThan(8)

    // 내용을 넣고 또 다른 곳 클릭: 지금 박스는 확정, 새 placeholder 가 열린다.
    await page.keyboard.type('committed here')
    const [cx, cy] = at(0.3, 0.65)
    await page.mouse.click(cx, cy)
    await expect(
      page.locator('.ink-layer__textbox-object', { hasText: 'committed here' })
    ).toBeVisible()
    await expect(textarea).toBeVisible()
    const third = (await textarea.boundingBox())!
    expect(Math.abs(third.x - cx)).toBeLessThan(8)
    expect(Math.abs(third.y - cy)).toBeLessThan(8)
    await page.keyboard.press('Escape')
  })

  test('corner resize grows continuously on a 45° drag', async () => {
    const { page } = bandal
    const box = page.locator('.ink-layer__textbox-object', {
      hasText: 'committed here'
    })
    await expect(box).toBeVisible()
    // 몸통 클릭으로 선택 → se 핸들 드래그.
    const body = (await box.boundingBox())!
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
    const handle = page.locator(
      '.ink-layer__textbox-resize[data-resize-handle="se"]'
    )
    await expect(handle).toBeVisible()
    const grip = (await handle.boundingBox())!
    const startX = grip.x + grip.width / 2
    const startY = grip.y + grip.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    const widths: number[] = []
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(startX + step * 10, startY + step * 10)
      await page.waitForTimeout(50)
      widths.push((await box.boundingBox())!.width)
    }
    await page.mouse.up()

    // 예전 지배축 플립은 프레임 사이에 폭이 수십 % 씩 튀었다 — 연속이면
    // 스텝당 증가가 완만하고 단조에 가깝다.
    for (let index = 1; index < widths.length; index += 1) {
      const delta = widths[index]! - widths[index - 1]!
      expect(delta, `widths: ${widths.map((w) => w.toFixed(0)).join(', ')}`)
        .toBeGreaterThan(-2)
      expect(delta).toBeLessThan(body.width)
    }
    expect(widths.at(-1)!).toBeGreaterThan(widths[0]!)
  })
})
