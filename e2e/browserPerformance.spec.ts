import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'

test('measures browser switching, viewport IPC and memory with a fixed four-page workload', async ({}, info) => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      `<title>Bench ${req.url?.slice(1)}</title><body><input value="retained"><div style="height:3000px">Browser benchmark</div></body>`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
    )
    await createCourse(page, '브라우저 성능')
    for (let index = 0; index < 4; index++) {
      const add = page.locator('.workspace-add-tab')
      if (await add.isVisible()) await add.click()
      else
        await page
          .locator('.workspace-watermark')
          .getByRole('button', { name: '새 탭 열기' })
          .click()
      await page.getByLabel('새 탭 검색').fill(`${origin}/${index}`)
      await page
        .getByRole('option', { name: `${origin}/${index} 열기` })
        .click()
      await expect(
        page.locator('.workspace-tab__title', { hasText: `Bench ${index}` }),
      ).toBeVisible()
    }
    const cdp = await page.context().newCDPSession(page)
    const heapUsage = async (): Promise<number> => {
      await cdp.send('HeapProfiler.collectGarbage')
      return (await cdp.send('Runtime.getHeapUsage')).usedSize
    }
    const beforeHeap = await heapUsage()
    const beforeBounds = await app.evaluate(
      () =>
        (globalThis as any).__bandalPerformance.ipc['browser:pageBounds']
          ?.count ?? 0,
    )
    const timings: number[] = []
    let verifiedSwitches = 0
    for (let index = 0; index < 100; index++) {
      const target = index % 4
      // DOM click() never activates Dockview: selection is on pointerdown.
      // Start the clock at the real pointer event, excluding driver setup.
      await page.evaluate(() => {
        ;(window as any).__browserSwitchSample = new Promise(resolve => {
          document.addEventListener('pointerdown', () => {
            const started = performance.now()
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              elapsed: performance.now() - started,
              title: document.querySelector('.dv-active-tab .workspace-tab__title')?.textContent
            })))
          }, { capture: true, once: true })
        })
      })
      await page.locator('.dv-tab').filter({
        has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^Bench ${target}$`) })
      }).click()
      const sample = await page.evaluate(() => (window as any).__browserSwitchSample)
      expect(sample.title).toBe(`Bench ${target}`)
      // DOM activation alone is insufficient: ensure the requested native page
      // is the only browser view actually displayed before the next sample.
      await expect.poll(() => app.evaluate(({ BrowserWindow }, origin) =>
        BrowserWindow.getAllWindows().flatMap(host => host.contentView.children)
          .filter(view => 'webContents' in view && view.getVisible())
          .map(view => (view as Electron.WebContentsView).webContents.getURL())
          .filter(url => url.startsWith(origin)), origin
      )).toEqual([`${origin}/${target}`])
      verifiedSwitches++
      timings.push(sample.elapsed)
    }
    timings.sort((a, b) => a - b)
    const afterHeap = await heapUsage()
    const native = await app.evaluate(
      ({ app, webContents }, origin) => ({
        pages: webContents
          .getAllWebContents()
          .filter((page) => page.getURL().startsWith(origin)).length,
        bounds:
          (globalThis as any).__bandalPerformance.ipc['browser:pageBounds']
            ?.count ?? 0,
        workingSetKB: app
          .getAppMetrics()
          .reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
      }),
      origin,
    )
    const dragBoundsBefore = native.bounds
    await page.evaluate(() => {
      const samples: number[] = []
      const trace = { started: false, active: false, overEvents: 0, samples }
      ;(window as any).__browserDragSample = trace
      let previous = 0
      const frame = (now: number): void => {
        if (!trace.active) return
        if (previous) samples.push(now - previous)
        previous = now
        requestAnimationFrame(frame)
      }
      document.addEventListener('dragstart', () => {
        trace.started = trace.active = true
        requestAnimationFrame(frame)
      }, { once: true })
      document.addEventListener('dragover', () => { if (trace.active) trace.overEvents++ })
      document.addEventListener('dragend', () => { trace.active = false }, { once: true })
    })
    const source = (await page.locator('.dv-tab').first().boundingBox())!
    const content = (await page.locator('.dv-content-container:visible').first().boundingBox())!
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 3 })
    for (let index = 0; index < 60; index++) {
      await page.mouse.move(
        content.x + (index % 2 === 0 ? 16 : content.width - 16),
        content.y + content.height / 2 + index % 3,
        { steps: 4 }
      )
      // Keep a sustained drag across rendered frames rather than measuring a
      // burst of driver events that Chromium can coalesce into a few frames.
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))))
    }
    await page.keyboard.press('Escape')
    await page.mouse.up()
    const drag = await page.evaluate(() => {
      const trace = (window as any).__browserDragSample
      trace.active = false
      return { started: trace.started, overEvents: trace.overEvents, frames: [...trace.samples].sort((a: number, b: number) => a - b) }
    })
    expect(drag.started).toBe(true)
    expect(drag.overEvents).toBeGreaterThan(20)
    expect(drag.frames.length).toBeGreaterThan(100)
    await expect(page.locator('.dv-groupview')).toHaveCount(1)
    const dragBoundsAfter = await app.evaluate(() =>
      (globalThis as any).__bandalPerformance.ipc['browser:pageBounds']?.count ?? 0)
    const report = {
      verifiedSwitches,
      p95Ms: timings[94],
      maxMs: timings.at(-1),
      heapBeforeMB: beforeHeap / 1048576,
      heapAfterMB: afterHeap / 1048576,
      heapGrowthMB: (afterHeap - beforeHeap) / 1048576,
      boundsIpc: native.bounds - beforeBounds,
      livePages: native.pages,
      dragOverEvents: drag.overEvents,
      dragFrames: drag.frames.length,
      dragFrameP95Ms: drag.frames[Math.ceil(drag.frames.length * 0.95) - 1],
      dragFrameMaxMs: drag.frames.at(-1),
      dragBoundsIpc: dragBoundsAfter - dragBoundsBefore,
      workingSetMB: native.workingSetKB / 1024,
    }
    console.log('Browser performance:', JSON.stringify(report))
    const file =
      process.env.BANDAL_BROWSER_BENCHMARK ??
      info.outputPath('browser-performance.json')
    writeFileSync(file, JSON.stringify(report, null, 2))
    await info.attach('browser-performance', {
      path: file,
      contentType: 'application/json',
    })
    await cdp.detach()
    expect(report.verifiedSwitches).toBe(100)
    expect(report.boundsIpc).toBeGreaterThanOrEqual(100)
    expect(report.p95Ms!).toBeLessThan(150)
    expect(report.heapGrowthMB).toBeLessThan(32)
    expect(report.livePages).toBe(4)
  } finally {
    await bandal.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
