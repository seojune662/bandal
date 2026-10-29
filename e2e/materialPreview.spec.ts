import { expect, test, type Locator } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { buildPptx } from './helpers/presentation'

async function syncNativeHoverPointer(bandal: BandalApp, row: Locator): Promise<void> {
  if (process.platform !== 'win32') return
  const box = await row.boundingBox()
  if (!box) throw new Error('Material row has no screen bounds')
  const point = await bandal.app.evaluate(({ BrowserWindow, screen }, position) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    const bounds = window.getContentBounds()
    const zoom = window.webContents.getZoomFactor()
    return { ...screen.dipToScreenPoint({ x: Math.round(bounds.x + position.x * zoom), y: Math.round(bounds.y + position.y * zoom) }), before: screen.dipToScreenPoint(screen.getCursorScreenPoint()) }
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  // CDP hover alone does not move the Windows cursor. Hiding a native view
  // causes Chromium to re-hit-test that OS position, so keep both inputs aligned.
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class MaterialHoverCursor { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'; if (-not [MaterialHoverCursor]::SetCursorPos(${point.x}, ${point.y})) { throw 'SetCursorPos failed' }`
  ], { timeout: 15_000 })
  const actual = await bandal.app.evaluate(({ screen }) => screen.dipToScreenPoint(screen.getCursorScreenPoint()))
  console.log('Native hover cursor alignment:', { before: point.before, target: { x: point.x, y: point.y }, actual })
  expect(Math.abs(actual.x - point.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(actual.y - point.y)).toBeLessThanOrEqual(1)
}

async function showPreview(bandal: BandalApp, row: Locator, nativePage = false): Promise<Locator> {
  const card = bandal.page.locator('.material-preview')
  // A pending filesystem watcher refresh may legitimately dismiss the first
  // hover. Re-enter the row once the material's current revision is visible.
  await expect(async () => {
    await bandal.page.mouse.move(10, 10)
    if (nativePage) await syncNativeHoverPointer(bandal, row)
    await row.hover()
    await expect(card).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  return card
}

async function newNote(bandal: BandalApp, title: string, body: string) {
  const course = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
  const note = await bandal.page.evaluate(async ({ courseId, title, body }) => {
    const created = await window.bandal.invoke('notes:create', { courseId, title, dirRelPath: '' })
    await window.bandal.invoke('notes:write', { ...created, markdown: `# ${title}\n\n${body}\n` })
    return created
  }, { courseId: course.id, title, body })
  await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
  const row = bandal.page.locator(`[data-material-path="${note.relPath}"]`)
  await expect(row).toBeVisible()
  return { course, note, row }
}

test('new notes retain their dot while opened, duplicate tabs close independently, and hover never opens a tab', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '자료 상태 표시')
    const { row, note } = await newNote(bandal, 'Preview note', 'Hover reveals the intended upload material.')
    await expect(row).toHaveAttribute('data-material-new', 'true')
    await expect(row).not.toHaveAttribute('data-material-open', 'true')
    const before = await page.locator('.workspace-tab').count()
    const card = await showPreview(bandal, row)
    await expect(card).toContainText('Hover reveals the intended upload material.')
    expect(await page.locator('.workspace-tab').count()).toBe(before)
    await info.attach('new-material-preview', { body: await page.screenshot({ path: info.outputPath('new-material-preview-dark.png') }), contentType: 'image/png' })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await info.attach('new-material-preview-light', { body: await page.screenshot({ path: info.outputPath('new-material-preview-light.png') }), contentType: 'image/png' })
    await row.click()
    await expect(card).toHaveCount(0)
    await expect(row).toHaveAttribute('data-material-open', 'true')
    await expect(row).toHaveAttribute('data-material-new', 'true')
    const tab = page.locator('.workspace-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: 'Preview note' }) })
    await expect(tab).toHaveCount(1)
    await tab.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '탭 복제', exact: true }).click()
    await expect(tab).toHaveCount(2)
    await tab.first().locator('.workspace-tab__close').click()
    await expect(tab).toHaveCount(1)
    await expect(row).toHaveAttribute('data-material-open', 'true')
    await tab.locator('.workspace-tab__close').click()
    await expect(tab).toHaveCount(0)
    await expect(row).not.toHaveAttribute('data-material-open', 'true')
    await expect(row).toHaveAttribute('data-material-new', 'true')
    await showPreview(bandal, row)
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    const tree = await page.evaluate(courseId => window.bandal.invoke('materials:tree', { courseId }), note.courseId)
    expect(tree.find(node => node.relPath === note.relPath)?.addedAt).toEqual(expect.any(Number))
  } finally { await bandal.close() }
})

