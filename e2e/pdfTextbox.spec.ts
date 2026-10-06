import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

async function selectTextTool(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '주석 도구', exact: true })
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
}

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

async function expectTextFitsInsideBox(content: Locator): Promise<void> {
  await expect.poll(() => content.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let lastText: Text | null = null
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent?.length) lastText = node as Text
    }
    if (lastText === null) return Number.POSITIVE_INFINITY
    const range = document.createRange()
    range.setStart(lastText, lastText.length - 1)
    range.setEnd(lastText, lastText.length)
    const glyph = range.getBoundingClientRect()
    const bounds = element.getBoundingClientRect()
    return Math.max(
      element.scrollHeight - element.clientHeight,
      bounds.left - glyph.left,
      glyph.right - bounds.right,
      bounds.top - glyph.top,
      glyph.bottom - bounds.bottom
    )
  })).toBeLessThanOrEqual(2)
}

test('independent textboxes keep their own selection, edits and saved contents', async ({}, testInfo) => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  try {
    let page = bandal.page
    await createCourse(page, '텍스트 박스 독립성')
    const courseDir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    pdf.addPage([842, 595])
    writeFileSync(join(courseDir, 'slides.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()

    const openPdf = async (): Promise<void> => {
      await page.locator('[data-material-path="slides.pdf"]').click()
      await expect(page.locator('.pdf-page[data-pdf-page="1"]')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')).not.toHaveClass(/is-loading/)
      await selectTextTool(page)
    }
    await openPdf()

    const readTexts = async (): Promise<Record<string, string>> => page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = await bridge.invoke('courses:list', {}) as Array<{ id: string }>
      const drawings = await bridge.invoke('drawings:listForFile', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf'
      }) as Array<{ id: string; kind: string; data: { text?: string } }>
      return Object.fromEntries(drawings.filter(shape => shape.kind === 'textbox')
        .map(shape => [shape.id, shape.data.text ?? '']))
    })
    const boxForId = (id: string): Locator => page.locator('.ink-layer__textbox-object').filter({
      has: page.locator(`[data-textbox-id="${id}"]`)
    })
    const clickBox = async (id: string, double = false): Promise<void> => {
      const bounds = (await boxForId(id).boundingBox())!
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
        clickCount: double ? 2 : 1
      })
    }
    const texts = ['first independent box', 'second independent box', 'last independent box']
    const expected: Record<string, string> = {}
    const ids: string[] = []
    const positions = [[0.12, 0.2], [0.46, 0.48], [0.74, 0.76]] as const
    for (const [index, position] of positions.entries()) {
      const layer = (await page.locator('.pdf-drawing-layer').boundingBox())!
      await page.mouse.click(layer.x + layer.width * position[0], layer.y + layer.height * position[1])
      const editor = page.locator('.ink-layer__textbox-editor-content')
      await expect(editor).toHaveCount(1)
      await expect(editor).toHaveText('')
      await expect(editor).toBeFocused()
      await page.keyboard.type(texts[index]!)
      if (index === positions.length - 1) {
        // Starting an existing object while a filled new draft is open must
        // commit the draft and mount exactly one editor with the chosen text.
        await clickBox(ids[0]!)
        await expect(editor).toHaveCount(1)
        await expect(editor).toHaveText(texts[0]!)
        await page.keyboard.press('Escape')
      } else {
        await page.keyboard.press('ControlOrMeta+Enter')
      }
      const object = page.locator('.ink-layer__textbox-object', { hasText: texts[index]! })
      const durable = object.locator('[data-textbox-id]:not([data-textbox-id^="pending:"])')
      await expect(durable).toHaveCount(1)
      const id = (await durable.getAttribute('data-textbox-id'))!
      ids.push(id)
      expected[id] = texts[index]!
      await expect.poll(readTexts).toEqual(expected)
    }

    // Read the visible bounds and Chromium hit target in the same frame. A
    // transparent SVG stroke used to capture half a page around every box.
    const hitTargets = async () => page.evaluate((shapeIds) => shapeIds.map(id => {
      const content = document.querySelector(`[data-textbox-id="${id}"]`)!
      const group = content.closest('.ink-layer__textbox-group')!
      const object = group.querySelector('.ink-layer__textbox-object')!
      const bounds = object.getBoundingClientRect()
      const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return {
        expectedId: id,
        tag: target?.tagName,
        className: target?.getAttribute('class'),
        textboxId: target?.closest('.ink-layer__textbox-group')
          ?.querySelector('[data-textbox-id]')?.getAttribute('data-textbox-id')
      }
    }), ids)
    const hits = await hitTargets()
    await testInfo.attach('textbox-hit-targets', {
      body: JSON.stringify(hits, null, 2),
      contentType: 'application/json'
    })
    const threeTextboxesScreenshot = testInfo.outputPath('three-textboxes.png')
    await page.screenshot({ path: threeTextboxesScreenshot })
    await testInfo.attach('three-textboxes', { path: threeTextboxesScreenshot, contentType: 'image/png' })
    expect(hits.map(hit => hit.textboxId)).toEqual(ids)

    await page.getByRole('button', { name: '선택', exact: true }).click()
    const selectionHits = await hitTargets()
    await testInfo.attach('selection-hit-targets', {
      body: JSON.stringify(selectionHits, null, 2),
      contentType: 'application/json'
    })
    expect(selectionHits.map(hit => hit.textboxId)).toEqual(ids)
    for (const id of [ids[0]!, ids[1]!, ids[2]!, ids[0]!]) {
      await clickBox(id)
      await expect(page.locator('.ink-layer__selection-frame')).toHaveCount(1)
      await expectSameBounds(boxForId(id), page.locator('.ink-layer__selection-frame'), 2)
      await expect(page.locator('.ink-layer__textbox-editor-content')).toHaveCount(0)
    }

    // Editing in select mode must read the clicked object's contents. Cancelling
    // it must restore that object without consuming a change to another box.
    await clickBox(ids[0]!, true)
    let editor = page.locator('.ink-layer__textbox-editor-content')
    await expect(editor).toHaveText(expected[ids[0]!]!)
    await editor.fill('discard this edit')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect.poll(readTexts).toEqual(expected)

    await selectTextTool(page)
    await clickBox(ids[0]!)
    await expect(editor).toHaveText(expected[ids[0]!]!)
    await editor.fill('first box edited through tool switch')
    await page.getByRole('button', { name: '선택', exact: true }).click()
    expected[ids[0]!] = 'first box edited through tool switch'
    await expect(editor).toHaveCount(0)
    await expect.poll(readTexts).toEqual(expected)

    await selectTextTool(page)
    await clickBox(ids[1]!)
    await expect(editor).toHaveText(expected[ids[1]!]!)
    await editor.fill('second box edited before switching object')
    // The prior blur and the new edit start occur in the same mouse gesture.
    await clickBox(ids[2]!)
    expected[ids[1]!] = 'second box edited before switching object'
    await expect(editor).toHaveCount(1)
    await expect(editor).toHaveText(expected[ids[2]!]!)
    await expect.poll(readTexts).toEqual(expected)
    await editor.fill('last box edited independently')
    await page.keyboard.press('ControlOrMeta+Enter')
    expected[ids[2]!] = 'last box edited independently'
    await expect.poll(readTexts).toEqual(expected)

    const undo = page.getByRole('button', { name: '되돌리기', exact: true })
    const redo = page.getByRole('button', { name: '다시 실행', exact: true })
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect.poll(readTexts).toEqual({ ...expected, [ids[2]!]: texts[2]! })
    await expect(redo).toBeEnabled()
    await redo.click()
    await expect.poll(readTexts).toEqual(expected)

    const profileDir = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    editor = page.locator('.ink-layer__textbox-editor-content')
    await openPdf()
    await expect.poll(readTexts).toEqual(expected)
    for (const id of ids) {
      await clickBox(id)
      await expect(editor).toHaveText(expected[id]!)
      await page.keyboard.press('Escape')
    }
    await expect.poll(readTexts).toEqual(expected)
  } finally {
    await bandal.close()
    rmSync(bandal.profileDir, { recursive: true, force: true })
  }
})

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

  test.beforeAll(async ({}, testInfo) => {
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
    await selectTextTool(page)
    // is-loading 동안은 레이어가 pointer-events:none — 클릭이 그냥 통과한다.
    await expect(
      page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    ).not.toHaveClass(/is-loading/)
    await page.waitForTimeout(400)
    const wideScreenshot = testInfo.outputPath('wide-pdf-tools.png')
    await page.screenshot({ path: wideScreenshot })
    await testInfo.attach('wide-pdf-tools', { path: wideScreenshot, contentType: 'image/png' })
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('an open placeholder follows every repositioning click', async ({}, testInfo) => {
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
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    const first = (await textarea.boundingBox())!
    await expectAnchoredAt(ax, ay, first)
    await expectSameBounds(draftObject, textarea)

    // 빈 채로 다른 곳 클릭: 사라지는 게 아니라 그 지점으로 이동한다.
    const [bx, by] = at(0.55, 0.5)
    await page.mouse.click(bx, by)
    await expect(textarea).toBeVisible()
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    const moved = (await textarea.boundingBox())!
    await expectAnchoredAt(bx, by, moved)
    await expectSameBounds(draftObject, textarea)

    // 우측·하단에서도 잘리거나 과거 위치에 고정되지 않는다.
    const [edgeX, edgeY] = at(0.96, 0.92)
    await page.mouse.click(edgeX, edgeY)
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    const atEdge = (await textarea.boundingBox())!
    await expectAnchoredAt(edgeX, edgeY, atEdge)
    await expectSameBounds(draftObject, textarea)

    // 내용을 넣고 또 다른 곳 클릭: 지금 박스는 확정, 새 placeholder 가 열린다.
    await page.keyboard.type('committed here')
    await expectTextFitsInsideBox(textarea)
    await expect.poll(async () => (await textarea.boundingBox())?.y ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(atEdge.y)
    const [cx, cy] = at(0.3, 0.65)
    await page.mouse.click(cx, cy)
    const committed = page.locator('.ink-layer__textbox-object', { hasText: 'committed here' })
    await expect(committed).toBeVisible()
    await expectTextFitsInsideBox(committed.locator('.ink-layer__textbox'))
    await expect.poll(async () => page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = await bridge.invoke('courses:list', {}) as Array<{ id: string }>
      const drawings = await bridge.invoke('drawings:listForFile', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf'
      }) as Array<{ data: { text?: string; box?: { x: number; y: number; width: number; height: number } } }>
      const box = drawings.find(shape => shape.data.text === 'committed here')?.data.box
      return box === undefined ? Number.POSITIVE_INFINITY : Math.max(
        -box.x, -box.y, box.x + box.width - 1, box.y + box.height - 1
      )
    })).toBeLessThanOrEqual(0.000001)
    await expect(textarea).toBeVisible()
    const third = (await textarea.boundingBox())!
    await expectAnchoredAt(cx, cy, third)
    await expectSameBounds(draftObject, textarea)
    await page.keyboard.press('Escape')
    const edgeScreenshot = testInfo.outputPath('edge-textbox.png')
    await page.screenshot({ path: edgeScreenshot })
    await testInfo.attach('edge-textbox', { path: edgeScreenshot, contentType: 'image/png' })
  })

  test('Enter inserts and persists a real line break', async () => {
    const { page } = bandal
    const layer = page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    const bounds = (await layer.boundingBox())!
    await page.mouse.click(
      bounds.x + bounds.width * 0.72,
      bounds.y + bounds.height * 0.52
    )

    const editor = page.locator('.ink-layer__textbox-editor-content')
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    await page.keyboard.type('first line')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second line')
    await expect(editor.locator('br')).not.toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Enter')

    await expect.poll(async () => page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = (await bridge.invoke('courses:list', {})) as Array<{ id: string }>
      const drawings = (await bridge.invoke('drawings:listForFile', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf'
      })) as Array<{ kind: string; data: { text?: string } }>
      return drawings.some(
        (drawing) =>
          drawing.kind === 'textbox' &&
          drawing.data.text === 'first line\nsecond line'
      )
    })).toBe(true)
  })

  test('narrowing the box reflows text at a fixed font size', async () => {
    const { page } = bandal
    const layer = page.locator('.pdf-page[data-pdf-page="1"] .pdf-drawing-layer')
    const rect = (await layer.boundingBox())!

    // 리플로우가 보이려면 여러 단어짜리 텍스트가 필요하다.
    await page.mouse.click(rect.x + rect.width * 0.15, rect.y + rect.height * 0.32)
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    await page.keyboard.type('reflow test with quite a few words inside the box')
    await page.keyboard.press('ControlOrMeta+Enter')

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
    // Wait for the optimistic textbox to receive its durable id before
    // measuring; replacing that node can otherwise return a null bounding box.
    await expect(boxObject.locator('[data-textbox-id]:not([data-textbox-id^="pending:"])')).toHaveCount(1)
    await expect(boxObject).toBeVisible()
    await expectSameBounds(boxObject, inner)

    // select 툴로 박스를 잡고 w 핸들을 안쪽으로 끌어 폭을 좁힌다.
    await page.locator('.pdf-tool-rail__button[aria-label="선택"]').click()
    // Switching tools closes the draft formatting row and moves the paper.
    // The target locator waits for its current screen position to settle.
    await boxObject.locator('xpath=..').locator('.ink-layer__textbox-hit-target').click()
    const selectionFrame = page.locator('.ink-layer__selection-frame')
    await expect(selectionFrame).toBeVisible()
    const before = (await boxObject.boundingBox())!
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
    await expectTextFitsInsideBox(inner)
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
    const heightBefore = (await boxObject.boundingBox())!.height
    await bar.getByRole('button', { name: '글자 크게' }).click()
    await expect
      .poll(async () => parseFloat(
        await inner.evaluate((element) => getComputedStyle(element).fontSize)
      ))
      .toBeGreaterThan(fontBefore)
    await expect
      .poll(async () => (await boxObject.boundingBox())?.height ?? 0)
      .toBeGreaterThan(heightBefore)
    await expectSameBounds(boxObject, inner)
    await expectTextFitsInsideBox(inner)
  })

  test('clicking the format row while editing keeps the rich editor focused', async () => {
    const { page } = bandal
    await selectTextTool(page)
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'committed here'
    })
    // text 툴에서는 단일 클릭으로 바로 편집에 들어간다.
    const body = (await boxObject.boundingBox())!
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
    const textarea = page.locator('.ink-layer__textbox.is-editing')
    await expect(textarea).toBeVisible()
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()

    const bar = page.locator('.ink-format-row')
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: '굵게' }).click()
    // 바 클릭이 blur(=확정)를 일으키지 않아 계속 타이핑할 수 있다.
    await expect(textarea).toBeVisible()
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    await page.keyboard.type(' more')
    await expect(textarea).toContainText('more')
    await page.keyboard.press('Escape')
  })

  test('formats only the selected text and supports Command plus point sizing', async () => {
    const { page } = bandal
    const boxObject = page.locator('.ink-layer__textbox-object', {
      hasText: 'committed here'
    })
    const body = (await boxObject.boundingBox())!
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)

    const editor = page.locator('.ink-layer__textbox-editor-content')
    await expect(editor).toBeVisible()
    await expect(editor).toBeFocused()
    await editor.evaluate((element) => {
      const textNode = element.firstChild
      if (textNode === null) throw new Error('textbox has no text node')
      const range = document.createRange()
      range.setStart(textNode, 0)
      range.setEnd(textNode, 'committed'.length)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    await page.keyboard.down('Meta')
    await page.keyboard.press('=')
    await page.keyboard.up('Meta')
    const bar = page.locator('.ink-format-row')
    await bar.getByRole('button', { name: '빨강', exact: true }).click()

    await expect(editor.locator('[data-font-size-pt="16"]')).toHaveText('committed')
    await expect(editor.locator('[data-text-color="red"]')).toHaveText('committed')
    await expect(editor).toContainText('committed here')
    await page.keyboard.press('ControlOrMeta+Enter')

    await expect.poll(async () => page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke: (channel: string, req: unknown) => Promise<unknown> }
      }).bandal
      const courses = (await bridge.invoke('courses:list', {})) as Array<{ id: string }>
      const drawings = (await bridge.invoke('drawings:listForFile', {
        courseId: courses[0]!.id,
        relPath: 'slides.pdf'
      })) as Array<{
        data: {
          text?: string
          textRuns?: Array<{ from: number; to: number; style: Record<string, unknown> }>
        }
      }>
      return drawings.find((drawing) => drawing.data.text === 'committed here')?.data.textRuns
    })).toEqual([{
      from: 0,
      to: 9,
      style: { color: 'red', fontSizePt: 16 }
    }])
  })

  test('zooming in and back preserves normalized geometry and updatedAt', async () => {
    const { page } = bandal
    await selectTextTool(page)
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
    await expect(page.locator('.ink-layer__textbox-editor-content')).toBeFocused()
    await page.keyboard.type('zoom invariant')
    await page.keyboard.press('ControlOrMeta+Enter')

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
      let geometry: {
        x: number
        y: number
        width: number
        height: number
        surfaceWidth: number
        surfaceHeight: number
      } | null = null
      // Read both rectangles in the same renderer frame. Two separate IPC
      // reads can straddle the zoom layout and report a false geometry drift.
      await expect.poll(async () => {
        geometry = await surface.evaluate(layer => {
          const shape = [...layer.querySelectorAll<HTMLElement>('.ink-layer__textbox-object')]
            .find(node => node.textContent?.includes('zoom invariant'))
          if (!shape) return null
          const pageBounds = layer.getBoundingClientRect()
          const shapeBounds = shape.getBoundingClientRect()
          if (!pageBounds.width || !pageBounds.height) return null
          return {
            x: (shapeBounds.x - pageBounds.x) / pageBounds.width,
            y: (shapeBounds.y - pageBounds.y) / pageBounds.height,
            width: shapeBounds.width / pageBounds.width,
            height: shapeBounds.height / pageBounds.height,
            surfaceWidth: pageBounds.width,
            surfaceHeight: pageBounds.height
          }
        })
        return geometry !== null
      }).toBe(true)
      if (geometry === null) throw new Error('textbox geometry did not settle')
      return geometry
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

    await expect.poll(async () => {
      const after = await relativeGeometry()
      return Math.max(
        Math.abs(after.x - before.x) * before.surfaceWidth,
        Math.abs(after.y - before.y) * before.surfaceHeight,
        Math.abs(after.width - before.width) * before.surfaceWidth,
        Math.abs(after.height - before.height) * before.surfaceHeight
      )
    }).toBeLessThanOrEqual(1)

    await expect
      .poll(async () => (await readStoredShape())?.updatedAt)
      .toBe(storedBefore.updatedAt)
  })

  test('a one-pixel text-box jitter is treated as an edit click', async () => {
    const { page } = bandal
    await selectTextTool(page)
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
    await expect(textarea).toContainText('zoom invariant')
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
    await selectTextTool(page)
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
    await expect(textarea).toContainText('legacy giant')
    await page.keyboard.press('Escape')
  })

  test('keeps zoom fixed and makes every drawing tool reachable in a narrow split', async ({}, testInfo) => {
    const { page } = bandal
    const pdfTab = page.locator('.pdf-tab')
    await pdfTab.evaluate((element) => {
      element.style.width = '420px'
      element.style.flex = '0 0 420px'
    })

    try {
      const toolbar = page.getByRole('toolbar', { name: 'PDF 뷰어 도구' })
      const toggle = toolbar.getByRole('button', { name: '주석 도구', exact: true })
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
      await expect(toolbar.getByRole('button', { name: '축소' })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: '확대' })).toBeVisible()
      const zoom = toolbar.locator('.pdf-toolbar__zoom-value')
      const value = await zoom.textContent()
      const rail = toolbar.getByRole('group', { name: '자유 필기 도구', exact: true })
      await expect(toolbar.getByRole('button', { name: '도형 및 텍스트 도구', exact: true })).toHaveCount(0)
      await expect(page.getByRole('dialog', { name: '도형 및 텍스트 도구' })).toHaveCount(0)
      await expect(page.locator('.pdf-tool-rail-shell')).toHaveAttribute('data-overflow', 'true')
      const next = toolbar.getByRole('button', { name: '다음 필기 도구', exact: true })
      await expect(next).toBeEnabled()
      const scrollBefore = await rail.evaluate(node => node.scrollLeft)
      await next.click()
      await expect.poll(() => rail.evaluate(node => node.scrollLeft)).toBeGreaterThan(scrollBefore)
      for (const label of ['선택', '펜', '형광펜', '지우개', '텍스트', '사각형', '타원', '화살표', '직선']) {
        const button = rail.getByRole('button', { name: label, exact: true })
        await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        expect(await button.evaluate(node => {
          const bounds = node.getBoundingClientRect()
          return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('button') === node
        })).toBe(true)
      }
      const exportButton = rail.getByRole('button', { name: '주석 포함 PDF 내보내기', exact: true })
      await exportButton.scrollIntoViewIfNeeded()
      await expect(exportButton).toBeVisible()
      await expect(exportButton).toBeEnabled()
      await toolbar.getByRole('button', { name: '필기 스타일', exact: true }).click()
      const style = page.getByRole('dialog', { name: '필기 스타일' })
      await expect(style.getByRole('button', { name: '보라' })).toBeVisible()
      await expect(style.getByRole('slider', { name: '선 굵기' })).toBeVisible()
      await expect(style.getByRole('slider', { name: '불투명도' })).toBeVisible()
      await expect(zoom).toHaveText(value!)
      await page.keyboard.press('Escape')
      expect(await toolbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      const narrowScreenshot = testInfo.outputPath('narrow-pdf-tools.png')
      await page.screenshot({ path: narrowScreenshot })
      await testInfo.attach('narrow-pdf-tools', { path: narrowScreenshot, contentType: 'image/png' })

    } finally {
      await pdfTab.evaluate((element) => {
        element.style.removeProperty('width')
        element.style.removeProperty('flex')
      })
    }
  })
})
