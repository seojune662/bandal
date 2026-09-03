import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

async function expectSameBounds(
  left: Locator,
  right: Locator,
  tolerancePx = 1
): Promise<void> {
  const leftBounds = await left.boundingBox()
  const rightBounds = await right.boundingBox()
  expect(leftBounds).not.toBeNull()
  expect(rightBounds).not.toBeNull()
  if (leftBounds === null || rightBounds === null) return
  expect(Math.abs(leftBounds.x - rightBounds.x)).toBeLessThanOrEqual(tolerancePx)
  expect(Math.abs(leftBounds.y - rightBounds.y)).toBeLessThanOrEqual(tolerancePx)
  expect(Math.abs(leftBounds.width - rightBounds.width)).toBeLessThanOrEqual(tolerancePx)
  expect(Math.abs(leftBounds.height - rightBounds.height)).toBeLessThanOrEqual(tolerancePx)
}

/**
 * PDF 텍스트박스 회귀:
 *  - placeholder 가 열린 채 다른 곳을 클릭하면 박스가 클릭 지점으로 따라온다.
 *  - 리사이즈 = 줄바꿈 재배치 (글자 크기 불변, 폭을 좁히면 높이가 자란다).
 *  - 툴바 서식 행으로 글자와 배경 서식을 편집한다 (편집 중 포커스 유지 포함).
 *  - 줌은 정규화 기하/updatedAt 을 바꾸지 않고, 1px 지터는 클릭으로 친다.
 *  - 예전 버그가 남긴 페이지 밖 거대 박스는 로드시 자가 치유된다.
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
    const draftObject = page.locator('.ink-layer__textbox-object').filter({
      has: textarea
    })
    const expectAnchoredAt = async (
      clickX: number,
      clickY: number,
      bounds: { x: number; y: number; width: number; height: number }
    ): Promise<void> => {
      const fontPx = await textarea.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize)
      )
      expect(clickX).toBeGreaterThanOrEqual(bounds.x)
      expect(clickX).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(clickY).toBeGreaterThanOrEqual(bounds.y)
      expect(clickY).toBeLessThanOrEqual(bounds.y + bounds.height)
      expect(clickX - bounds.x).toBeGreaterThanOrEqual(0)
      expect(clickX - bounds.x).toBeLessThan(12)
      expect(clickY - bounds.y).toBeGreaterThanOrEqual(0)
      expect(clickY - bounds.y).toBeLessThan(fontPx * 1.35 + 8)
    }

    // 첫 클릭: placeholder 가 클릭 지점에 열린다.
    const [ax, ay] = at(0.2, 0.2)
    await page.mouse.click(ax, ay)
    await expect(textarea).toBeVisible()
    const first = (await textarea.boundingBox())!
    await expectAnchoredAt(ax, ay, first)
    await expectSameBounds(draftObject, textarea)

    // 빈 채로 다른 곳 클릭: 사라지는 게 아니라 그 지점으로 이동한다.
    const [bx, by] = at(0.55, 0.5)
    await page.mouse.click(bx, by)
    await expect(textarea).toBeVisible()
    const moved = (await textarea.boundingBox())!
    await expectAnchoredAt(bx, by, moved)
    await expectSameBounds(draftObject, textarea)

    // 우측·하단에서도 잘리거나 과거 위치에 고정되지 않는다.
    const [edgeX, edgeY] = at(0.96, 0.92)
    await page.mouse.click(edgeX, edgeY)
    const atEdge = (await textarea.boundingBox())!
    await expectAnchoredAt(edgeX, edgeY, atEdge)
    await expectSameBounds(draftObject, textarea)

    // 내용을 넣고 또 다른 곳 클릭: 지금 박스는 확정, 새 placeholder 가 열린다.
    await page.keyboard.type('committed here')
    const [cx, cy] = at(0.3, 0.65)
    await page.mouse.click(cx, cy)
    await expect(
      page.locator('.ink-layer__textbox-object', { hasText: 'committed here' })
    ).toBeVisible()
    await expect(textarea).toBeVisible()
    const third = (await textarea.boundingBox())!
    await expectAnchoredAt(cx, cy, third)
    await expectSameBounds(draftObject, textarea)
    await page.keyboard.press('Escape')
  })

  test('narrowing the box reflows text at a fixed font size', async () => {
    const { page } = bandal
    const layer = page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    const rect = (await layer.boundingBox())!

    // 리플로우가 보이려면 여러 단어짜리 텍스트가 필요하다.
    await page.mouse.click(rect.x + rect.width * 0.15, rect.y + rect.height * 0.32)
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await page.keyboard.type('reflow test with quite a few words inside the box')
    await page.keyboard.press('Meta+Enter')

    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'reflow test'
    })
    await expect(boxObject).toBeVisible()
    const inner = boxObject.locator('.ink-layer__textbox')
    // 커밋 직후 pending→실제 셰이프 교체로 노드가 갈리는 동안 detached 노드를
    // 읽으면 computed style 이 "" 로 나온다 — 값이 잡힐 때까지 기다린다.
    let fontBefore = ''
    await expect
      .poll(async () => {
        fontBefore = await inner.evaluate(
          (element) => getComputedStyle(element).fontSize
        )
        return fontBefore
      })
      .toMatch(/px$/)
    const before = (await boxObject.boundingBox())!
    await expectSameBounds(boxObject, inner)

    // select 툴로 박스를 잡고 w 핸들을 안쪽으로 끌어 폭을 좁힌다.
    await page.locator('.pdf-tool-rail__button[aria-label="선택"]').click()
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    const selectionFrame = page.locator('.ink-layer__selection-frame')
    await expect(selectionFrame).toBeVisible()
    await expectSameBounds(boxObject, selectionFrame, 2)
    const westHandle = page.locator(
      '.ink-layer__textbox-resize[data-resize-handle="w"]'
    )
    await expect(westHandle).toBeVisible()
    const grip = (await westHandle.boundingBox())!
    const gripX = grip.x + grip.width / 2
    const gripY = grip.y + grip.height / 2
    await page.mouse.move(gripX, gripY)
    await page.mouse.down()
    await page.mouse.move(gripX + 40, gripY, { steps: 4 })
    await page.mouse.move(gripX + 80, gripY, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    const after = (await boxObject.boundingBox())!
    await expectSameBounds(boxObject, inner)
    await expectSameBounds(boxObject, selectionFrame, 2)
    let fontAfter = ''
    await expect
      .poll(async () => {
        fontAfter = await inner.evaluate(
          (element) => getComputedStyle(element).fontSize
        )
        return fontAfter
      })
      .toMatch(/px$/)
    expect(after.width).toBeLessThan(before.width - 40)
    // 줄바꿈 재배치 — 글자 크기는 그대로, 내용이 안 들어가면 높이가 자란다.
    expect(fontAfter).toBe(fontBefore)
    expect(after.height).toBeGreaterThan(before.height)
    // 오른쪽 모서리는 고정된 채 왼쪽만 움직였다.
    expect(Math.abs(after.x + after.width - (before.x + before.width)))
      .toBeLessThan(8)
  })

  test('dragging a selected textbox moves its content and frame together', async () => {
    const { page } = bandal
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'reflow test'
    })
    const inner = boxObject.locator('.ink-layer__textbox')
    const before = (await boxObject.boundingBox())!
    const startX = before.x + before.width / 2
    const startY = before.y + before.height / 2
    const dx = 70
    const dy = 35

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY + dy, { steps: 6 })
    await page.mouse.up()

    const after = (await boxObject.boundingBox())!
    expect(Math.abs(after.x - before.x - dx)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.y - before.y - dy)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1)
    await expectSameBounds(boxObject, inner)
    await expectSameBounds(boxObject, page.locator('.ink-layer__selection-frame'), 2)
  })

  test('the format row edits text and background styles of the selection', async () => {
    const { page } = bandal
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'reflow test'
    })
    const inner = boxObject.locator('.ink-layer__textbox')
    const body = (await boxObject.boundingBox())!
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)

    const bar = page.locator('.ink-format-row')
    await expect(bar).toBeVisible()

    await bar.getByRole('button', { name: '굵게' }).click()
    await expect
      .poll(() => inner.evaluate((element) => getComputedStyle(element).fontWeight))
      .toBe('700')

    await bar.getByRole('button', { name: '빨강', exact: true }).click()
    await expect(inner).toHaveAttribute('data-color', 'red')

    await bar.getByRole('button', { name: '기울임' }).click()
    await expect
      .poll(() => inner.evaluate((element) => getComputedStyle(element).fontStyle))
      .toBe('italic')

    await bar.getByRole('button', { name: '가운데 정렬' }).click()
    await expect
      .poll(() => inner.evaluate((element) => getComputedStyle(element).textAlign))
      .toBe('center')

    await bar.getByRole('button', { name: '배경 빨강', exact: true }).click()
    await expect(inner).toHaveAttribute('data-fill', 'red')
    await expect
      .poll(async () => {
        const background = await inner.evaluate(
          (element) => getComputedStyle(element).backgroundColor
        )
        return background !== '' && background !== 'rgba(0, 0, 0, 0)'
      })
      .toBe(true)

    let fontBefore = 0
    await expect
      .poll(async () => {
        fontBefore = parseFloat(
          await inner.evaluate((element) => getComputedStyle(element).fontSize)
        )
        return fontBefore
      })
      .toBeGreaterThan(0)
    await bar.getByRole('button', { name: '글자 크게' }).click()
    await expect
      .poll(async () => parseFloat(
        await inner.evaluate((element) => getComputedStyle(element).fontSize)
      ))
      .toBeGreaterThan(fontBefore)
  })

  test('clicking the format row while editing keeps the textarea focused', async () => {
    const { page } = bandal
    await page.locator('.pdf-tool-rail__button[aria-label="텍스트"]').click()
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'committed here'
    })
    // text 툴에서는 단일 클릭으로 바로 편집에 들어간다.
    const body = (await boxObject.boundingBox())!
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()

    const bar = page.locator('.ink-format-row')
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: '굵게' }).click()
    // 바 클릭이 blur(=확정)를 일으키지 않아 계속 타이핑할 수 있다.
    await expect(textarea).toBeVisible()
    await page.keyboard.type(' more')
    await expect(textarea).toHaveValue(/more/)
    await page.keyboard.press('Escape')
  })

  test('zooming in and back preserves normalized geometry and updatedAt', async () => {
    const { page } = bandal
    await page.locator('.pdf-tool-rail__button[aria-label="텍스트"]').click()
    const surface = page.locator(
      '.pdf-page[data-pdf-page="1"] .pdf-drawing-layer'
    )
    const surfaceBox = (await surface.boundingBox())!
    await page.mouse.click(
      surfaceBox.x + surfaceBox.width * 0.72,
      surfaceBox.y + surfaceBox.height * 0.24
    )
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await page.keyboard.type('zoom invariant')
    await page.keyboard.press('Meta+Enter')

    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'zoom invariant'
    })
    await expect(boxObject).toBeVisible()

    const relativeGeometry = async (): Promise<{
      x: number
      y: number
      width: number
      height: number
      surfaceWidth: number
      surfaceHeight: number
    }> => {
      const pageBounds = (await surface.boundingBox())!
      const shapeBounds = (await boxObject.boundingBox())!
      return {
        x: (shapeBounds.x - pageBounds.x) / pageBounds.width,
        y: (shapeBounds.y - pageBounds.y) / pageBounds.height,
        width: shapeBounds.width / pageBounds.width,
        height: shapeBounds.height / pageBounds.height,
        surfaceWidth: pageBounds.width,
        surfaceHeight: pageBounds.height
      }
    }
    const readStoredShape = async (): Promise<{
      id: string
      updatedAt: string
    } | null> => page.evaluate(async (text) => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = (await bridge.invoke('courses:list', {})) as Array<{ id: string }>
      const drawings = (await bridge.invoke('drawings:listForFile', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf'
      })) as Array<{
        id: string
        updatedAt: string
        data: { text?: string }
      }>
      const shape = drawings.find((drawing) => drawing.data.text === text)
      return shape === undefined
        ? null
        : { id: shape.id, updatedAt: shape.updatedAt }
    }, 'zoom invariant')

    let storedBefore = await readStoredShape()
    await expect
      .poll(async () => {
        storedBefore = await readStoredShape()
        return storedBefore
      })
      .not.toBeNull()
    if (storedBefore === null) throw new Error('zoom invariant drawing was not saved')
    const before = await relativeGeometry()

    const toolbar = page.getByRole('toolbar', { name: 'PDF 뷰어 도구' })
    const zoomValue = toolbar.getByRole('button', { name: /현재 배율/ })
    const originalZoomLabel = await zoomValue.getAttribute('aria-label')
    await toolbar.getByRole('button', { name: '확대' }).click()
    await toolbar.getByRole('button', { name: '확대' }).click()
    await toolbar.getByRole('button', { name: '축소' }).click()
    await toolbar.getByRole('button', { name: '축소' }).click()
    await expect(zoomValue).toHaveAttribute('aria-label', originalZoomLabel!)

    const after = await relativeGeometry()
    expect(Math.abs(after.x - before.x) * before.surfaceWidth).toBeLessThanOrEqual(1)
    expect(Math.abs(after.y - before.y) * before.surfaceHeight).toBeLessThanOrEqual(1)
    expect(Math.abs(after.width - before.width) * before.surfaceWidth)
      .toBeLessThanOrEqual(1)
    expect(Math.abs(after.height - before.height) * before.surfaceHeight)
      .toBeLessThanOrEqual(1)

    await expect
      .poll(async () => (await readStoredShape())?.updatedAt)
      .toBe(storedBefore.updatedAt)
  })

  test('a one-pixel text-box jitter is treated as an edit click', async () => {
    const { page } = bandal
    await page.locator('.pdf-tool-rail__button[aria-label="텍스트"]').click()
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'zoom invariant'
    })
    const body = (await boxObject.boundingBox())!
    const x = body.x + body.width / 2
    const y = body.y + body.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 1, y + 1)
    await page.mouse.up()

    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue('zoom invariant')
    await page.keyboard.press('Escape')
  })

  test('a page-covering legacy textbox opens for editing instead of eating clicks', async () => {
    const { page } = bandal
    // 예전 리사이즈 점프가 경계 클램프를 거쳐 남기던 형태 — 검증을 통과하는
    // "유효한" 페이지 전체 크기 박스. 이 위의 클릭이 죽으면 텍스트 도구가
    // 고장난 것처럼 보인다.
    await page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = (await bridge.invoke('courses:list', {})) as Array<{ id: string }>
      await bridge.invoke('drawings:create', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf',
        page: 1,
        kind: 'textbox',
        data: {
          box: { x: 0.02, y: 0.02, width: 0.96, height: 0.9 },
          text: 'legacy giant'
        },
        style: { color: 'ink', width: 0.006, opacity: 1, fontScale: 1 }
      })
    })
    // 리로드로 새 드로잉을 로드한다 (열린 탭은 타표면 생성을 감시하지 않는다).
    await page.reload()
    await page.locator('[data-material-path="slides.pdf"]').click()
    await expect(page.locator('.pdf-page').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('.pdf-tool-rail__button[aria-label="텍스트"]').click()
    await expect(
      page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    ).not.toHaveClass(/is-loading/)
    await page.waitForTimeout(400)

    const giant = page.locator('.ink-layer__textbox-object', {
      hasText: 'legacy giant'
    })
    await expect(giant).toBeVisible()
    const body = (await giant.boundingBox())!
    // text 툴 단일 클릭 = 그 박스의 편집으로 열린다 (클릭이 죽지 않는다).
    await page.mouse.click(body.x + body.width * 0.7, body.y + body.height * 0.6)
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue(/legacy giant/)
    await page.keyboard.press('Escape')
  })
})
