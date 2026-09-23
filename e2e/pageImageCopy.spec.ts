import { expect, test, type Locator, type Page } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

async function pixels(page: Page, png: string): Promise<{ corner: number[]; marker: number[]; highlight: number[]; image: number[]; textPixels: number }> {
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const at = (x: number, y: number): number[] => [...ctx.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data]
    const text = ctx.getImageData(canvas.width * .1, canvas.height * .22, canvas.width * .35, canvas.height * .18).data
    let textPixels = 0
    for (let i = 0; i < text.length; i += 4) if (text[i]! < 180 && text[i + 1]! < 180 && text[i + 2]! < 180) textPixels++
    return { corner: at(.01, .01), marker: at(.9, .9), highlight: at(.3, .14), image: at(.65, .65), textPixels }
  }, png)
}

test.describe('page image clipboard', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  let original = ''
  let annotated = ''
  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '이미지 복사')
    const dir = join(bandal.dataRoot, readdirSync(bandal.dataRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name)
    const pdf = await PDFDocument.create()
    for (const [index, size] of [[600, 400], [600, 400], [595, 842], [100, 1000]].entries()) {
      const page = pdf.addPage(size as [number, number])
      const [width, height] = size as [number, number]
      page.drawText(`Page ${index + 1}`, { x: 20, y: height - 24, size: 12 })
      page.drawRectangle({ x: width * .85, y: height * .05, width: width * .1, height: height * .1, color: index === 1 ? rgb(.9, .1, .05) : rgb(.05, .1, .9) })
    }
    writeFileSync(join(dir, 'copy.pdf'), await pdf.save())
    writeFileSync(join(dir, 'paste.md'), '# 이미지 붙여넣기\n\n')
    const green = await bandal.page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#00bb22'; ctx.fillRect(0, 0, 40, 40)
      return canvas.toDataURL().split(',')[1]!
    })
    writeFileSync(join(dir, 'green.png'), Buffer.from(green, 'base64'))
    await bandal.page.evaluate(async () => {
      const courseId = (await window.bandal.invoke('courses:list', {}))[0]!.id
      const target = { courseId, relPath: 'copy.pdf', page: 2 }
      await window.bandal.invoke('annotations:create', { ...target, color: 'yellow', rects: [{ x: .1, y: .12, width: .4, height: .06 }], anchor: { quote: 'Page 2', prefix: '', suffix: '' } })
      await window.bandal.invoke('drawings:create', { ...target, kind: 'textbox', data: { box: { x: .1, y: .22, width: .35, height: .18 }, text: '복사할 한글 필기\n두 번째 줄' }, style: { color: 'ink', width: .002, opacity: 1, fontSizePt: 16 } })
      await window.bandal.invoke('drawings:create', { ...target, kind: 'ink', data: { points: [{ x: .15, y: .5, p: .5 }, { x: .35, y: .52, p: .5 }] }, style: { color: 'red', width: .01, opacity: 1 } })
      await window.bandal.invoke('drawings:create', { ...target, kind: 'image', data: { box: { x: .6, y: .6, width: .1, height: .15 }, image: { relPath: 'green.png', label: '초록 이미지', widthPx: 40, heightPx: 40 } }, style: { color: 'ink', width: .002, opacity: 1 } })
    })
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
    await bandal.page.locator('[data-material-path="copy.pdf"]').click()
    await expect(bandal.page.locator('.react-pdf__Page canvas').first()).toBeVisible()
  })
  test.afterAll(async () => { await bandal?.close() })

  async function jump(number: number): Promise<Locator> {
    const input = bandal.page.getByRole('textbox', { name: '페이지 이동', exact: true })
    await input.fill(String(number)); await input.press('Enter')
    const page = bandal.page.locator(`.pdf-page[data-pdf-page="${number}"]`)
    await expect(page.locator('.react-pdf__Page canvas')).toBeVisible()
    await expect(page.locator('.pdf-drawing-layer')).not.toHaveClass(/is-loading/)
    return page
  }
  async function readClipboard(): Promise<{ size: { width: number; height: number }; png: string }> {
    return bandal.app.evaluate(({ clipboard }) => ({ size: clipboard.readImage().getSize(), png: clipboard.readImage().toPNG().toString('base64') }))
  }
  async function copy(page: Locator, ink: boolean): Promise<Awaited<ReturnType<typeof readClipboard>>> {
    await expect.poll(async () => page.evaluate((node) => Math.abs(node.getBoundingClientRect().height - node.querySelector('.react-pdf__Page')!.getBoundingClientRect().height))).toBeLessThan(2)
    await page.click({ button: 'right', position: { x: 30, y: 30 } })
    await expect(bandal.page.getByRole('menu')).toHaveAttribute('aria-label', `${await page.getAttribute('data-pdf-page')} 페이지 메뉴`)
    await bandal.page.getByRole('menuitem', { name: ink ? '이미지로 복사' : '원본만 이미지로 복사', exact: true }).click()
    await expect(bandal.page.locator('.page-image-copy-status')).toHaveCount(0)
    return readClipboard()
  }

  test('copies the clicked partially visible PDF page with highlights, Hangul, ink and images', async ({}, info) => {
    const { page } = bandal
    const second = await jump(2)
    await expect(second.locator('.ink-layer__image-el')).toBeVisible()
    await expect(second.locator('.pdf-highlight')).toHaveCount(1)
    const plain = await copy(second, false)
    expect(plain.size).toEqual({ width: 1600, height: 1067 })
    original = plain.png
    const before = await pixels(page, original)
    expect(before.corner).toEqual([255, 255, 255, 255])
    expect(before.marker[0]).toBeGreaterThan(200)
    expect(before.marker[1]).toBeLessThan(40)
    expect(before.highlight).toEqual([255, 255, 255, 255])
    expect(before.image).toEqual([255, 255, 255, 255])
    // Leave only the bottom of page 2 visible, while the toolbar reports page 3.
    await second.evaluate((element) => {
      const scroller = element.closest('.pdf-scroller')!
      scroller.scrollTop += element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top - 70
    })
    await expect(page.getByRole('textbox', { name: '페이지 이동', exact: true })).toHaveValue('3')
    const bounds = (await second.boundingBox())!
    await page.mouse.click(bounds.x + 30, bounds.y + bounds.height - 25, { button: 'right' })
    await page.getByRole('menuitem', { name: '이미지로 복사', exact: true }).click()
    await expect(page.locator('.page-image-copy-status')).toHaveCount(0)
    await expect(page.locator('.toast').last()).toContainText('2 페이지를 이미지로 복사')
    const result = await readClipboard()
    expect(result.size).toEqual(plain.size)
    annotated = result.png
    const after = await pixels(page, annotated)
    expect(after.corner).toEqual(before.corner)
    expect(after.marker).toEqual(before.marker)
    expect(after.highlight[2]).toBeLessThan(after.highlight[0]!)
    expect(after.image[1]).toBeGreaterThan(150)
    expect(after.image[0]).toBeLessThan(10)
    expect(after.textPixels).toBeGreaterThan(500)
    expect(before.textPixels).toBe(0)
    await info.attach('pdf-with-ink.png', { body: Buffer.from(annotated, 'base64'), contentType: 'image/png' })
    await info.attach('pdf-original.png', { body: Buffer.from(original, 'base64'), contentType: 'image/png' })
  })

  test('is independent of zoom, supports portrait pages, and caps extremely tall pages', async () => {
    const { page, app } = bandal
    let second = await jump(2)
    await page.getByRole('button', { name: '확대', exact: true }).click()
    await page.getByRole('button', { name: '확대', exact: true }).click()
    second = await jump(2)
    expect((await copy(second, false)).png === original).toBe(true)
    const zoomedInk = await pixels(page, (await copy(second, true)).png)
    const initialInk = await pixels(page, annotated)
    expect(zoomedInk.highlight).toEqual(initialInk.highlight)
    expect(zoomedInk.image).toEqual(initialInk.image)
    expect(Math.abs(zoomedInk.textPixels - initialInk.textPixels)).toBeLessThan(initialInk.textPixels * .05)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))!.setSize(1100, 850))
    expect((await copy(await jump(2), false)).png === original).toBe(true)
    expect((await copy(await jump(3), false)).size).toEqual({ width: 1600, height: 2264 })
    expect((await copy(await jump(4), false)).size).toEqual({ width: 410, height: 4096 })
    await page.getByRole('button', { name: /현재 배율/ }).click()
  })

  test('supports keyboard menu navigation, restores focus, and right-click never draws', async () => {
    const { page } = bandal
    const second = await jump(2)
    const drawings = async (): Promise<number> => page.evaluate(async () => (await window.bandal.invoke('drawings:listForFile', { courseId: (await window.bandal.invoke('courses:list', {}))[0]!.id, relPath: 'copy.pdf' })).length)
    const before = await drawings()
    await page.getByRole('button', { name: '펜', exact: true }).click()
    await second.click({ button: 'right', position: { x: 25, y: 25 } })
    await expect(page.getByRole('menuitem', { name: '이미지로 복사', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '원본만 이미지로 복사' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('.page-image-copy-status')).toHaveCount(0)
    expect((await readClipboard()).png === original).toBe(true)
    await expect(second).toBeFocused()
    await second.click({ button: 'right', position: { x: 25, y: 25 } })
    await page.keyboard.press('Escape')
    await expect(second).toBeFocused()
    expect(await drawings()).toBe(before)
    await page.getByRole('button', { name: '선택', exact: true }).click()
  })

  test('keeps the previous clipboard image if encoding fails and allows retry', async () => {
    const { page } = bandal
    const second = await jump(2)
    const before = await readClipboard()
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (callback) { HTMLCanvasElement.prototype.toBlob = original; callback(null) }
    })
    await copy(second, false)
    await expect(page.locator('.toast').last()).toContainText('다시 시도')
    expect((await readClipboard()).png).toBe(before.png)
    expect((await copy(second, false)).png === original).toBe(true)
  })

  test('the native clipboard image pastes into a note, PDF and whiteboard', async () => {
    const { page } = bandal
    await copy(await jump(2), true)
    await page.locator('[data-material-path="paste.md"]').click()
    const editor = page.locator('.milkdown .ProseMirror:visible')
    await editor.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
    await expect(editor.locator('img[data-material-rel-path]')).toBeVisible()
    await page.locator('[data-material-path="copy.pdf"]').click()
    const first = await jump(1)
    await first.click({ position: { x: 100, y: 100 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
    await expect(first.locator('.ink-layer__image-el')).toBeVisible()
    await page.locator('.whiteboards-group').getByRole('button', { name: '새 화이트보드 만들기' }).click()
    const board = page.locator('.canvas-tab__surface:visible')
    await expect(board).toBeVisible()
    await board.click({ position: { x: 150, y: 150 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v')
    await expect(board.locator('.ink-layer__image-el')).toBeVisible()
  })
})
