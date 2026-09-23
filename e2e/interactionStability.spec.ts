import { expect, test, type Page } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { buildPptx } from './helpers/presentation'

async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame) }, count)
}

test.describe('continuous study interactions', () => {
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '사용성 검사')
    const folder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())!
    const dir = join(bandal.dataRoot, folder.name)
    writeFileSync(join(dir, 'slides.pptx'), await buildPptx('슬라이드 복사 · 한글', 100))
    writeFileSync(join(dir, 'ink-heavy.pptx'), await buildPptx('연속 필기 검사'))
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 100; i++) pdf.addPage([720, 540]).drawText(`Page ${i + 1}`, { x: 40, y: 470 })
    writeFileSync(join(dir, 'pages.pdf'), await pdf.save())
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, `note-${i}.md`), `# 메모 ${i}\n`)
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
  })
  test.afterAll(async () => { await bandal?.close() })

  test('prepared 100-page documents remain responsive with 20 tabs', async ({}, info) => {
    const { page, app } = bandal
    for (let i = 0; i < 18; i++) await page.locator(`[data-material-path="note-${i}.md"]`).click()
    await page.locator('[data-material-path="pages.pdf"]').click()
    await expect(page.locator('.react-pdf__Page canvas').first()).toBeVisible()
    await page.locator('[data-material-path="slides.pptx"]').click()
    await expect(page.locator('.presentation-page__text').first()).toContainText('슬라이드 복사')
    await page.getByRole('button', { name: '페이지 필기', exact: true }).click()
    await page.getByRole('button', { name: '만들고 나란히 열기', exact: true }).click()
    await expect(page.locator('.page-note-paper')).toHaveCount(100)
    await frames(page, 10)
    await app.evaluate(() => {
      const state = { delays: [] as number[], last: performance.now(), timer: undefined as ReturnType<typeof setInterval> | undefined }
      state.timer = setInterval(() => { const now = performance.now(); state.delays.push(now - state.last - 20); state.last = now }, 20)
      ;(globalThis as any).__studyMainTiming = state
    })
    const metrics = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.presentation-scroller')!
      const samples: number[] = [], longTasks: number[] = []
      const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)))
      observer.observe({ type: 'longtask', buffered: false })
      for (let i = 0; i < 90; i++) {
        const before = performance.now()
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: i < 45 ? 32 : -32 }))
        scroller.scrollTop += i < 45 ? 32 : -32
        await new Promise(requestAnimationFrame)
        samples.push(performance.now() - before)
      }
      observer.disconnect()
      samples.sort((a, b) => a - b)
      return { frameP95Ms: samples[Math.floor(samples.length * .95)]!, maxFrameMs: Math.max(...samples), longTasks }
    })
    const main = await app.evaluate(() => {
      const state = (globalThis as any).__studyMainTiming
      clearInterval(state.timer)
      delete (globalThis as any).__studyMainTiming
      return { maxMainDelayMs: Math.max(0, ...state.delays) }
    })
    await info.attach('interaction-timing', { body: JSON.stringify({ ...metrics, ...main }, null, 2), contentType: 'application/json' })
    console.log('Study interaction timing:', { ...metrics, ...main })
    expect(metrics.frameP95Ms).toBeLessThan(100)
    expect(metrics.maxFrameMs).toBeLessThan(200)
    expect(main.maxMainDelayMs).toBeLessThan(200)
  })

  test('copies the clicked slide, including ink and images, and offers the original', async ({}, info) => {
    const { page, app } = bandal
    await page.locator('[data-material-path="slides.pptx"]').click()
    const viewer = page.locator('.presentation-viewer:visible')
    await viewer.getByRole('spinbutton', { name: '슬라이드 번호' }).fill('5')
    const slide = viewer.locator('section[data-slide-index="4"]')
    await expect(slide.locator('canvas')).toBeVisible()
    await viewer.getByRole('button', { name: '텍스트', exact: true }).click()
    await slide.locator('.pdf-drawing-layer').click({ position: { x: 70, y: 170 } })
    await viewer.locator('[contenteditable="true"]').fill('복사할 필기')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('두 번째 줄')
    // Right click while editing: the menu must not create another textbox.
    await slide.click({ button: 'right', position: { x: 30, y: 30 } })
    await page.getByRole('menuitem', { name: '이미지로 복사', exact: true }).click()
    await expect(page.locator('.toast').last()).toContainText('5번 슬라이드를 이미지로 복사')
    const annotated = await app.evaluate(({ clipboard }) => ({ size: clipboard.readImage().getSize(), png: clipboard.readImage().toPNG().toString('base64') }))
    expect(annotated.size).toEqual({ width: 1600, height: 1200 })
    writeFileSync(info.outputPath('annotated.png'), Buffer.from(annotated.png, 'base64'))
    await info.attach('annotated.png', { body: Buffer.from(annotated.png, 'base64'), contentType: 'image/png' })
    await slide.click({ button: 'right', position: { x: 30, y: 30 } })
    await page.getByRole('menuitem', { name: '원본만 이미지로 복사' }).click()
    await expect(page.locator('.page-image-copy-status')).toHaveCount(0)
    const original = await app.evaluate(({ clipboard }) => clipboard.readImage().toPNG().toString('base64'))
    expect(original).not.toBe(annotated.png)
    await info.attach('original.png', { body: Buffer.from(original, 'base64'), contentType: 'image/png' })
    // The native clipboard payload can be pasted back as an image asset.
    await slide.click({ position: { x: 35, y: 35 }, button: 'right' })
    await page.keyboard.press('Escape')
    await viewer.getByRole('button', { name: '선택', exact: true }).click()
    await slide.click({ position: { x: 35, y: 35 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
    await expect(slide.locator('.ink-layer__image-el')).toBeVisible()
    await slide.click({ button: 'right', position: { x: 30, y: 30 } })
    await page.getByRole('menuitem', { name: '이미지로 복사', exact: true }).click()
    await expect(page.locator('.page-image-copy-status')).toHaveCount(0)
    await expect.poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readImage().toPNG().toString('base64'))) !== original).toBe(true)
    const withImage = await app.evaluate(({ clipboard }) => clipboard.readImage().toPNG().toString('base64'))
    expect(withImage).not.toBe(annotated.png)
    writeFileSync(info.outputPath('with-image.png'), Buffer.from(withImage, 'base64'))
  })

  test('rapidly reverses linked scrolling without echoes and preserves the page on tab return', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="slides.pptx"]').click()
    const viewer = page.locator('.presentation-viewer:visible')
    if (!await page.locator('.page-note-scroll:visible').count()) {
      await viewer.getByRole('button', { name: /^페이지 필기/ }).click()
      await page.getByRole('button', { name: '만들고 나란히 열기', exact: true }).click()
    }
    await viewer.getByRole('spinbutton', { name: '슬라이드 번호' }).fill('15')
    await frames(page)
    const result = await page.evaluate(async () => {
      const slide = document.querySelector<HTMLElement>('.presentation-scroller')!
      const note = document.querySelector<HTMLElement>('.page-note-scroll')!
      for (let i = 0; i < 12; i++) {
        const node = i % 2 ? note : slide
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -70 }))
        node.scrollTop -= 70
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
      }
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
      const stopped = [slide.scrollTop, note.scrollTop]
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame)
      return { stopped, settled: [slide.scrollTop, note.scrollTop] }
    })
    expect(result.settled).toEqual(result.stopped)
    const before = await viewer.getByRole('spinbutton', { name: '슬라이드 번호' }).inputValue()
    await page.locator('.workspace-tab__title', { hasText: /^slides\.pptx$/ }).click()
    await page.locator('[data-material-path="note-0.md"]').click()
    await page.locator('[data-material-path="slides.pptx"]').click()
    await expect(viewer.getByRole('spinbutton', { name: '슬라이드 번호' })).toHaveValue(before)
    await viewer.getByRole('button', { name: '확대', exact: true }).click()
    await frames(page, 5)
    await expect(viewer.getByRole('spinbutton', { name: '슬라이드 번호' })).toHaveValue(before)
    await viewer.getByRole('button', { name: '축소', exact: true }).click()
    await frames(page, 5)
    await expect(viewer.getByRole('spinbutton', { name: '슬라이드 번호' })).toHaveValue(before)
    const toggle = viewer.getByRole('button', { name: '스크롤 연결됨', exact: true })
    await toggle.click()
    const notePosition = await page.locator('.page-note-scroll:visible').evaluate((node) => node.scrollTop)
    await viewer.locator('.presentation-scroller').hover()
    await page.mouse.wheel(0, 200)
    await frames(page, 5)
    expect(await page.locator('.page-note-scroll:visible').evaluate((node) => node.scrollTop)).toBe(notePosition)
    await viewer.getByRole('button', { name: '스크롤 연결', exact: true }).click()
    await viewer.locator('.presentation-scroller').hover()
    await page.mouse.wheel(0, 200)
    await frames(page, 5)
    expect(await page.locator('.page-note-scroll:visible').evaluate((node) => node.scrollTop)).not.toBe(notePosition)
  })

  test('continuous pen input stays responsive over 200 existing strokes', async ({}, info) => {
    const { page } = bandal
    await page.evaluate(async () => {
      const courses = await window.bandal.invoke('courses:list', {})
      const courseId = courses[0]!.id
      for (let i = 0; i < 200; i++) {
        await window.bandal.invoke('drawings:create', {
          courseId, relPath: 'ink-heavy.pptx', page: 1, kind: 'ink',
          data: { points: Array.from({ length: 150 }, (_, j) => ({ x: .1 + j / 200, y: .15 + i / 350 + Math.sin(j / 4) * .01, p: .5 })) },
          style: { color: 'blue', width: .001, opacity: .5 }
        })
      }
    })
    await page.locator('[data-material-path="ink-heavy.pptx"]').click()
    const viewer = page.locator('.presentation-viewer:visible')
    const layer = viewer.locator('.pdf-drawing-layer').first()
    await expect(layer.locator('.ink-layer__mark')).toHaveCount(200)
    await viewer.getByRole('button', { name: '펜', exact: true }).click()
    const bounds = (await layer.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width * .1, bounds.y + bounds.height * .4)
    await page.mouse.down()
    const times = await layer.evaluate(async (node) => {
      const rect = node.getBoundingClientRect(), times: number[] = []
      const send = (type: string, x: number): void => {
        node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'pen', button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: .5, clientX: rect.x + rect.width * x, clientY: rect.y + rect.height * .4 }))
      }
      for (let i = 1; i <= 60; i++) {
        const before = performance.now()
        send('pointermove', .1 + i / 100)
        await new Promise(requestAnimationFrame)
        times.push(performance.now() - before)
      }
      return times.sort((a, b) => a - b)
    })
    await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .4)
    await page.mouse.up()
    const metrics = { penFrameP95Ms: times[Math.floor(times.length * .95)]!, maxPenFrameMs: Math.max(...times) }
    console.log('Dense ink timing:', metrics)
    await info.attach('pen-timing', { body: JSON.stringify(metrics), contentType: 'application/json' })
    expect(metrics.penFrameP95Ms).toBeLessThan(100)
    expect(metrics.maxPenFrameMs).toBeLessThan(200)
    await expect(layer.locator('.ink-layer__mark')).toHaveCount(201)
    await viewer.getByRole('button', { name: '되돌리기', exact: true }).click()
    await expect(layer.locator('.ink-layer__mark')).toHaveCount(200)
  })
})

