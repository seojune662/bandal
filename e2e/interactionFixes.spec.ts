import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'
import { launchBandal, createCourse } from './helpers/launch'

const command = process.platform === 'darwin' ? 'Meta' : 'Control'

test('selected Markdown images reach the OS clipboard and paste across courses', async () => {
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal
    await createCourse(page, '이미지 원본')
    const dir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 60
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#14cc58'; ctx.fillRect(0, 0, 80, 60)
      return canvas.toDataURL().split(',')[1]!
    })
    writeFileSync(join(dir, 'green.png'), Buffer.from(png, 'base64'))
    writeFileSync(join(dir, 'source.md'), '# 원본\n\n![초록](green.png)\n\n끝\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="source.md"]').click()
    const image = page.locator('.ProseMirror img[data-material-rel-path]')
    await expect(image).toBeVisible()
    await image.click()
    await page.keyboard.press(`${command}+c`)
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 80, height: 60 })
    const portable = await app.evaluate(({ clipboard }) => ({ html: clipboard.readHTML(), png: clipboard.readImage().toPNG().toString('base64') }))
    expect(portable.html).toContain('data:image/png;base64,')
    expect(portable.html).toContain('data-bandal-source="green.png"')
    await app.evaluate(({ clipboard }) => clipboard.clear())
    await image.click({ button: 'right' })
    await page.getByRole('button', { name: '이미지 복사', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 80, height: 60 })
    // Separate native consumer: no editor serialization or app-local paste state.
    const external = await app.evaluate(async ({ BrowserWindow, clipboard }) => {
      const preview = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await preview.loadURL('data:text/html,<img id="p">')
        const url = clipboard.readImage().toDataURL()
        return await preview.webContents.executeJavaScript(`(async () => { const i=document.getElementById('p'); i.src=${JSON.stringify(url)}; await i.decode(); return [i.naturalWidth,i.naturalHeight] })()`)
      } finally { preview.destroy() }
    })
    expect(external).toEqual([80, 60])
    await page.bringToFront()
    await page.locator('.ProseMirror p').filter({hasText:'끝'}).click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('PASTE HERE ')
    await page.keyboard.press(`${command}+v`)
    await expect(page.locator('.ProseMirror img[data-material-rel-path]')).toHaveCount(2)
    expect(readdirSync(dir).filter(n => n === 'assets')).toHaveLength(0)
    await createCourse(page, '붙여넣을 과목')
    const secondDir = join(bandal.dataRoot, readdirSync(bandal.dataRoot).find(n => join(bandal.dataRoot, n) !== dir)!)
    writeFileSync(join(secondDir, 'target.md'), '# 대상\n\n여기에\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="target.md"]').click()
    await page.locator('.ProseMirror:visible').click()
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.press(`${command}+v`)
    await expect(page.locator('.ProseMirror:visible img[data-material-rel-path]')).toBeVisible()
    await expect.poll(() => readFileSync(join(secondDir, 'target.md'), 'utf8')).toContain('assets/')
    expect(readdirSync(join(secondDir, 'assets')).length).toBe(1)
    // A slower copy cannot replace content copied since it began.
    const { token } = await page.evaluate(() => window.bandal.invoke('clipboard:beginCopy', {}))
    await app.evaluate(({ clipboard }) => clipboard.writeText('newer clipboard'))
    const result = await page.evaluate(({ token, png }) => window.bandal.invoke('clipboard:writeImage', { token, png: `data:image/png;base64,${png}`, html: '', text: '' }), { token, png: portable.png })
    expect(result.written).toBe(false)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('newer clipboard')
  } finally { await bandal.close() }
})

test('PDF zoom retains painted pixels throughout a gesture and anchors the pointer', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '확대 축소')
    const dir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    const pdf = await PDFDocument.create()
    for (let i=0; i<12; i++) {
      const p = pdf.addPage([600, 800])
      p.drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(.12, .3, .7) })
      p.drawText(`Page ${i+1}`, { x: 50, y: 600, size: 35, color: rgb(1,1,1) })
    }
    writeFileSync(join(dir, 'zoom.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="zoom.pdf"]').click()
    const first = page.locator('.pdf-page[data-pdf-page="1"]')
    await expect(first.locator('.pdf-buffered-canvas canvas')).toBeVisible()
    // Observe every animation frame, including the period before the new raster finishes.
    const result = await first.evaluate(async element => {
      const rect = element.getBoundingClientRect(), point = { x: rect.left + rect.width * .55, y: rect.top + 180 }
      const scroller = element.closest('.pdf-scroller')!
      const startCanvas = element.querySelector('canvas')!
      let missing = 0, blank = 0, maxDrift = 0
      const yRatio = (point.y - rect.top) / rect.height
      for (let i=0; i<30; i++) {
        element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -5, clientX: point.x, clientY: point.y }))
        await new Promise(requestAnimationFrame)
        const canvas = element.querySelector('.pdf-buffered-canvas canvas') as HTMLCanvasElement | null
        if (!canvas || !canvas.width || !canvas.height) missing++
        else {
          const pixel = canvas.getContext('2d')!.getImageData(2, 2, 1, 1).data
          if (pixel[2]! < 100 || pixel[0]! > 100) blank++
        }
        const b = element.getBoundingClientRect()
        maxDrift = Math.max(maxDrift, Math.abs(b.top + b.height * yRatio - point.y))
      }
      return { missing, blank, maxDrift, keptOldCanvas: startCanvas === element.querySelector('.pdf-buffered-canvas canvas'), growth: element.getBoundingClientRect().width / rect.width, scrollLeft: scroller.scrollLeft }
    })
    expect(result.missing).toBe(0); expect(result.blank).toBe(0)
    expect(result.keptOldCanvas).toBe(true)
    expect(result.growth).toBeGreaterThan(1.25); expect(result.growth).toBeLessThan(1.5)
    expect(result.maxDrift).toBeLessThan(3)
    await page.waitForTimeout(500)
    await page.screenshot({ path: info.outputPath('smooth-pdf-zoom.png') })
    await expect(first.locator('.react-pdf__Page__textContent')).toBeVisible()
  } finally { await bandal.close() }
})
