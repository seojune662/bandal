import { expect, test, type Page } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { startFileServer } from './helpers/fileServer'
import { clickBrowserToolbarAction } from './helpers/browserToolbar'

const overview = (page: Page) => page.locator('.workspace-windows-overview')
const activePdf = (page: Page) => page.locator('.pdf-tab:visible')
async function chrome(page: Page, mode: '모두 표시' | '탭 바만 숨기기' | '탭 바와 도구 모음 숨기기'): Promise<void> {
  await page.getByRole('button', { name: '탭 바와 도구 모음 표시', exact: true }).click()
  await page.getByRole('menuitemradio', { name: mode, exact: true }).click()
}
async function manage(page: Page): Promise<void> {
  await page.getByRole('button', { name: '윈도우 관리', exact: true }).click()
  await expect(overview(page)).toBeVisible()
}
async function renameWindow(page: Page, previous: string, next: string): Promise<void> {
  await overview(page).getByRole('button', { name: `${previous} 이름 변경`, exact: true }).click()
  const input = overview(page).getByRole('textbox', { name: '윈도우 이름', exact: true })
  await input.fill(next); await input.press('Enter')
  await expect(overview(page).getByRole('button', { name: `${next} 열기`, exact: true })).toBeVisible()
}
async function pdfFixture(path: string): Promise<void> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let index = 1; index <= 5; index++) pdf.addPage([600, 800]).drawText(`Window PDF page ${index}`, { x: 40, y: 730, size: 24, font })
  writeFileSync(path, await pdf.save())
}
async function browserPages(app: BandalApp, origin: string): Promise<Array<{ id: number; visible: boolean; url: string }>> {
  return app.app.evaluate(({ BrowserWindow }, prefix) => {
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    return host.contentView.children.flatMap((view: any) => view.webContents?.getURL().startsWith(prefix)
      ? [{ id: view.webContents.id, url: view.webContents.getURL(), visible: view.getVisible() }] : [])
  }, origin)
}
async function openBrowser(app: BandalApp, url: string): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, target) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url: target })
  }, url)
}

