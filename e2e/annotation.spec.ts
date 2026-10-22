import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

test('selected document and live browser parts append immutable references to one workspace draft', async ({}, info) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<html><head><title>Annotation source</title></head><body style="margin:40px;font:20px system-ui"><p id="paragraph" style="width:360px">Live browser source paragraph.</p><p id="tick"></p><iframe title="Embedded source" srcdoc="<p>Embedded frame content</p>" style="width:300px;height:120px"></iframe><script>window.clicked=0;window.ticks=0;document.querySelector("#paragraph").onclick=()=>window.clicked++;setInterval(()=>document.querySelector("#tick").textContent=String(++window.ticks),100)</script></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const { page, app } = bandal
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      host.setContentSize(1440, 1000)
      ipcMain.removeHandler('chat:open')
      ipcMain.handle('chat:open', (_event, req) => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'default', status: 'idle', title: null, surface: 'app', lastUsedAt: null } }))
      ipcMain.removeHandler('agent:models')
      ipcMain.handle('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }] }))
      ipcMain.removeHandler('chat:send')
      ipcMain.handle('chat:send', (_event, request) => { (globalThis as any).__annotationSent = request; throw new Error('Fixture failed send; keep the reference draft') })
    })
    await createCourse(page, '부분 선택 원본')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'source.md'), '# Reference\n\nOriginal immutable paragraph.\n')
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([600, 800]).drawText('Selectable PDF source line', { x: 40, y: 720, font, size: 18 })
    pdf.addPage([600, 800])
    writeFileSync(join(course.folderPath, 'source.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="source.md"]').click()
    const paragraph = page.locator('.ProseMirror:visible p').filter({ hasText: 'Original immutable paragraph.' }).first()
    await expect(paragraph).toBeVisible()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const composer = page.getByRole('textbox', { name: '메시지 입력' })
    await expect(composer).toBeVisible()
    await composer.fill('선택한 부분을 설명해 줘')
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await paragraph.hover()
    await expect(page.locator('.annotation-highlight')).toBeVisible()
    await paragraph.click()
    const refs = page.locator('.chat-annotation-reference')
    await expect(refs).toHaveCount(1)
    await expect(refs.first()).toContainText('Original immutable paragraph.')
    await page.getByRole('button', { name: '부분 선택 마치기' }).click()
    await paragraph.click(); await page.keyboard.press('End'); await page.keyboard.type(' Edited afterward.')
    await page.keyboard.press('ControlOrMeta+w')
    await expect(refs.first()).toContainText('Original immutable paragraph.')
    await expect(refs.first()).not.toContainText('Edited afterward')
    await refs.first().getByRole('button', { name: 'source.md', exact: true }).click()
    await expect(paragraph).toContainText('Edited afterward.')

    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await page.locator('[data-material-path="source.pdf"]').click()
    await expect(page.locator('.pdf-page:visible .textLayer').first()).toContainText('Selectable PDF source line')
    await page.getByRole('button', { name: '작업 공간 배치', exact: true }).click()
    await page.getByRole('menuitem', { name: '좌우 2분할', exact: true }).click()
    await expect(page.locator('.note-tab:visible')).toHaveCount(1)
    await expect(page.locator('.pdf-tab:visible')).toHaveCount(1)
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await page.locator('.pdf-page:visible .textLayer span').filter({ hasText: 'Selectable PDF source line' }).first().click()
    await expect(refs).toHaveCount(2)
    await expect(refs.nth(1)).toContainText('Selectable PDF source line')
    const bluePixels = await refs.nth(1).getByRole('img').evaluate(async image => {
      const source = image as HTMLImageElement; await source.decode()
      const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight
      const context = canvas.getContext('2d')!; context.drawImage(source, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let blue = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2]! > pixels[i]! + 40 && pixels[i + 2]! > pixels[i + 1]! + 10) blue++
      return blue
    })
    expect(bluePixels).toBe(0)
    await paragraph.click()
    await expect(refs).toHaveCount(3)
    await expect(refs.nth(2)).toContainText('Edited afterward.')
    await page.getByRole('button', { name: '부분 선택 마치기' }).click()
    await page.getByRole('textbox', { name: '페이지 이동' }).fill('2')
    await page.getByRole('textbox', { name: '페이지 이동' }).press('Enter')
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    const blank = page.locator('.pdf-page[data-pdf-page="2"]')
    await blank.scrollIntoViewIfNeeded()
    const box = (await blank.boundingBox())!
    const visibleTop = Math.max(box.y + 40, 160)
    await page.mouse.move(box.x + 40, visibleTop); await page.mouse.down(); await page.mouse.move(box.x + 160, visibleTop + 100); await page.mouse.up()
    await expect(refs).toHaveCount(4)
    await page.getByRole('button', { name: '부분 선택 마치기' }).click()

    await app.evaluate(({ BrowserWindow }, sourceUrl) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url: sourceUrl }) }, url)
    await expect(page.locator('.workspace-tab__title', { hasText: 'Annotation source' })).toBeVisible()
    const nativeId = await app.evaluate(({ BrowserWindow }, sourceUrl) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return (host.contentView.children.find((view: any) => view.webContents?.getURL() === sourceUrl) as Electron.WebContentsView).webContents.id
    }, url)
    await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.setZoomFactor(1.25), nativeId)
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await expect.poll(() => app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('!!document.querySelector("[data-bandal-annotation]")'), nativeId)).toBe(true)
    const before = await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.ticks'), nativeId)
    await expect.poll(() => app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.ticks'), nativeId)).toBeGreaterThan(before)
    await app.evaluate(async ({ app, BrowserWindow, webContents }, id) => {
      if (process.platform === 'darwin') app.focus({ steal: true })
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.focus()
      const contents = webContents.fromId(id)!, rect = await contents.executeJavaScript('(()=>{const r=document.querySelector("#paragraph").getBoundingClientRect();return {x:r.x,y:r.y}})()')
      const factor = contents.getZoomFactor(), x = Math.round((rect.x + 20) * factor), y = Math.round((rect.y + 10) * factor)
      contents.sendInputEvent({ type: 'mouseMove', x, y })
      contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }, nativeId)
    await expect(refs).toHaveCount(5)
    await expect(refs.nth(4)).toContainText('Live browser source paragraph.')
    expect(await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.clicked'), nativeId)).toBe(0)
    await app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id)!, rect = await contents.executeJavaScript('(()=>{const r=document.querySelector("iframe").getBoundingClientRect();return {x:r.x,y:r.y}})()')
      const factor = contents.getZoomFactor(), x = Math.round((rect.x + 20) * factor), y = Math.round((rect.y + 20) * factor)
      contents.sendInputEvent({ type: 'mouseMove', x, y }); contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }, nativeId)
    // Send is also a way to finish selection; it must include the final native queue.
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__annotationSent?.context?.references?.length)).toBe(6)
    await expect(page.getByRole('button', { name: '부분 선택 마치기' })).toHaveCount(0)
    await expect(refs).toHaveCount(6)
    await expect(refs.nth(5)).toContainText('Embedded source')
    await expect(refs.nth(5).getByRole('img')).toBeVisible()
    await expect(composer).toHaveValue('선택한 부분을 설명해 줘')
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await createCourse(page, '다른 공간')
    await expect(page.getByRole('button', { name: '부분 선택 마치기' })).toHaveCount(0)
    await expect(refs).toHaveCount(0)
    await page.locator('.course-row').filter({ hasText: '부분 선택 원본' }).first().click()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await expect(refs).toHaveCount(6)
    await page.screenshot({ path: info.outputPath('annotation-source-references.png') })
  } finally { await bandal.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
