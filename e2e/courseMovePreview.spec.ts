import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'

test('course hover keeps one live preview, cancel restores the source, and a favorite copy stays in its destination', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  const records: unknown[] = []
  try {
    const { app, page } = bandal
    await app.evaluate(({ session }) => {
      session.fromPartition('persist:browsing').protocol.handle('https', request => new Response(
        `<title>${new URL(request.url).hostname.includes('gemini') ? 'Gemini fixture' : 'ChatGPT fixture'}</title><style>body{background:#edf4ff;font:24px sans-serif;padding:50px}input{font:inherit}</style><h1>Live browser fixture</h1><input value="unsaved draft">`,
        { headers: { 'content-type': 'text/html' } }
      ))
    })
    await createCourse(page, 'Source'); await createCourse(page, 'Target')
    const courses = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const source = courses.find(course => course.name === 'Source')!, target = courses.find(course => course.name === 'Target')!
    const folder = (name: string) => page.locator('.course-row').filter({ has: page.locator('.course-row__name', { hasText: new RegExp(`^${name}$`) }) })
    const open = async (courseId: string, url: string) => {
      await app.evaluate(({ BrowserWindow }, input) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', input), { courseId, url })
      await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
    }
    await open(target.id, 'https://gemini.google.com/app/target')
    await folder('Source').locator('.course-row__select').click()
    await open(source.id, 'https://chatgpt.com/moving')
    await open(source.id, 'https://gemini.google.com/app/source')
    const record = async (stage: string) => {
      const dom = await page.evaluate(() => {
        const rect = (element: Element | null) => { if (!element) return null; const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, visible: !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' } }
        return {
          dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging'),
          selected: document.querySelector('.course-row[data-selected="true"]')?.textContent,
          groups: [...document.querySelectorAll('.workspace-course:not([hidden]) .dv-groupview')].map(element => ({
            group: rect(element), content: rect(element.querySelector(':scope > .dv-content-container')),
            anyContent: rect(element.querySelector('.dv-content-container')), header: rect(element.querySelector('.dv-tabs-and-actions-container'))
          })),
          slots: [...document.querySelectorAll('.workspace-course:not([hidden]) [data-panel-slot]')].map(rect),
          previews: [...document.querySelectorAll('.course-tab-move-preview, .dv-drop-target-anchor, .dv-drop-target-selection')].map(element => ({ class: element.className, rect: rect(element) })),
          browser: [...document.querySelectorAll('[data-browser-anchor]')].map(rect)
        }
      })
      const native = await app.evaluate(({ BrowserWindow }) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        return host.contentView.children.flatMap((view: any) => view.webContents ? [{ url: view.webContents.getURL(), visible: view.getVisible(), bounds: view.getBounds() }] : [])
      })
      records.push({ stage, dom, native })
      await page.screenshot({ path: info.outputPath(`${stage}-renderer.png`) })
      const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.capturePage()).toDataURL())
      writeFileSync(info.outputPath(`${stage}-window.png`), Buffer.from(capture.split(',')[1]!, 'base64'))
    }
    await record('before')
    const tab = page.locator('.workspace-course:not([hidden]) .dv-tab').filter({ hasText: 'ChatGPT fixture' })
    const bounds = (await tab.boundingBox())!, workspace = (await page.locator('.workspace-host').boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2, { steps: 4 })
    await page.mouse.move(workspace.x + workspace.width - 8, workspace.y + workspace.height / 2, { steps: 15 })
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-tab-dragging', 'true')
    await record('source-edge')
    const destination = (await folder('Target').boundingBox())!
    await page.mouse.move(destination.x + 80, destination.y + destination.height / 2, { steps: 15 })
    await expect(folder('Target')).toHaveAttribute('data-selected', 'true')
    await record('folder-switched')
    await expect(page.locator('.dv-drop-target-anchor:visible, .dv-drop-target-selection:visible')).toHaveCount(0)
    await expect.poll(() => page.locator('.browser-guest:visible .browser-native-anchor').evaluate(element => getComputedStyle(element).backgroundImage)).toContain('data:image/png')
    expect(await app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return host.contentView.children.filter((view: any) => view.webContents).every((view: any) => !view.getVisible())
    })).toBe(true)
    await page.mouse.move(workspace.x + workspace.width / 2, workspace.y + workspace.height / 2, { steps: 15 })
    await expect(page.locator('.course-tab-move-preview')).toBeVisible()
    await record('destination-center')
    await expect(page.locator('.dv-drop-target-anchor:visible, .dv-drop-target-selection:visible')).toHaveCount(0)
    expect(await page.locator('.course-tab-move-preview').evaluate(element => {
      const guide = element.getBoundingClientRect(), content = document.querySelector('.workspace-course:not([hidden]) .dv-content-container')!.getBoundingClientRect()
      return Math.abs(guide.top - content.top) < 1 && Math.abs(guide.height - content.height) < 1 && getComputedStyle(element).borderTopWidth === '1px'
    })).toBe(true)
    await page.mouse.move(workspace.x + workspace.width - 8, workspace.y + workspace.height / 2, { steps: 15 })
    await record('destination-edge')
    await page.keyboard.press('Escape'); await page.mouse.up()
    await expect(folder('Source')).toHaveAttribute('data-selected', 'true')
    await expect(page.locator('.course-tab-move-preview')).toHaveCount(0)
    await record('cancel')
    await page.evaluate(() => {
      ;(window as any).__repeatDrag = []
      for (const type of ['dragstart', 'dragend', 'dragover', 'blur', 'mouseup']) window.addEventListener(type, event => {
        const trace = (window as any).__repeatDrag
        if (trace.length >= 40) return
        trace.push({ type, target: (event.target as Element)?.className, x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY, types: [...((event as DragEvent).dataTransfer?.types ?? [])], dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging') })
      }, true)
    })
    const copyTab = (await tab.boundingBox())!, targetFolder = (await folder('Target').boundingBox())!
    await page.mouse.move(copyTab.x + copyTab.width / 2, copyTab.y + copyTab.height / 2)
    await page.mouse.down()
    await page.mouse.move(copyTab.x + copyTab.width / 2 + 12, copyTab.y + copyTab.height / 2, { steps: 4 })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    // Let native page suppression commit before crossing its viewport, as in
    // the shared real folder-drag helper; CDP otherwise traverses it in 1ms.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return host.contentView.children.filter((view: any) => view.webContents).every((view: any) => !view.getVisible())
    })).toBe(true)
    await page.mouse.move(targetFolder.x + 80, targetFolder.y + targetFolder.height / 2, { steps: 15 })
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.mouse.move(targetFolder.x + 80 + i % 2, targetFolder.y + targetFolder.height / 2)
    }
    try { await expect(folder('Target')).toHaveAttribute('data-selected', 'true') }
    catch (error) { await record('repeat-failed'); throw new Error(`${String(error)}\n${JSON.stringify(await page.evaluate(() => (window as any).__repeatDrag))}`) }
    const favorites = page.locator('li').filter({ has: page.locator('.course-row[data-selected="true"] .course-row__name', { hasText: /^Target$/ }) }).getByRole('region', { name: '즐겨찾기' })
    const favoriteBounds = (await favorites.boundingBox())!
    await page.mouse.move(favoriteBounds.x + favoriteBounds.width / 2, favoriteBounds.y + favoriteBounds.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(favorites.locator('.favorite-row')).toHaveCount(1)
    await expect(folder('Target')).toHaveAttribute('data-selected', 'true')
    expect(await page.evaluate(async ({ sourceId, targetId }) => {
      const [source, target] = await Promise.all([window.bandal.invoke('layout:get', { courseId: sourceId }), window.bandal.invoke('layout:get', { courseId: targetId })])
      return [Object.keys((source.layout as any)?.panels ?? {}).length, Object.keys((target.layout as any)?.panels ?? {}).length]
    }, { sourceId: source.id, targetId: target.id })).toEqual([2, 1])
    await record('favorite-copy')
  } finally {
    writeFileSync(info.outputPath('geometry.json'), JSON.stringify(records, null, 2))
    await bandal.close()
  }
})