test('fixed workspace controls collapse pane chrome, preserve live pages, and keep shortcuts in projects', async ({}, info) => {
  test.setTimeout(150_000)
  const site = await startFileServer({ '/canvas': { fileName: 'canvas.html', attachment: false, contentType: 'text/html; charset=utf-8', body: '<html><head><title>Private title fixture</title></head><body style="margin:0;background:#36a4de;min-height:2000px"><input id="draft" value="live browser draft"><h1>Browser content fixture</h1><script>window.instanceToken=Math.random()</script></body></html>' } })
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const { page } = bandal
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1440, 900))
    await createCourse(page, '고정 보기 검사')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'draft.md'), '# Window draft\n\nPreserved editor content.\n')
    await pdfFixture(join(course.folderPath, 'pages.pdf'))
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="draft.md"]').click()
    await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
    await page.locator('[data-material-path="pages.pdf"]').click()
    await expect(activePdf(page).locator('.pdf-toolbar__page-input')).toBeVisible()
    await openBrowser(bandal, `${site.origin}/canvas`)
    await expect.poll(async () => (await browserPages(bandal, site.origin)).length).toBe(1)
    const browserId = (await browserPages(bandal, site.origin))[0]!.id
    await expect.poll(() => bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.readyState === "complete" && !!document.querySelector("#draft")'), browserId)).toBe(true)
    const instance = await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.instanceToken'), browserId)
    await page.getByRole('button', { name: '작업 공간 배치', exact: true }).first().click()
    await page.getByRole('menuitem', { name: '2×2 4분할', exact: true }).click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-groupview')).toHaveCount(4)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
    await page.locator('.note-tab:visible').evaluate(element => element.setAttribute('data-window-instance', 'retained-original-editor'))
    const controls = page.getByRole('group', { name: '작업 공간 보기', exact: true })
    const fixed = (await controls.boundingBox())!
    const fixedAtCorner = async (): Promise<void> => {
      await expect(controls).toBeVisible()
      expect(await controls.boundingBox()).toEqual(fixed)
      expect(await controls.getByRole('button').count()).toBe(3)
    }
    // Windows keeps the same reserved caption-button area when fullscreen
    // changes. Exercise the CSS contract on every host platform.
    const nativeAttributes = await page.locator('html').evaluate(element => ({
      platform: element.getAttribute('data-platform'), fullscreen: element.getAttribute('data-fullscreen')
    }))
    await page.locator('html').evaluate(element => { element.setAttribute('data-platform', 'win32'); element.setAttribute('data-fullscreen', 'false') })
    const windowsControls = await controls.boundingBox()
    await page.locator('html').evaluate(element => element.setAttribute('data-fullscreen', 'true'))
    expect(await controls.boundingBox()).toEqual(windowsControls)
    await page.locator('html').evaluate((element, attributes) => {
      for (const [key, value] of Object.entries(attributes)) {
        if (value === null) element.removeAttribute(`data-${key}`)
        else element.setAttribute(`data-${key}`, value)
      }
    }, nativeAttributes)
    await fixedAtCorner()
    await page.getByRole('button', { name: '오른쪽 사이드바 접기', exact: true }).click()
    await fixedAtCorner()
    await page.getByRole('button', { name: '오른쪽 사이드바 펼치기', exact: true }).click()
    await fixedAtCorner()
    const sidebar = (await page.locator('#right-sidebar').boundingBox())!
    expect(sidebar.y).toBeGreaterThanOrEqual(fixed.y + fixed.height)
    await chrome(page, '탭 바만 숨기기')
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'tabs-hidden')
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tabs-and-actions-container:visible')).toHaveCount(0)
    await expect(activePdf(page).locator('.pdf-toolbar')).toBeVisible()
    await expect(page.locator('.browser-panel:visible .browser-toolbar')).toBeVisible()
    await fixedAtCorner()
    const before = (await activePdf(page).locator('.pdf-scroller').boundingBox())!
    await chrome(page, '탭 바와 도구 모음 숨기기')
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'all-hidden')
    await expect(page.locator('.workspace-host [data-workspace-toolbar]:visible')).toHaveCount(0)
    await expect.poll(async () => (await activePdf(page).locator('.pdf-scroller').boundingBox())!.height).toBeGreaterThan(before.height)
    await fixedAtCorner()
    await page.screenshot({ path: info.outputPath('workspace-focus-hidden.png') })
    await chrome(page, '모두 표시')
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tabs-and-actions-container:visible')).toHaveCount(4)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('Preserved editor content.')
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.instanceToken'), browserId)).toBe(instance)
    expect(await browserPages(bandal, site.origin)).toEqual([{ id: browserId, url: `${site.origin}/canvas`, visible: true }])
    await page.screenshot({ path: info.outputPath('workspace-controls-all.png') })
    const publicPoint = await page.locator('.browser-panel:visible').evaluate(node => {
      const host = document.querySelector('.workspace-host')!.getBoundingClientRect(), rect = node.getBoundingClientRect()
      return { x: (rect.x - host.x + rect.width * .75) / host.width, y: (rect.y - host.y + rect.height * .75) / host.height }
    })
    await manage(page)
    await expect(overview(page).locator('.workspace-window-card img')).toBeVisible()
    const publicPixel = await overview(page).locator('.workspace-window-card img').evaluate(async (node, point) => {
      const image = node as HTMLImageElement; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return Array.from(ctx.getImageData(Math.floor(point.x * canvas.width), Math.floor(point.y * canvas.height), 1, 1).data)
    }, publicPoint)
    expect(publicPixel.slice(0, 3).every((value, index) => Math.abs(value - [54, 164, 222][index]!) < 8)).toBe(true)
    await fixedAtCorner()
    await page.screenshot({ path: info.outputPath('workspace-overview-light.png') })
    await overview(page).getByRole('button', { name: '윈도우 관리 닫기', exact: true }).click()
    await clickBrowserToolbarAction(page, '시크릿 모드 켜기')
    await expect(page.locator('.browser-panel:visible')).toHaveAttribute('data-private', 'true')
    await expect.poll(async () => (await browserPages(bandal, site.origin)).filter(item => item.visible).length).toBe(1)
    const privatePage = (await browserPages(bandal, site.origin)).find(item => item.visible)!
    await expect.poll(() => bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('typeof window.instanceToken'), privatePage.id)).toBe('number')
    const mask = await page.locator('.browser-panel:visible').evaluate(node => {
      const host = document.querySelector('.workspace-host')!.getBoundingClientRect(), rect = node.getBoundingClientRect()
      return { x: (rect.x - host.x + rect.width / 2) / host.width, y: (rect.y - host.y + rect.height / 2) / host.height }
    })
    await manage(page)
    const pixels = await overview(page).locator('.workspace-window-card img').evaluate(async (node, point) => {
      const image = node as HTMLImageElement; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return Array.from(ctx.getImageData(Math.floor(point.x * canvas.width), Math.floor(point.y * canvas.height), 1, 1).data)
    }, mask)
    expect(pixels.slice(0, 3).every((value, index) => Math.abs(value - [232, 232, 236][index]!) < 8)).toBe(true)
    const privateInstance = await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.instanceToken'), privatePage.id)
    for (let added = 0; added < 3; added++) {
      await overview(page).getByRole('button', { name: '윈도우 추가', exact: true }).click()
      await expect(overview(page)).toBeHidden()
      expect((await browserPages(bandal, site.origin)).filter(item => item.visible)).toHaveLength(0)
      await manage(page)
    }
    await expect(overview(page).locator('.workspace-window-card')).toHaveCount(4)
    await overview(page).getByRole('button', { name: '윈도우 1 열기', exact: true }).click()
    await expect.poll(async () => (await browserPages(bandal, site.origin)).find(item => item.id === privatePage.id)?.visible).toBe(true)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.instanceToken'), privatePage.id)).toBe(privateInstance)
    await expect(page.locator('.note-tab:visible')).toHaveAttribute('data-window-instance', 'retained-original-editor')
    await manage(page)
    await overview(page).getByRole('button', { name: '윈도우 관리 닫기', exact: true }).click()
    await page.evaluate(async id => { await window.bandal.invoke('learning:create', { placement: 'in-course', courseId: id, rootRelPath: 'Project', name: '같은 탐색', topic: '자료' }) }, course.id)
    await expect(page.getByRole('region', { name: '학교 바로가기', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'AI 웹 바로가기', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '프로젝트', exact: true }).first().click()
    const project = page.locator('.project-list-row__open').filter({ hasText: '같은 탐색' })
    await project.click()
    await expect(project).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('region', { name: '학교 바로가기', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'AI 웹 바로가기', exact: true })).toBeVisible()
    await manage(page)
    await expect(overview(page).locator('.workspace-window-card')).toHaveCount(1)
    await overview(page).getByRole('button', { name: '윈도우 추가', exact: true }).click()
    await expect(overview(page)).toBeHidden()
    await manage(page)
    await expect(overview(page).locator('.workspace-window-card')).toHaveCount(2)
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: info.outputPath('project-windows-dark.png'), animations: 'disabled' })
  } finally { await bandal.close(); await site.close() }
})

