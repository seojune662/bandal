import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createCourse, launchBandal } from './helpers/launch'

test('four browser panes retain their pages, route native clicks and restore unfocused pages', async ({}, info) => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=', 'base64')
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/favicon')) {
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(icon); return
    }
    const title = `Pane ${req.url?.slice(1) || 'home'}`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<html><head><title>${title}</title><link rel="icon" href="/favicon.png"></head><body style="margin:0"><input id="draft" style="width:95%;height:100px" placeholder="${title}"><script>window.clicks=0;addEventListener('mousedown',()=>window.clicks++);window.instanceToken=Math.random()</script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const pages = () => bandal.app.evaluate(({ BrowserWindow }, origin) => {
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    return host.contentView.children.flatMap((view: any) => view.webContents?.getURL().startsWith(origin)
      ? [{ id: view.webContents.id as number, url: view.webContents.getURL() as string, visible: view.getVisible() as boolean }] : [])
  }, origin)
  try {
    await createCourse(bandal.page, '4분할 브라우저')
    const courseId = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    for (let index = 0; index < 4; index++) {
      await bandal.app.evaluate(({ BrowserWindow }, url) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url })
      }, `${origin}/${index}`)
      await expect.poll(async () => (await pages()).length).toBe(index + 1)
    }
    const original = await pages()
    await expect.poll(() => bandal.app.evaluate(async ({ webContents }, ids) => Promise.all(ids.map(id =>
      webContents.fromId(id)!.executeJavaScript('document.readyState === "complete" && !!document.querySelector("#draft")')
    )), original.map(page => page.id))).toEqual([true, true, true, true])
    await bandal.app.evaluate(async ({ webContents }, ids) => {
      for (const id of ids) await webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value="unsaved native draft"')
    }, original.map(page => page.id))
    await bandal.page.getByRole('button', { name: '작업 공간 배치', exact: true }).click()
    await bandal.page.getByRole('menuitem', { name: '2×2 4분할', exact: true }).click()
    await expect.poll(async () => (await pages()).filter(page => page.visible).length).toBe(4)
    await expect(bandal.page.locator('.dv-groupview:visible')).toHaveCount(4)
    await expect(bandal.page.locator('.workspace-tab__favicon:visible')).toHaveCount(4)
    expect((await pages()).map(page => page.id).sort()).toEqual(original.map(page => page.id).sort())
    const clicked = original.find(page => page.url === `${origin}/0`)!
    // Deliver a real native mouse click; the test never calls WebContents.focus().
    await bandal.app.evaluate(({ app, BrowserWindow, webContents }, id) => {
      if (process.platform === 'darwin') app.focus({ steal: true })
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.focus()
      const page = webContents.fromId(id)!
      page.sendInputEvent({ type: 'mouseDown', x: 60, y: 45, button: 'left', clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', x: 60, y: 45, button: 'left', clickCount: 1 })
    }, clicked.id)
    await expect.poll(() => bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.clicks'), clicked.id)).toBe(1)
    await expect(bandal.page.locator('.dv-active-group .dv-active-tab')).toContainText('Pane 0')
    await bandal.app.evaluate(({ webContents }, id) => {
      const page = webContents.fromId(id)!
      const modifiers: Array<'meta' | 'control'> = [process.platform === 'darwin' ? 'meta' : 'control']
      page.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers })
    }, clicked.id)
    await expect(bandal.page.getByRole('dialog', { name: '새 탭 열기' })).toBeVisible()
    await bandal.page.getByLabel('새 탭 검색').fill(`${origin}/shortcut`)
    await bandal.page.getByRole('option', { name: `${origin}/shortcut 열기` }).click()
    await expect(bandal.page.locator('.dv-active-group .dv-tab')).toHaveCount(2)
    await expect(bandal.page.locator('.dv-active-group .dv-tab')).toContainText(['Pane 0', 'Pane shortcut'])
    await bandal.page.locator('.dv-active-group .dv-active-tab').click({ button: 'middle' })
    await expect.poll(async () => (await pages()).length).toBe(4)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), clicked.id)).toBe('unsaved native draft')
    await expect.poll(async () => {
      const layout = (await bandal.page.evaluate(courseId => window.bandal.invoke('layout:get', { courseId }), courseId)).layout as { panels?: Record<string, unknown> } | null
      return Object.keys(layout?.panels ?? {}).length
    }).toBe(4)
    await bandal.page.screenshot({ path: info.outputPath('four-native-browser-panes.png') })
    const profile = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile })
    // Three panes are unfocused on startup, but all four must load immediately.
    await expect(bandal.page.locator('.dv-groupview:visible')).toHaveCount(4)
    await expect.poll(async () => (await pages()).filter(page => page.visible).length).toBe(4)
    await expect(bandal.page.locator('.workspace-tab__favicon:visible')).toHaveCount(4)
  } finally {
    await bandal.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('only active native browser views stay within their live panel after resizing and rail changes', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'dark' } })
  const observations: any[] = []
  try {
    await bandal.app.evaluate(({ session }) => {
      session.fromPartition('persist:browsing').protocol.handle('https', request => new Response(`<html><head><title>${new URL(request.url).hostname} placement fixture</title></head><body style="margin:0;background:lightblue"><h1>Native browser placement</h1></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    })
    const { page } = bandal
    await createCourse(page, '브라우저 위치 검사')
    const shortcuts = page.getByRole('region', { name: 'AI 웹 바로가기' })
    for (const name of ['Gemini', 'ChatGPT', 'Claude', 'Gemini']) await shortcuts.getByRole('button', { name, exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return host.contentView.children.filter((view: any) => view.webContents?.getURL().startsWith('https://')).length
    })).toBe(3)
    const record = async (step: string): Promise<void> => {
      let latest: any, previous = ''
      await expect.poll(async () => {
        const dom = await page.evaluate(() => {
          const rect = (element: Element) => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } }
          const anchors = [...document.querySelectorAll('[data-browser-anchor]')].map(element => ({ tabId: element.getAttribute('data-browser-anchor'), bounds: rect(element), visible: !element.closest('[hidden], [inert]') && getComputedStyle(element).visibility === 'visible' }))
          return { workspace: rect(document.querySelector('.workspace-host')!), viewport: { width: innerWidth, height: innerHeight }, anchors }
        })
        const native = await bandal.app.evaluate(({ BrowserWindow }) => {
          const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
          return { contentSize: host.getContentSize(), zoom: host.webContents.getZoomFactor(), views: host.contentView.children.flatMap((view: any) => view.webContents?.getURL().startsWith('https://') ? [{ id: view.webContents.id, url: view.webContents.getURL(), bounds: view.getBounds(), visible: view.getVisible() }] : []) }
        })
        latest = { step, dom, native }
        const key = JSON.stringify(latest), stable = key === previous
        previous = key
        const views = native.views.filter((view: any) => view.visible), anchors = dom.anchors.filter(anchor => anchor.visible)
        if (!stable || views.length !== 1 || anchors.length !== 1) return false
        const anchor = anchors[0]!.bounds, actual = views[0].bounds
        const x = Math.max(0, Math.round(anchor.x * native.zoom)), y = Math.max(0, Math.round(anchor.y * native.zoom))
        const expected = { x, y, width: Math.min(native.contentSize[0]! - x, Math.round(anchor.width * native.zoom)), height: Math.min(native.contentSize[1]! - y, Math.round(anchor.height * native.zoom)) }
        return JSON.stringify(actual) === JSON.stringify(expected) && actual.x + actual.width <= Math.round((dom.workspace.x + dom.workspace.width) * native.zoom) + 1
      }, { intervals: [50, 100, 200], timeout: 15_000, message: `${step}: active native browser must settle within its live panel` }).toBe(true)
      observations.push(latest)
      await page.screenshot({ path: info.outputPath(`browser-${step}-renderer.png`) })
      const capture = await bandal.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.capturePage()).toDataURL())
      writeFileSync(info.outputPath(`browser-${step}-window.png`), Buffer.from(capture.split(',')[1]!, 'base64'))
    }
    await record('wide')
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1024, 640))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1024)
    await record('narrow')
    await page.getByRole('button', { name: '자료 사이드바 접기', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
    await record('right-closed')
    await page.getByRole('button', { name: '자료 사이드바 펼치기', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'open')
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '과목', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-course-rail', 'closed')
    await record('left-closed')
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '과목', exact: true }).click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-course-rail', 'open')
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.setZoomFactor(1.25))
    await record('host-zoom')
    await info.attach('native-browser-geometry', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    for (const { step, dom, native } of observations) {
      const visible = native.views.filter((view: any) => view.visible)
      expect(visible, `${step}: inactive retained pages must not remain visible`).toHaveLength(1)
      const anchors = dom.anchors.filter((anchor: any) => anchor.visible)
      expect(anchors, `${step}: active presentation anchor`).toHaveLength(1)
      const actual = visible[0].bounds, anchor = anchors[0].bounds
      const x = Math.max(0, Math.round(anchor.x * native.zoom)), y = Math.max(0, Math.round(anchor.y * native.zoom))
      const expected = { x, y, width: Math.min(native.contentSize[0] - x, Math.round(anchor.width * native.zoom)), height: Math.min(native.contentSize[1] - y, Math.round(anchor.height * native.zoom)) }
      expect(actual, `${step}: native bounds must follow the live DOM anchor and host zoom`).toEqual(expected)
      expect(actual.x + actual.width, `${step}: native page must not cover the right rail`).toBeLessThanOrEqual(Math.round((dom.workspace.x + dom.workspace.width) * native.zoom) + 1)
    }
  } finally { await bandal.close() }
})