test('PDF pairs hand scrolling back immediately after text composition and keep their page on resize', async () => {
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal
    await createCourse(page, 'PDF 연결 검사')
    const folder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())!
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 100; i++) pdf.addPage([720, 540])
    writeFileSync(join(bandal.dataRoot, folder.name, 'paired.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="paired.pdf"]').click()
    await page.getByRole('button', { name: '페이지 필기', exact: true }).click()
    await page.getByRole('button', { name: '만들고 나란히 열기', exact: true }).click()
    await expect(page.locator('.page-note-paper')).toHaveCount(100)
    const jump = page.getByRole('textbox', { name: '페이지 이동', exact: true })
    await jump.fill('30')
    await jump.press('Enter')
    await expect.poll(() => page.locator('.page-note-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(500)
    await page.locator('.page-note-scroll').hover()
    await page.mouse.wheel(0, -450)
    await expect(jump).not.toHaveValue('30')
    await frames(page, 5)
    const position = await page.locator('.pdf-scroller').evaluate((node) => node.scrollTop)
    await page.locator('.page-note-scroll').evaluate((node) => {
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '한' }))
      node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertCompositionText', data: '한' }))
      node.scrollTop += 80
    })
    await frames(page, 5)
    expect(await page.locator('.pdf-scroller').evaluate((node) => node.scrollTop)).toBe(position)
    await page.locator('.page-note-scroll').dispatchEvent('compositionend', { data: '한글' })
    await page.mouse.wheel(0, -250)
    await expect.poll(() => page.locator('.pdf-scroller').evaluate((node) => node.scrollTop)).not.toBe(position)
    await frames(page, 5)
    const readingPage = await jump.inputValue()
    const window = await app.browserWindow(page)
    await window.evaluate((win) => { const [width, height] = win.getSize(); win.setSize(width - 160, height) })
    await frames(page, 8)
    await expect(jump).toHaveValue(readingPage)
  } finally {
    await bandal.close()
  }
})
