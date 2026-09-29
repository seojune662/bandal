import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchBandal, createCourse, type BandalApp } from './helpers/launch'

async function fixture() {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const url = new URL(req.url!, `http://${req.headers.host}`)
      if (url.pathname === '/download') {
        res.writeHead(200, { 'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${url.searchParams.get('name') || 'handout.txt'}"` })
        res.end(`lecture:${req.method}:${body}`)
      } else {
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(`<html><head><title>Browser fixture</title></head><body><h1>Lecture page</h1><script>
          window.result = null;
          addEventListener('message', e => { window.result = e.data });
          window.received = ${JSON.stringify({ method: req.method, body, referer: req.headers.referer ?? '' })};
        </script></body></html>`)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const port = (server.address() as { port: number }).port
  return { origin: `http://127.0.0.1:${port}`, other: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

async function openTab(bandal: BandalApp, url: string) {
  const page = bandal.page
  const button = page.locator('.workspace-add-tab')
  if (await button.isVisible()) await button.click()
  else await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
  await page.getByLabel('새 탭 검색').fill(url)
  await page.getByRole('option', { name: `${url} 열기` }).click()
  await expect.poll(() => bandal.app.evaluate(({ webContents }, target) =>
    webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL() === target)?.id ?? null, url
  )).not.toBeNull()
  const id = await bandal.app.evaluate(({ webContents }, target) =>
    webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL() === target)!.id, url)
  await expect.poll(() => run(bandal, id, 'document.readyState')).toBe('complete')
  return id
}

function run(bandal: BandalApp, id: number, js: string) {
  return bandal.app.evaluate(async ({ webContents }, { id, js }) => webContents.fromId(id)!.executeJavaScript(js, true), { id, js })
}
async function childAt(bandal: BandalApp, url: string) {
  await expect.poll(() => bandal.app.evaluate(({ webContents }, target) =>
    webContents.getAllWebContents().find(w => w.getURL() === target)?.id ?? null, url)).not.toBeNull()
  return bandal.app.evaluate(({ webContents }, target) => webContents.getAllWebContents().find(w => w.getURL() === target)!.id, url)
}

test('cross-site POST, opener messaging and nested authentication keep their native context', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '인증 검증')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, `(() => { const f=document.createElement('form'); f.method='POST'; f.action='${site.other}/auth'; f.target='auth-window'; f.innerHTML='<input name="state" value="keep-me">'; document.body.append(f); f.submit(); })()`)
    const child = await childAt(bandal, `${site.other}/auth`)
    await expect.poll(() => run(bandal, child, 'window.received')).toMatchObject({ method: 'POST', body: 'state=keep-me' })
    expect(await run(bandal, child, 'window.opener !== null')).toBe(true)
    await run(bandal, child, `window.opener.postMessage('authenticated','*')`)
    await expect.poll(() => run(bandal, root, 'window.result')).toBe('authenticated')
    await run(bandal, child, `window.open('${site.origin}/confirm','confirmation'); undefined`)
    const nested = await childAt(bandal, `${site.origin}/confirm`)
    await run(bandal, nested, `window.opener.postMessage('confirmed','*'); window.close()`)
    await expect.poll(() => run(bandal, child, 'window.result')).toBe('confirmed')
    const partitions = await bandal.app.evaluate(({ webContents, session }, ids) => ids.map(id => webContents.fromId(id)!.session === session.fromPartition('persist:browsing')), [root, child])
    expect(partitions).toEqual([true, true])
    await run(bandal, child, 'window.close()')
  } finally { await bandal.close(); await site.close() }
})