test('window names, order, chrome and independent PDF positions survive switching and restart', async ({}, info) => {
  test.setTimeout(150_000)
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profile = bandal.profileDir
  try {
    let page = bandal.page
    await createCourse(page, '윈도우 복원 검사')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const pdfPath = join(course.folderPath, 'positions.pdf')
    await pdfFixture(pdfPath)
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="positions.pdf"]').click()
    const jump = async (number: number): Promise<void> => {
      const input = activePdf(page).locator('.pdf-toolbar__page-input')
      await input.fill(String(number)); await input.press('Enter'); await expect(input).toHaveValue(String(number))
    }
    await expect(activePdf(page).locator('.pdf-toolbar__page-total')).toHaveText('/ 5')
    await activePdf(page).locator('.pdf-toolbar__zoom-value').click()
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText('100%')
    // Both fast clicks must apply even when React paints them in one frame.
    await activePdf(page).getByRole('button', { name: '확대', exact: true }).dblclick()
    const readingZoom = '132%'
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText(readingZoom)
    await jump(2)
    await chrome(page, '탭 바만 숨기기')
    await manage(page); await renameWindow(page, '윈도우 1', '읽기')
    await expect(overview(page).getByRole('button', { name: '읽기 닫기', exact: true })).toBeDisabled()
    await overview(page).getByRole('button', { name: '윈도우 추가', exact: true }).click()
    await expect(overview(page)).toBeHidden()
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'all')
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(0)
    await page.locator('[data-material-path="positions.pdf"]').click()
    await expect(activePdf(page).locator('.pdf-toolbar__page-total')).toHaveText('/ 5')
    // A fresh panel may inherit the file's previous zoom. Set an independent
    // value explicitly and wait for the animation-frame update before reading.
    await activePdf(page).locator('.pdf-toolbar__zoom-value').click()
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText('100%')
    await activePdf(page).getByRole('button', { name: '축소', exact: true }).click()
    const solvingZoom = '87%'
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText(solvingZoom)
    expect(solvingZoom).not.toBe(readingZoom)
    await jump(4)
    await chrome(page, '탭 바와 도구 모음 숨기기')
    await manage(page)
    await renameWindow(page, (await overview(page).locator('.workspace-window-card[data-active] .workspace-window-card__name').textContent())!, '풀이')
    await overview(page).getByRole('button', { name: '풀이 앞으로 이동', exact: true }).click()
    await expect(overview(page).locator('.workspace-window-card__name')).toHaveText(['풀이', '읽기'])
    await overview(page).getByRole('button', { name: '읽기 열기', exact: true }).click()
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'tabs-hidden')
    await expect(activePdf(page).locator('.pdf-toolbar__page-input')).toHaveValue('2')
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText(readingZoom!)
    await manage(page)
    await expect(overview(page).locator('.workspace-window-card img')).toHaveCount(2)
    const previews = await overview(page).locator('.workspace-window-card').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-window-id')!, src: node.querySelector<HTMLImageElement>('img')!.src })))
    await overview(page).getByRole('button', { name: '읽기 열기', exact: true }).click()
    await page.screenshot({ path: info.outputPath('window-reading-before-restart.png') })
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile }); page = bandal.page
    await expect(activePdf(page).locator('.pdf-toolbar__page-input')).toHaveValue('2')
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText(readingZoom!)
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'tabs-hidden')
    for (const preview of previews) {
      const stored = await page.evaluate(key => window.bandal.invoke('workspacePreview:read', key), { workspaceKey: course.id, windowId: preview.id })
      expect(stored.imageDataUrl).toBe(preview.src)
    }
    await manage(page)
    await expect(overview(page).locator('.workspace-window-card__name')).toHaveText(['풀이', '읽기'])
    await overview(page).getByRole('button', { name: '풀이 열기', exact: true }).click()
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-workspace-chrome', 'all-hidden')
    await expect(activePdf(page).locator('.pdf-toolbar__page-input')).toHaveValue('4')
    await expect(activePdf(page).locator('.pdf-toolbar__zoom-value')).toHaveText(solvingZoom!)
    await manage(page)
    await overview(page).getByRole('button', { name: '풀이 닫기', exact: true }).click()
    await expect(overview(page).locator('.workspace-window-card')).toHaveCount(1)
    await expect(overview(page).getByRole('button', { name: '읽기 닫기', exact: true })).toBeDisabled()
    expect(existsSync(pdfPath)).toBe(true)
  } finally { await bandal.close() }
})

