import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const HOVER_FIXTURE = `<!doctype html><html><head><title>Pointer compatibility</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  #home { position: absolute; left: 8px; top: 8px; width: 36px; height: 36px; background: white; app-region: no-drag; }
  #home:hover { background: rgb(0, 128, 0); }
  #page-header { position: fixed; inset: 0 0 auto; height: 52px; z-index: 10; pointer-events: none; -webkit-app-region: drag; }
  #page-header::before { content: ''; position: absolute; inset: 0; app-region: drag !important; }
  #sidebar { position: absolute; top: 60px; left: 12px; width: 220px; height: 200px; display: none; }
  #sidebar.open { display: block; }
  iframe { position: absolute; left: 80px; top: 300px; width: 300px; height: 200px; border: 0; }
</style></head><body><button id="home" aria-label="Home">Home</button>
<header id="page-header"></header>
<aside id="sidebar">Sidebar opened by pointer hover</aside>
<iframe src="/frame" title="Embedded pointer controls"></iframe>
<script>
  window.pointerEvents = [];
  window.hoverOpens = [];
  const home = document.querySelector('#home');
  const sidebar = document.querySelector('#sidebar');
  let timer;
  for (const type of ['pointerenter', 'mouseenter', 'pointermove', 'mousemove', 'mousedown', 'click']) {
    home.addEventListener(type, event => window.pointerEvents.push({
      type, trusted: event.isTrusted, pointerType: event.pointerType ?? null
    }));
  }
  home.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') timer = setTimeout(() => {
      sidebar.classList.add('open');
      window.hoverOpens.push({
        display: getComputedStyle(sidebar).display,
        background: getComputedStyle(home).backgroundColor
      });
    }, 100);
  });
  home.addEventListener('pointerleave', () => {
    clearTimeout(timer);
    sidebar.classList.remove('open');
  });
  home.addEventListener('click', () => sidebar.classList.toggle('open'));
</script></body></html>`

function read(bandal: BandalApp, id: number, source: string) {
  return bandal.app.evaluate(({ webContents }, { id, source }) =>
    webContents.fromId(id)!.executeJavaScript(source), { id, source })
}

async function move(bandal: BandalApp, id: number, x: number, y: number) {
  // Target the native guest, not Playwright's app-shell page.mouse, which
  // sends to a different WebContents even where a native guest is visible.
  await bandal.app.evaluate(({ app, BrowserWindow, webContents }, point) => {
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    if (process.platform === 'darwin') app.focus({ steal: true })
    host.focus()
    webContents.fromId(point.id)!.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  }, { id, x, y })
}

async function expectNoWindowDrag(bandal: BandalApp, id: number) {
  // sendInputEvent bypasses Cocoa/Windows native hit-testing. Verify the
  // effective style separately: Blink only omits rectangles whose value is
  // the initial "none"; even pointer-events:none headers otherwise drag.
  await expect.poll(() => read(bandal, id, `({
    header: getComputedStyle(document.querySelector('#page-header')).getPropertyValue('app-region'),
    pseudo: getComputedStyle(document.querySelector('#page-header'), '::before').getPropertyValue('app-region'),
    home: getComputedStyle(document.querySelector('#home')).getPropertyValue('app-region')
  })`)).toEqual({ header: 'none', pseudo: 'none', home: 'none' })
}

function nativeVisible(bandal: BandalApp, id: number) {
  return bandal.app.evaluate(({ BrowserWindow }, id) => {
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    return host.contentView.children.some((view: any) => view.webContents?.id === id && view.getVisible())
  }, id)
}