async function docxFixture(text: string): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('hover previews text, office, table, PDF and image files without opening document viewers', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '자료 내용 미리보기')
    const course = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const folder = course.folderPath
    writeFileSync(join(folder, 'outline.txt'), 'Plain text preview marker')
    writeFileSync(join(folder, 'memo.docx'), await docxFixture('Office preview marker'))
    writeFileSync(join(folder, 'slides.pptx'), await buildPptx('Slide preview marker', 2))
    writeFileSync(join(folder, 'table.csv'), 'Topic,Count\nPhysics,42\n')
    copyFileSync(resolve(__dirname, '..', 'resources', 'icon.png'), join(folder, 'image.png'))
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([300, 400]).drawText('PDF preview marker', { x: 30, y: 340, size: 18, font })
    writeFileSync(join(folder, 'page.pdf'), await pdf.save())
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
    const before = await bandal.page.locator('.workspace-tab').count()
    for (const [file, marker] of [
      ['outline.txt', 'Plain text preview marker'], ['memo.docx', 'Office preview marker'],
      ['slides.pptx', 'Slide preview marker'], ['table.csv', 'Physics']
    ]) {
      const card = await showPreview(bandal, bandal.page.locator(`[data-material-path="${file}"]`))
      await expect(card).toContainText(marker!)
      expect(await bandal.page.locator('.workspace-tab').count()).toBe(before)
    }
    const pdfCard = await showPreview(bandal, bandal.page.locator('[data-material-path="page.pdf"]'))
    await expect(pdfCard.getByRole('img', { name: 'PDF 첫 페이지' })).toBeVisible()
    await expect(pdfCard).toContainText('1 / 1쪽')
    // A normal imported PDF uses the same saved-ink composite as a PDF note.
    // Keep the hover open while repository writes arrive so scoped updates,
    // not a new mouse hover or a filesystem modification, refresh the preview.
    const lastDrawing = await bandal.page.evaluate(async courseId => {
      const { documentRevision } = await window.bandal.invoke('pdf:previewSnapshot', { courseId, relPath: 'page.pdf' })
      let id = ''
      for (let index = 0; index < 165; index++) {
        const drawing = await window.bandal.invoke('drawings:create', { courseId, relPath: 'page.pdf', documentRevision, page: 1, kind: 'rect',
          data: { box: { x: .1 + (index % 10) * .07, y: .2 + Math.floor(index / 10) * .03, width: .04, height: .02 } },
          style: { color: 'blue', width: .002, opacity: 1 } })
        id = drawing.id
      }
      return { id, documentRevision }
    }, course.id)
    await expect(pdfCard.locator('svg[aria-label="저장된 필기"] rect')).toHaveCount(165)
    await bandal.page.evaluate(async request => { await window.bandal.invoke('drawings:delete', { ids: [request.id], documentRevision: request.documentRevision }) }, lastDrawing)
    await expect(pdfCard.locator('svg[aria-label="저장된 필기"] rect')).toHaveCount(164)
    await info.attach('pdf-material-preview', { body: await bandal.page.screenshot({ path: info.outputPath('pdf-material-preview.png') }), contentType: 'image/png' })
    const imageCard = await showPreview(bandal, bandal.page.locator('[data-material-path="image.png"]'))
    await expect(imageCard.getByRole('img', { name: 'image.png 미리보기' })).toBeVisible()
    await expect.poll(() => imageCard.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await bandal.page.locator('.workspace-tab').count()).toBe(before)
  } finally { await bandal.close() }
})

