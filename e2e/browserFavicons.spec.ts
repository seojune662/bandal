import { expect, test } from '@playwright/test'
import { createServer, type RequestListener } from 'node:http'
import { createCourse, launchBandal } from './helpers/launch'

test('browser tabs render fallback, inline and generic-MIME favicons as safe raster images', async ({}, info) => {
  const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=', 'base64')
  const dataUrl = `data:image/png;base64,${icon.toString('base64')}`
  const serve = (defaultIcon: boolean): RequestListener => (req, res) => {
    const path = req.url ?? '/'
    if (path === '/favicon.ico' && !defaultIcon) {
      res.writeHead(404); res.end(); return
    }
    if (path === '/icon.png' || path === '/favicon.ico') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(icon); return
    }
    if (path === '/icon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>'); return
    }
    const name = path.slice(1)
    const links = name === 'Inline' ? `<link rel="icon" href="${dataUrl}">`
      : name === 'Candidates' ? '<link rel="icon" href="/icon.png"><link rel="icon" type="image/svg+xml" href="/icon.svg">'
        : name === 'Generic' ? '<link rel="icon" href="/icon.png">' : ''
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<html><head><title>${name}</title>${links}</head><body>${name}</body></html>`)
  }
  const server = createServer(serve(false))
  const defaultServer = createServer(serve(true))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  await new Promise<void>(resolve => defaultServer.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const defaultOrigin = `http://127.0.0.1:${(defaultServer.address() as { port: number }).port}`
  const bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '사이트 아이콘')
    for (const name of ['Candidates', 'Inline', 'Generic', 'Default']) {
      await bandal.app.evaluate(({ BrowserWindow }, url) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url })
      }, `${name === 'Default' ? defaultOrigin : origin}/${name}`)
      const tab = bandal.page.getByRole('tab', { name, exact: true })
      await expect(tab).toBeVisible()
      const image = tab.locator('img.workspace-tab__favicon')
      await expect(image).toHaveAttribute('src', dataUrl)
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    }
    await bandal.page.mouse.move(2, 2)
    await expect(bandal.page.locator('.workspace-tab__favicon')).toHaveCount(4)
    await bandal.page.screenshot({ path: info.outputPath('browser-tab-favicons.png') })
  } finally {
    await bandal.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => defaultServer.close(() => resolve()))
  }
})
