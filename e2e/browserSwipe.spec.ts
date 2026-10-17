import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { launchBandal, createCourse, type BandalApp } from './helpers/launch'

async function fixture() {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<html><head><title>Swipe fixture</title></head><body><h1>Swipe fixture</h1>
      <script>
        window.historyMoves = 0;
        window.trustedWheels = 0;
        addEventListener('popstate', () => window.historyMoves++);
        addEventListener('wheel', event => { if (event.isTrusted) window.trustedWheels++ }, { passive: true });
      </script></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
  const port = (server.address() as { port: number }).port
  return {
    origin: `http://127.0.0.1:${port}`,
    other: `http://localhost:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}

function run(bandal: BandalApp, id: number, script: string) {
  return bandal.app.evaluate(async ({ webContents }, { id, script }) =>
    webContents.fromId(id)!.executeJavaScript(script, true), { id, script })
}

async function openHistory(bandal: BandalApp, origin: string) {
  await createCourse(bandal.page, '두 손가락 탐색')
  const button = bandal.page.locator('.workspace-add-tab')
  if (await button.isVisible()) await button.click()
  else await bandal.page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
  const url = `${origin}/first`
  await bandal.page.getByLabel('새 탭 검색').fill(url)
  await bandal.page.getByRole('option', { name: `브라우저 ${url}` }).click()
  await expect.poll(() => bandal.app.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.getURL() === url)?.id, url)).toBeTruthy()
  const id = await bandal.app.evaluate(({ webContents }, url) =>
    webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.getURL() === url)!.id, url)
  await expect.poll(() => run(bandal, id, 'document.readyState')).toBe('complete')
  // Same-document history retains our counters and catches duplicate moves
  // without instrumenting the app's navigation implementation.
  await run(bandal, id, "history.pushState({}, '', '/second');history.pushState({}, '', '/third')")
  await focusGuest(bandal, id)
  return id
}

async function focusGuest(bandal: BandalApp, id: number) {
  await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }, id) =>
    BrowserWindow.getAllWindows().some(host => host.contentView.children.some(view =>
      'webContents' in view && (view as Electron.WebContentsView).webContents.id === id &&
      view.getVisible() && view.getBounds().width > 200)), id)).toBe(true)
  await bandal.app.evaluate(({ app, BrowserWindow, webContents }, id) => {
    const host = BrowserWindow.getAllWindows().find(host => host.contentView.children.some(view =>
      'webContents' in view && (view as Electron.WebContentsView).webContents.id === id))!
    host.show()
    if (process.platform === 'darwin') app.focus({ steal: true })
    host.focus()
    webContents.fromId(id)!.focus()
    webContents.fromId(id)!.sendInputEvent({ type: 'mouseMove', x: 120, y: 120 })
  }, id)
  await run(bandal, id, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

/**
 * Exercise Chromium's trusted wheel delivery, the isolated frame preload and
 * the real navigation IPC. Electron's input deltas are opposite DOM deltas.
 * This API cannot reproduce a physical trackpad's OS phase/momentum metadata.
 */
async function wheel(bandal: BandalApp, id: number, deltaX: number, options: { deltaY?: number; packets?: number; gap?: number } = {}) {
  for (let index = 0; index < (options.packets ?? 12); index++) {
    await bandal.app.evaluate(({ webContents }, input) => webContents.fromId(input.id)!.sendInputEvent({
      type: 'mouseWheel', x: 120, y: 120,
      deltaX: input.deltaX, deltaY: input.deltaY,
      hasPreciseScrollingDeltas: true, canScroll: true
    }), { id, deltaX, deltaY: options.deltaY ?? 0 })
    await bandal.page.waitForTimeout(options.gap ?? 20)
  }
}

// sendInputEvent dispatches to the main RenderWidget and can make an iframe
// test pass using the parent's handler. CDP hit-tests the actual child frame.
function frameWheel(bandal: BandalApp, id: number, deltaX: number) {
  return bandal.app.evaluate(async ({ webContents }, { id, deltaX }) => {
    const wc = webContents.fromId(id)!
    const owned = !wc.debugger.isAttached()
    if (owned) wc.debugger.attach('1.3')
    try {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 120 })
      for (let index = 0; index < 12; index++) {
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 120, y: 120, deltaX: -deltaX, deltaY: 0 })
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    } finally { if (owned && wc.debugger.isAttached()) wc.debugger.detach() }
  }, { id, deltaX })
}

function runFrame(bandal: BandalApp, id: number, frameUrl: string, script: string) {
  return bandal.app.evaluate(async ({ webContents }, { id, frameUrl, script }) => {
    const frame = webContents.fromId(id)!.mainFrame.framesInSubtree.find(frame => frame.url === frameUrl)
    return frame ? frame.executeJavaScript(script) : null
  }, { id, frameUrl, script })
}

async function settlesAt(bandal: BandalApp, id: number, path: string, moves: number) {
  await expect.poll(() => run(bandal, id, '({ path: location.pathname, moves: window.historyMoves })'), { intervals: [20] })
    .toEqual({ path, moves })
}

test('trackpad back and forward work consecutively and a long stroke moves only once', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    await wheel(bandal, id, 22, { packets: 45 })
    await settlesAt(bandal, id, '/second', 1)
    expect(await run(bandal, id, 'window.trustedWheels')).toBeGreaterThan(0)
    // A deliberate second stroke must work without the old 650ms blind spot.
    await bandal.page.waitForTimeout(80)
    await wheel(bandal, id, -22)
    await settlesAt(bandal, id, '/third', 2)
    await bandal.page.waitForTimeout(80)
    await wheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 3)
    await bandal.page.waitForTimeout(750)
    await settlesAt(bandal, id, '/second', 3)
  } finally { await bandal.close(); await site.close() }
})

test('a newly loaded document can immediately reverse a completed history swipe', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    await run(bandal, id, `location.href='${site.origin}/fourth'`)
    await expect.poll(() => run(bandal, id, 'location.pathname')).toBe('/fourth')
    await expect.poll(() => run(bandal, id, 'document.readyState')).toBe('complete')
    await focusGuest(bandal, id)
    await wheel(bandal, id, 22)
    await expect.poll(() => run(bandal, id, 'location.pathname'), { intervals: [20] }).toBe('/third')
    await expect.poll(() => run(bandal, id, 'document.readyState')).toBe('complete')
    await bandal.page.waitForTimeout(80)
    await wheel(bandal, id, -22)
    await expect.poll(() => run(bandal, id, 'location.pathname'), { intervals: [20] }).toBe('/fourth')
    await bandal.page.waitForTimeout(750)
    expect(await run(bandal, id, 'location.pathname')).toBe('/fourth')
  } finally { await bandal.close(); await site.close() }
})

test('hiding a native browser view cancels its pending swipe before history can change', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    const setVisible = (visible: boolean) => bandal.app.evaluate(({ BrowserWindow }, { id, visible }) => {
      const view = BrowserWindow.getAllWindows().flatMap(host => host.contentView.children).find(view =>
        'webContents' in view && (view as Electron.WebContentsView).webContents.id === id)!
      view.setVisible(visible)
    }, { id, visible })
    await wheel(bandal, id, 22)
    // Enough input to navigate, but the end-of-stroke timer has not fired yet.
    await setVisible(false)
    await bandal.page.waitForTimeout(300)
    await settlesAt(bandal, id, '/third', 0)
    await setVisible(true)
    await focusGuest(bandal, id)
    await wheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 1)
  } finally { await bandal.close(); await site.close() }
})

test('document scrolling owns the whole stroke and a new stroke at its edge can navigate', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    // Normal documents commonly overflow with overflow-x:visible; checking
    // only explicitly scrollable ancestors mistakes these for history swipes.
    await run(bandal, id, "document.body.style.minWidth='3000px';document.scrollingElement.scrollLeft=120")
    expect(await run(bandal, id, 'document.scrollingElement.scrollLeft')).toBe(120)
    await wheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    expect(await run(bandal, id, 'document.scrollingElement.scrollLeft')).toBe(0)
    await settlesAt(bandal, id, '/third', 0)
    await wheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 1)
  } finally { await bandal.close(); await site.close() }
})

test('gesture settings update live while page scrolling and untrusted wheels never navigate', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    await bandal.page.evaluate(() => window.bandal.invoke('settings:set', { browser: { swipeNavigation: false } }))
    await wheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    await settlesAt(bandal, id, '/third', 0)
    await bandal.page.evaluate(() => window.bandal.invoke('settings:set', { browser: { swipeNavigation: true } }))
    await wheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 1)
    await bandal.page.waitForTimeout(300)

    await wheel(bandal, id, -22, { deltaY: -35 })
    await bandal.page.waitForTimeout(300)
    await settlesAt(bandal, id, '/second', 1)

    await run(bandal, id, "document.body.innerHTML='<div style=\"position:fixed;inset:0;overflow:auto;overscroll-behavior-x:contain\"><div style=\"width:3000px;height:500px\">Contained content</div></div>'")
    await wheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    await settlesAt(bandal, id, '/second', 1)

    // Custom carousels often consume wheel input without CSS scroll overflow.
    await run(bandal, id, `document.body.innerHTML='<div id="carousel" style="position:fixed;inset:0;overflow:hidden">Custom carousel</div>';
      window.carouselWheels=0;
      document.getElementById('carousel').addEventListener('wheel', event => {event.preventDefault();window.carouselWheels++}, {passive:false})`)
    await wheel(bandal, id, -22)
    await bandal.page.waitForTimeout(300)
    expect(await run(bandal, id, 'window.carouselWheels')).toBeGreaterThan(0)
    await settlesAt(bandal, id, '/second', 1)

    await run(bandal, id, "document.body.innerHTML='<h1>Plain page</h1>';for(let i=0;i<20;i++)document.body.dispatchEvent(new WheelEvent('wheel',{deltaX:30,bubbles:true,cancelable:true}))")
    await bandal.page.waitForTimeout(300)
    await settlesAt(bandal, id, '/second', 1)
    await wheel(bandal, id, -22)
    await settlesAt(bandal, id, '/third', 2)
  } finally { await bandal.close(); await site.close() }
})

test('cross-origin iframe scrolling and history use the same trusted gesture path', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    const frameUrl = `${site.other}/frame`
    await run(bandal, id, `document.body.innerHTML='<iframe src="${frameUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>'`)
    const frameRun = (script: string) => runFrame(bandal, id, frameUrl, script)
    await expect.poll(() => frameRun('document.readyState')).toBe('complete')
    const pageGlobals = '({ require: typeof require, process: typeof process, ipcRenderer: typeof ipcRenderer, bandal: typeof window.bandal })'
    const isolated = { require: 'undefined', process: 'undefined', ipcRenderer: 'undefined', bandal: 'undefined' }
    expect(await run(bandal, id, pageGlobals)).toEqual(isolated)
    expect(await frameRun(pageGlobals)).toEqual(isolated)
    expect(await bandal.app.evaluate(({ webContents }, id) => {
      const wc = webContents.fromId(id)! as Electron.WebContents & { getLastWebPreferences: () => Electron.WebPreferences }
      return wc.getLastWebPreferences()
    }, id)).toMatchObject({ nodeIntegration: false, nodeIntegrationInSubFrames: true, contextIsolation: true, sandbox: true })
    // Process metrics expose Chromium's actual sandbox on macOS and Windows,
    // in addition to checking the requested preferences and main-world globals.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      await expect.poll(() => bandal.app.evaluate(({ app, webContents }, { id, frameUrl }) => {
        const wc = webContents.fromId(id)!
        const frame = wc.mainFrame.frames.find(frame => frame.url === frameUrl)!
        const metrics = app.getAppMetrics()
        return [wc.mainFrame.osProcessId, frame.osProcessId].map(pid => metrics.find(metric => metric.pid === pid)?.sandboxed)
      }, { id, frameUrl })).toEqual([true, true])
    }
    await frameRun("document.body.innerHTML='<div id=\"scroll\" style=\"position:fixed;inset:0;overflow:auto\"><div style=\"width:3000px;height:100px\">Wide frame</div></div>';document.getElementById('scroll').scrollLeft=120")
    // OOPIF loading and its native hit-test region commit independently of
    // the parent document. Wait for the frame's own compositor preparation.
    await frameRun('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await focusGuest(bandal, id)
    await frameWheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    expect(await frameRun('window.trustedWheels')).toBeGreaterThan(0)
    expect(await frameRun("document.getElementById('scroll').scrollLeft")).toBe(0)
    await settlesAt(bandal, id, '/third', 0)
    await frameWheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 1)
    // Remove the inner scroll container so a forward stroke owns the frame.
    await frameRun("document.body.innerHTML='<h1>Frame history</h1>'")
    await bandal.page.waitForTimeout(80)
    await frameWheel(bandal, id, -22)
    await settlesAt(bandal, id, '/third', 2)
  } finally { await bandal.close(); await site.close() }
})

for (const { nested, initialScroll } of [
  { nested: false, initialScroll: 120 },
  { nested: true, initialScroll: 120 },
  // The first packet can exhaust a parent's remaining scroll distance before
  // an asynchronous policy reply arrives. It still owns this entire stroke.
  { nested: false, initialScroll: 10 }
]) test(`${nested ? 'nested' : 'direct'} cross-origin iframe respects ancestor scrolling and overscroll containment (${initialScroll}px from edge)`, async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    const id = await openHistory(bandal, site.origin)
    const outerUrl = `${site.other}/outer-frame`
    const leafUrl = nested ? `${site.origin}/nested-frame` : outerUrl
    await run(bandal, id, `document.body.innerHTML='<div id="ancestor" style="position:fixed;inset:0;overflow:auto"><div style="width:3000px;height:100%"><iframe src="${outerUrl}" style="width:800px;height:100%;border:0"></iframe></div></div>';document.getElementById('ancestor').scrollLeft=${initialScroll}`)
    await expect.poll(() => runFrame(bandal, id, outerUrl, 'document.readyState')).toBe('complete')
    if (nested) {
      await runFrame(bandal, id, outerUrl, `document.body.innerHTML='<iframe src="${leafUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>'`)
      await expect.poll(() => runFrame(bandal, id, leafUrl, 'document.readyState')).toBe('complete')
    }
    await runFrame(bandal, id, leafUrl, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await focusGuest(bandal, id)
    await frameWheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    expect(await runFrame(bandal, id, leafUrl, 'window.trustedWheels')).toBeGreaterThan(0)
    expect(await run(bandal, id, "({ scroll: document.getElementById('ancestor').scrollLeft, path: location.pathname, moves: window.historyMoves })"))
      .toEqual({ scroll: 0, path: '/third', moves: 0 })

    // The same child can navigate on a separate stroke after the ancestor
    // reaches its edge, including across both cross-origin boundaries.
    await frameWheel(bandal, id, 22)
    await settlesAt(bandal, id, '/second', 1)
    await bandal.page.waitForTimeout(80)
    await run(bandal, id, "document.getElementById('ancestor').style.overscrollBehaviorX='contain'")
    const wheelsBefore = await runFrame(bandal, id, leafUrl, 'window.trustedWheels')
    await frameWheel(bandal, id, 22)
    await bandal.page.waitForTimeout(300)
    expect(await runFrame(bandal, id, leafUrl, 'window.trustedWheels')).toBeGreaterThan(wheelsBefore)
    await settlesAt(bandal, id, '/second', 1)
  } finally { await bandal.close(); await site.close() }
})
