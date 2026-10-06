import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'

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