function visibleNativePages(bandal: BandalApp): Promise<number[]> {
  return bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(window => window.webContents.getURL().includes('index.html'))
    .flatMap(window => window.contentView.children)
    .filter(view => 'webContents' in view && view.getVisible())
    .map(view => (view as Electron.WebContentsView).webContents.id))
}

test('preview overlays a native browser, then releases it before material drag and local file upload', async ({}, info) => {
  const uploads: { name: string; text: string; size: number }[] = []
  const server = createServer((req, res) => {
    if (req.url === '/upload') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => { uploads.push(JSON.parse(body)); res.end('ok') })
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<html><head><title>Local upload target</title></head><body style="margin:0"><main id="drop" style="height:90vh;padding:24px;background:#e8f4ff">Drop a material here<input id="draft" value="keep this draft"></main><script>
      window.pageIdentity = 731;
      const target = document.querySelector('#drop');
      target.addEventListener('dragover', event => event.preventDefault());
      target.addEventListener('drop', async event => {
        event.preventDefault(); const file = event.dataTransfer.files[0];
        if (file) await fetch('/upload', {method:'POST',body:JSON.stringify({name:file.name,size:file.size,text:await file.text()})});
      });
    </script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '미리보기 업로드')
    const { row, note, course } = await newNote(bandal, 'Upload note', 'Exact local upload content.')
    const add = page.locator('.workspace-add-tab')
    if (await add.isVisible()) await add.click()
    else await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByLabel('새 탭 검색').fill(origin)
    await page.getByRole('option').filter({ hasText: '브라우저' }).click()
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === `${url}/`)?.id, origin)).toEqual(expect.any(Number))
    const browserId = await bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === `${url}/`)!.id, origin)
    await expect.poll(() => visibleNativePages(bandal)).toEqual([browserId])
    await page.evaluate(() => {
      const events: unknown[] = []
      ;(window as unknown as { materialHoverEvents: unknown[] }).materialHoverEvents = events
      const label = (target: EventTarget | null): string => target instanceof Element ? `${target.tagName}.${target.className}` : target === window ? 'window' : 'document'
      const record = (event: Event): void => {
        if (events.length >= 100) events.shift()
        events.push({ type: event.type, target: label(event.target), related: label((event as FocusEvent).relatedTarget), focused: document.hasFocus(), visibility: document.visibilityState, buttons: (event as PointerEvent).buttons, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY, card: !!document.querySelector('.material-preview') })
      }
      for (const type of ['focus', 'blur', 'pointerover', 'pointerout', 'visibilitychange', 'scroll']) window.addEventListener(type, record, true)
      new MutationObserver(records => {
        if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && node.matches('.material-preview')))) record(new Event('preview-change'))
      }).observe(document.body, { childList: true })
    })
    let card: Locator
    try { card = await showPreview(bandal, row, true) }
    catch (error) {
      console.log('Native material hover events:', JSON.stringify(await page.evaluate(() => (window as unknown as { materialHoverEvents: unknown[] }).materialHoverEvents)))
      console.log('Native material hover windows:', JSON.stringify(await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ focused: window.isFocused(), visible: window.isVisible(), bounds: window.getBounds(), contentsFocused: window.webContents.isFocused() })))))
      await page.screenshot({ path: info.outputPath('native-hover-failure.png') })
      throw error
    }
    await expect(card).toContainText('Exact local upload content.')
    await expect.poll(() => visibleNativePages(bandal)).toEqual([])
    await expect.poll(() => page.locator('.browser-native-anchor').evaluate(element => (element as HTMLElement).style.backgroundImage)).toContain('data:image/')
    await info.attach('preview-over-native-browser', { body: await page.screenshot({ path: info.outputPath('preview-over-native-browser.png') }), contentType: 'image/png' })

    await bandal.app.evaluate(({ ipcMain }) => {
      ipcMain.once('materials:startDrag', (_event, payload) => {
        ;(globalThis as unknown as { previewDragPayload: unknown }).previewDragPayload = payload
      })
    })
    await row.evaluate(element => element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))
    await expect(card).toHaveCount(0)
    await expect.poll(() => visibleNativePages(bandal)).toEqual([browserId])
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { previewDragPayload: unknown }).previewDragPayload))
      .toEqual({ courseId: course.id, relPath: note.relPath })

    // launchBandal disables OS startDrag to avoid Electron's nested native
    // drag loop. Verify its real IPC payload above, then independently deliver
    // the same on-disk file through Chromium's trusted drag/drop protocol.
    const path = join(course.folderPath, note.relPath)
    await bandal.app.evaluate(async ({ webContents }, { id, path }) => {
      const wc = webContents.fromId(id)!
      const owned = !wc.debugger.isAttached()
      if (owned) wc.debugger.attach('1.3')
      try {
        const data = { items: [], files: [path], dragOperationsMask: 1 }
        for (const type of ['dragEnter', 'dragOver', 'drop']) await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 120, y: 140, data })
      } finally { if (owned && wc.debugger.isAttached()) wc.debugger.detach() }
    }, { id: browserId, path })
    await expect.poll(() => uploads).toEqual([{ name: note.relPath, text: readFileSync(path, 'utf8'), size: readFileSync(path).length }])
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("[window.pageIdentity, document.querySelector('#draft').value]"), browserId))
      .toEqual([731, 'keep this draft'])
    await info.attach('drag-coverage', { body: 'Native-drag IPC payload, preview dismissal, native-page restoration and Chromium local-file upload verified. An actual OS drag gesture is disabled by the shared E2E launcher.', contentType: 'text/plain' })
  } finally {
    await bandal.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('migrated note hover preserves editable first-page text and attached image', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '이전 노트 미리보기')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    copyFileSync(resolve(__dirname, '..', 'resources', 'icon.png'), join(course.folderPath, 'board-image.png'))
    const note = await page.evaluate(async courseId => {
      const board = await window.bandal.invoke('canvas:create', { courseId, title: '이전할 노트' })
      const style = { color: 'ink' as const, width: 0.01, opacity: 1 }
      await window.bandal.invoke('canvas:setPageCount', { boardId: board.id, pageCount: 3 })
      await window.bandal.invoke('canvas:setBackground', { boardId: board.id, background: 'lines', surface: 'dark' })
      for (const [id, page, text] of [['preview-text', 1, 'First page preview marker'], ['preview-hidden-page', 2, 'Second page must stay hidden']] as const) {
        await window.bandal.invoke('canvas:putShape', { boardId: board.id, id, page,
          shape: { kind: 'textbox', data: { box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, text }, style } })
      }
      await window.bandal.invoke('canvas:putShape', { boardId: board.id, id: 'preview-image', page: 1,
        shape: { kind: 'image', data: { box: { x: 0.15, y: 0.3, width: 0.5, height: 0.35 }, image: { relPath: 'board-image.png', label: 'Attached image' } }, style } })
      const result = await window.bandal.invoke('pdfNotes:migrateLegacy', { courseId })
      return result.migrated.find(item => item.boardId === board.id)!
    }, course.id)
    expect(note).toBeTruthy()
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="노트"]').click()
    const row = page.locator(`[data-material-path="${note.relPath}"]`)
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-material-new', 'true')
    const before = await page.locator('.workspace-tab').count()
    const card = await showPreview(bandal, row)
    await expect(card.getByRole('img', { name: '저장된 필기' })).toBeVisible()
    await expect(card).toContainText('First page preview marker')
    await expect(card).not.toContainText('Second page must stay hidden')
    await expect(card).toContainText('1 / 3쪽')
    await expect(card.locator('.material-preview-content__board')).toHaveAttribute('data-surface', 'dark')
    await expect(card.locator('svg image')).toHaveAttribute('href', /^data:image\//)
    expect(await page.locator('.workspace-tab').count()).toBe(before)
    await expect(row).not.toHaveAttribute('data-material-open', 'true')
    await info.attach('note-material-preview', { body: await page.screenshot({ path: info.outputPath('note-material-preview.png') }), contentType: 'image/png' })
    await row.click()
    await expect(card).toHaveCount(0)
    await expect(row).toHaveAttribute('data-material-open', 'true')
    await expect(page.locator('.pdf-page').first()).toBeVisible()
  } finally { await bandal.close() }
})