test('downloads retain the page, close only empty popups and keep their initiating course', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '다운로드 원본')
    const courseDir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, `location.href='${site.origin}/download?name=same.txt'`)
    await expect.poll(() => existsSync(join(courseDir, 'same.txt'))).toBe(true)
    expect(await run(bandal, root, 'document.querySelector("h1").textContent')).toBe('Lecture page')
    await run(bandal, root, `window.open('${site.origin}/download?name=popup.txt'); undefined`)
    await expect.poll(() => existsSync(join(courseDir, 'popup.txt'))).toBe(true)
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL() === 'about:blank').length)).toBe(0)
    // No-course-switch race: this retained tab must still file in its own course.
    await createCourse(bandal.page, '다른 과목')
    await run(bandal, root, `(() => { const f=document.createElement('form');f.method='POST';f.action='${site.origin}/download?name=post.txt';f.target='_blank';f.innerHTML='<input name="token" value="post-download">';document.body.append(f);f.submit(); })()`)
    await expect.poll(() => existsSync(join(courseDir, 'post.txt'))).toBe(true)
    expect(readFileSync(join(courseDir, 'post.txt'), 'utf8')).toBe('lecture:POST:token=post-download')
    await run(bandal, root, `(() => { const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['blob-bytes']));a.download='blob.txt';a.click(); })()`)
    await expect.poll(() => existsSync(join(courseDir, 'blob.txt'))).toBe(true)
    expect(readFileSync(join(courseDir, 'blob.txt'), 'utf8')).toBe('blob-bytes')
    // Respect the per-second popup burst limit before opening another window.
    await bandal.page.waitForTimeout(1100)
    // A real document is never closed by a download it starts.
    await run(bandal, root, `window.open('${site.origin}/report'); undefined`)
    const report = await childAt(bandal, `${site.origin}/report`)
    await run(bandal, report, `location.href='${site.origin}/download?name=report.txt'`)
    await expect.poll(() => existsSync(join(courseDir, 'report.txt'))).toBe(true)
    expect(await run(bandal, report, 'document.querySelector("h1").textContent')).toBe('Lecture page')
    await run(bandal, report, 'window.close()')
  } finally { await bandal.close(); await site.close() }
})

test('private login windows keep an isolated session and direct downloads show their result', async ({}, testInfo) => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '비공개 검증')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, "document.cookie='normal_session=yes; path=/'")
    // Use the actual toolbar toggle to create the isolated guest.
    await bandal.page.getByRole('button', { name: '시크릿 모드 켜기' }).first().click()
    await expect.poll(() => bandal.app.evaluate(({ webContents, session }) =>
      webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.session === session.fromPartition('bandal-private') && w.getURL().startsWith('http'))?.id ?? null)).not.toBeNull()
    const privateId = await bandal.app.evaluate(({ webContents, session }) =>
      webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.session === session.fromPartition('bandal-private'))!.id)
    expect(await run(bandal, privateId, 'document.cookie')).not.toContain('normal_session')
    await run(bandal, privateId, `window.open('${site.other}/private-auth'); undefined`)
    const child = await childAt(bandal, `${site.other}/private-auth`)
    expect(await bandal.app.evaluate(({ webContents, session }, id) => webContents.fromId(id)!.session === session.fromPartition('bandal-private'), child)).toBe(true)
    await run(bandal, child, 'window.close()')
    // A fresh tab opened directly at an attachment must not stay blank.
    const button = bandal.page.locator('.workspace-add-tab')
    await button.click()
    await bandal.page.getByLabel('새 탭 검색').fill(`${site.origin}/download?name=direct.txt`)
    await bandal.page.getByRole('option', { name: `${site.origin}/download?name=direct.txt 열기` }).click()
    await expect(bandal.page.getByRole('heading', { name: '다운로드 완료' })).toBeVisible()
    await expect(bandal.page.locator('.browser-error').getByRole('button', { name: '폴더 보기', exact: true })).toBeVisible()
    await expect(bandal.page.locator('.browser-error')).toContainText('direct.txt')
    await bandal.page.screenshot({ path: testInfo.outputPath('download-result.png') })
  } finally { await bandal.close(); await site.close() }
})