test('the same note keeps independent font size, edit mode and scroll in each window after restart', async () => {
  test.setTimeout(150_000)
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profile = bandal.profileDir
  try {
    let page = bandal.page
    const note = () => page.locator('.note-tab:visible')
    const setFont = async (size: '125%' | '150%'): Promise<void> => {
      await note().getByRole('button', { name: '더 많은 서식', exact: true }).click()
      await note().getByRole('button', { name: size, exact: true }).click()
      await note().getByRole('button', { name: '더 많은 서식', exact: true }).click()
    }
    const scrollTo = async (selector: string, top: number): Promise<void> => {
      await note().locator(selector).evaluate((element, value) => {
        element.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
        element.scrollTop = value
        element.dispatchEvent(new Event('scroll', { bubbles: true }))
      }, top)
      await expect.poll(() => note().locator(selector).evaluate(element => element.scrollTop)).toBe(top)
    }
    const expectNote = async (mode: 'edit' | 'quiz', font: string, top: number): Promise<void> => {
      await expect(note().locator(mode === 'edit' ? '.ProseMirror' : '.note-quiz-preview')).toBeVisible()
      await expect(note().locator('.note-editor')).toHaveCSS('--note-font-scale', font)
      await expect.poll(() => note().locator(mode === 'edit' ? '.note-editor-scroll' : '.note-quiz-preview__scroll').evaluate(element => element.scrollTop)).toBe(top)
    }
    await createCourse(page, '필기 보기 복원')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'shared.md'), '# Window note\n\n' + Array.from({ length: 70 }, (_, i) => `## Question ${i + 1}\n\nIndependent note position ${i + 1}.\n\n`).join('') + '## 정답\n\nShared answer content.\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="shared.md"]').click()
    await note().getByRole('button', { name: '편집 모드', exact: true }).click()
    await setFont('125%')
    await scrollTo('.note-editor-scroll', 700)
    await manage(page)
    await overview(page).getByRole('button', { name: '윈도우 추가', exact: true }).click()
    await expect(overview(page)).toBeHidden()
    await page.locator('[data-material-path="shared.md"]').click()
    await note().getByRole('button', { name: '편집 모드', exact: true }).click()
    await setFont('150%')
    await note().getByRole('button', { name: '풀이 모드', exact: true }).click()
    await scrollTo('.note-quiz-preview__scroll', 1100)
    await manage(page)
    await overview(page).getByRole('button', { name: '윈도우 1 열기', exact: true }).click()
    await expectNote('edit', '1.25', 700)
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile }); page = bandal.page
    await expectNote('edit', '1.25', 700)
    await manage(page)
    await overview(page).getByRole('button', { name: '윈도우 2 열기', exact: true }).click()
    await expectNote('quiz', '1.5', 1100)
  } finally { await bandal.close() }
})