test('native pages suppress website window drag and preserve trusted hover through chrome, navigation and child tabs', async ({}, info) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(req.url === '/frame'
      ? HOVER_FIXTURE.replace('<iframe src="/frame" title="Embedded pointer controls"></iframe>', '')
      : HOVER_FIXTURE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '브라우저 포인터')
    await bandal.app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        .webContents.send('browser:open-url', { url })
    }, origin)
    let id = 0
    await expect.poll(async () => {
      id = await bandal.app.evaluate(({ webContents }, url) =>
        webContents.getAllWebContents().find(contents => contents.getURL() === `${url}/`)?.id ?? 0, origin)
      return id
    }).not.toBe(0)
    await expect.poll(() => read(bandal, id, 'document.readyState')).toBe('complete')
    await expectNoWindowDrag(bandal, id)
    const observations: unknown[] = []
    const expectHover = async (pageId = id) => {
      await expect.poll(() => nativeVisible(bandal, pageId)).toBe(true)
      await move(bandal, pageId, 300, 150)
      await expect.poll(() => read(bandal, pageId, 'getComputedStyle(document.querySelector("#sidebar")).display')).toBe('none')
      await read(bandal, pageId, 'window.pointerEvents = []; window.hoverOpens = []')
      // Native view restoration/resizing can resynchronize the physical OS
      // cursor, and a person may move it while this test runs. Keep sending
      // native moves and assert that the delayed hover actually opened, with
      // its CSS state captured then, even if the real pointer later leaves.
      await expect.poll(async () => {
        await move(bandal, pageId, 32, 32)
        return read(bandal, pageId, 'window.hoverOpens')
      }).toContainEqual({ display: 'block', background: 'rgb(0, 128, 0)' })
      const events = await read(bandal, pageId, 'window.pointerEvents')
      expect(events).toEqual(expect.arrayContaining([
        { type: 'pointerenter', trusted: true, pointerType: 'mouse' },
        { type: 'mouseenter', trusted: true, pointerType: null },
        { type: 'pointermove', trusted: true, pointerType: 'mouse' },
        { type: 'mousemove', trusted: true, pointerType: null }
      ]))
      expect(events.some((event: { type: string }) => ['mousedown', 'click'].includes(event.type))).toBe(false)
      observations.push(await read(bandal, pageId, `({
        width: innerWidth, height: innerHeight,
        hover: matchMedia('(hover: hover)').matches,
        fine: matchMedia('(pointer: fine)').matches, events: window.pointerEvents, opens: window.hoverOpens
      })`))
    }
    await expectHover()

    // Site hydration and later UI updates must not restore native drag,
    // including inline !important, the prefixed alias and new elements.
    await read(bandal, id, `
      document.querySelector('#page-header').style.setProperty('app-region', 'drag', 'important');
      document.querySelector('#home').style.setProperty('-webkit-app-region', 'drag', 'important');
      const late = document.createElement('div');
      late.id = 'late-drag';
      late.style.setProperty('app-region', 'drag', 'important');
      document.body.append(late);
      void 0;
    `)
    await expectNoWindowDrag(bandal, id)
    expect(await read(bandal, id,
      'getComputedStyle(document.querySelector("#late-drag")).getPropertyValue("app-region")'
    )).toBe('none')
    await expectHover()

    // Address suggestions temporarily cover and hide the native surface.
    // Closing them must return a live page, not an inert preview.
    const address = bandal.page.getByRole('combobox', { name: '주소 또는 검색어' })
    await address.click()
    await address.fill('pointer')
    await expect(bandal.page.getByRole('listbox', { name: '주소 및 검색 제안' })).toBeVisible()
    await expect.poll(() => nativeVisible(bandal, id)).toBe(false)
    await address.press('Escape')
    await expect(bandal.page.getByRole('listbox', { name: '주소 및 검색 제안' })).toBeHidden()
    await expectHover()

    // A tooltip over the page temporarily uses a still preview. Crossing
    // from browser chrome into that preview must restore the native guest.
    await bandal.page.getByRole('button', { name: '새로고침', exact: true }).hover()
    await expect(bandal.page.locator('[role="tooltip"]').filter({ hasText: '새로고침' })).toBeVisible()
    await expect.poll(() => nativeVisible(bandal, id)).toBe(false)
    const anchor = await bandal.page.locator('.browser-native-anchor:visible').boundingBox()
    expect(anchor).not.toBeNull()
    await bandal.page.mouse.move(anchor!.x + 32, anchor!.y + 32)
    await expect(bandal.page.locator('[role="tooltip"]')).toHaveCount(0)
    await expect.poll(() => nativeVisible(bandal, id)).toBe(true)
    await expectHover()

    // Retain the same page through a wider and a narrower responsive viewport.
    for (const width of [1560, 1024]) {
      await bandal.app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
          .setSize(width, 800)
      }, width)
      await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.getSize()[0] === width,
      width)).toBe(true)
      await expect.poll(async () => {
        const anchor = await bandal.page.locator('.browser-native-anchor:visible').boundingBox()
        const bounds = await bandal.app.evaluate(({ BrowserWindow }, id) => {
          const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
          return host.contentView.children.find((view: any) => view.webContents?.id === id)?.getBounds()
        }, id)
        return anchor !== null && bounds !== undefined &&
          bounds.width === Math.round(anchor.width) && bounds.height === Math.round(anchor.height)
      }).toBe(true)
      await expectHover()
    }

    // Chromium must route hover through an embedded page too.
    await expect.poll(async () => {
      await move(bandal, id, 112, 332)
      return read(bandal, id, 'document.querySelector("iframe").contentWindow.hoverOpens')
    }).toContainEqual({ display: 'block', background: 'rgb(0, 128, 0)' })
    expect(await read(bandal, id,
      'document.querySelector("iframe").contentWindow.pointerEvents.some(event => event.type === "pointerenter" && event.trusted && event.pointerType === "mouse")'
    )).toBe(true)

    // A new document discards inserted CSS. The common policy must run for
    // subsequent navigations, reloads and Chromium-created child tabs too.
    await bandal.app.evaluate(({ webContents }, { id, url }) =>
      webContents.fromId(id)!.loadURL(url), { id, url: `${origin}/next` })
    await expectNoWindowDrag(bandal, id)
    await expectHover()
    await bandal.app.evaluate(({ webContents }, id) => new Promise<void>(resolve => {
      const page = webContents.fromId(id)!
      page.once('did-finish-load', resolve)
      page.reload()
    }), id)
    await expectNoWindowDrag(bandal, id)
    await expectHover()

    const childUrl = `${origin}/child`
    await read(bandal, id, `window.open(${JSON.stringify(childUrl)}); void 0`)
    let child = 0
    await expect.poll(async () => {
      child = await bandal.app.evaluate(({ webContents }, url) =>
        webContents.getAllWebContents().find(contents => contents.getURL() === url)?.id ?? 0, childUrl)
      return child
    }).not.toBe(0)
    await expect.poll(() => read(bandal, child, 'document.readyState')).toBe('complete')
    await expectNoWindowDrag(bandal, child)
    await expectHover(child)
    expect(await read(bandal, child, 'window.opener !== null')).toBe(true)
    await info.attach('native-pointer-observations', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
  } finally {
    await bandal.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
