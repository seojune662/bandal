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
        if (url.pathname === '/unavailable') res.statusCode = 503
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
    webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.getURL() === target)?.id ?? null, url
  )).not.toBeNull()
  const id = await bandal.app.evaluate(({ webContents }, target) =>
    webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.getURL() === target)!.id, url)
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
    // Assert the authenticated WebContents is the visible tab, not an orphan
    // Chromium page behind a different empty view.
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }, id) => {
      const host = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!
      return host.contentView.children.some(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id && v.getVisible())
    }, child)).toBe(true)
    expect(await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
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
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!.contentView.children.length)).toBe(1)
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
      webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.session === session.fromPartition('bandal-private') && w.getURL().startsWith('http'))?.id ?? null)).not.toBeNull()
    const privateId = await bandal.app.evaluate(({ webContents, session }) =>
      webContents.getAllWebContents().find(w => w.getType() !== 'webview' && w.session === session.fromPartition('bandal-private'))!.id)
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


test('HTTP failures remain readable in a normal tab and diagnostics omit auth query strings', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '서버 응답')
    const root = await openTab(bandal, `${site.origin}/unavailable?token=not-for-diagnostics`)
    await expect(bandal.page.getByRole('status').filter({ hasText: 'HTTP 503' })).toBeVisible()
    expect(await run(bandal, root, 'document.querySelector("h1").textContent')).toBe('Lecture page')
    await bandal.page.getByRole('button', { name: '진단 보기', exact: true }).click()
    const dialog = bandal.page.getByRole('dialog', { name: '페이지 진단' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('HTTP 503')
    await expect(dialog).not.toContainText('not-for-diagnostics')
    // Shell menus/dialogs must actually be above the native page.
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!.contentView.children.filter(v => v.getVisible()).length)).toBe(0)
    await expect(bandal.page.locator('.browser-native-anchor')).toHaveCSS('background-image', /data:image/)
  } finally { await bandal.close(); await site.close() }
})

test('middle-click opens a loaded background tab without replacing the visible page', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '백그라운드 탭')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, `document.body.insertAdjacentHTML('afterbegin', '<a style="display:block;height:40px" href="${site.other}/background">Background link</a>')`)
    await bandal.app.evaluate(({ webContents }, id) => {
      const wc = webContents.fromId(id)!
      wc.sendInputEvent({ type: 'mouseDown', button: 'middle', clickCount: 1, x: 35, y: 20 })
      wc.sendInputEvent({ type: 'mouseUp', button: 'middle', clickCount: 1, x: 35, y: 20 })
    }, root)
    const child = await childAt(bandal, `${site.other}/background`)
    await expect.poll(() => bandal.app.evaluate(({webContents}, id) => webContents.fromId(id)!.mainFrame.executeJavaScript('window.received'), child)).toMatchObject({ method: 'GET', body: '' })
    expect(await bandal.app.evaluate(({ BrowserWindow }, id) => {
      const host = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!
      return host.contentView.children.some(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id && v.getVisible())
    }, root)).toBe(true)
    expect(await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally { await bandal.close(); await site.close() }
})

test('profiles isolate logins and history, switch a live tab and inherit popup sessions', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '프로필 검증')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, `document.cookie='account=personal';localStorage.setItem('account','personal')`)
    const profile = await bandal.page.evaluate(() => window.bandal.invoke('browser:saveProfile', { name: '학교', color: '#397db5', icon: '●' }))
    await bandal.page.getByRole('button', { name: '브라우저 프로필', exact: true }).click()
    await bandal.page.getByRole('dialog', { name: '브라우저 프로필 선택' }).getByRole('button', { name: '● 학교', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(({ webContents }, oldId) => webContents.fromId(oldId)?.isDestroyed() ?? true, root)).toBe(true)
    const school = await childAt(bandal, `${site.origin}/lecture`)
    await expect.poll(() => run(bandal, school, 'document.readyState')).toBe('complete')
    expect(await run(bandal, school, `document.cookie+':'+localStorage.getItem('account')`)).toBe(':null')
    await run(bandal, school, `document.cookie='account=school';localStorage.setItem('account','school');window.open('${site.origin}/profile-child','child');void 0`)
    const child = await childAt(bandal, `${site.origin}/profile-child`)
    expect(await run(bandal, child, 'document.cookie')).toBe('account=school')
    const history = await bandal.page.evaluate(async id => {
      await window.bandal.invoke('browser:recordVisit', { profileId: id, url: 'https://school.example/unique', title: '학교만', courseId: null })
      return [await window.bandal.invoke('browser:searchHistory', { query: '학교만' }), await window.bandal.invoke('browser:searchHistory', { profileId: id, query: '학교만' })]
    }, profile.id)
    expect(history[0].entries).toHaveLength(0)
    expect(history[1].entries).toHaveLength(1)
    const personalAgain = await openTab(bandal, `${site.origin}/personal-again`)
    expect(await run(bandal, personalAgain, 'document.cookie')).toBe('account=personal')
    expect(await run(bandal, school, 'document.cookie')).toBe('account=school')
    // Session identity is preserved across child creation; default still has personal cookies.
    expect(await bandal.app.evaluate(async ({ session }, origin) => (await session.fromPartition('persist:browsing').cookies.get({ url: origin }))[0]?.value, site.origin)).toBe('personal')
  } finally { await bandal.close(); await site.close() }
})

test('floating assistant stays above native pages while browser remains interactive', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '채팅 겹침 검증')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await bandal.page.evaluate(async () => {
      const overlay = await window.bandal.invoke('overlay:getState', {})
      await window.bandal.invoke('assistant:window', { action: 'sync', state: { visible: true, courseId: overlay.courseId, conversationId: overlay.conversationId } })
    })
    await expect.poll(() => bandal.app.windows().some(p => p.url().includes('view=assistant'))).toBe(true)
    const popup = bandal.app.windows().find(p => p.url().includes('view=assistant'))!
    await expect(popup.locator('#assistant-popup')).toBeVisible()
    expect(await bandal.app.evaluate(({ BrowserWindow }, id) => {
      const main = BrowserWindow.getAllWindows().find(w => w.contentView.children.some(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id))!
      const assistant = main.getChildWindows().find(w => w.webContents.getURL().includes('view=assistant'))!
      return { visible: assistant.isVisible(), top: assistant.isAlwaysOnTop(), browserVisible: main.contentView.children.some(v => 'webContents' in v && (v as Electron.WebContentsView).webContents.id === id && v.getVisible()) }
    }, root)).toEqual({ visible: true, top: false, browserVisible: true })
    await popup.getByRole('button', { name: '반달 AI 채팅 닫기' }).click()
    expect(await run(bandal, root, 'document.querySelector("h1").textContent')).toBe('Lecture page')
  } finally { await bandal.close(); await site.close() }
})

test('horizontal trackpad gestures navigate once and respect scrolling elements', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '제스처 검증')
    const root = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, root, `location.href='${site.origin}/second'`)
    await expect.poll(() => run(bandal, root, 'location.pathname')).toBe('/second')
    const wheel = async (deltaX: number, deltaY = 0) => {
      await bandal.app.evaluate(({ webContents }, { id, deltaX, deltaY }) => { const wc = webContents.fromId(id)!; wc.focus(); wc.sendInputEvent({ type: 'mouseWheel', x: 120, y: 120, deltaX, deltaY, hasPreciseScrollingDeltas: true, canScroll: true }) }, { id: root, deltaX, deltaY })
      await bandal.page.waitForTimeout(40)
    }
    // Electron input deltas have the opposite sign to DOM WheelEvent deltas.
    await wheel(5)
    for (let i = 0; i < 10; i++) await wheel(22)
    await expect.poll(() => run(bandal, root, 'location.pathname')).toBe('/lecture')
    await bandal.page.waitForTimeout(700)
    await run(bandal, root, `document.body.innerHTML='<div id="scroller" style="position:fixed;inset:0;overflow:auto"><div style="width:3000px;height:100px">wide</div></div>';document.getElementById('scroller').scrollLeft=400`)
    for (let i = 0; i < 10; i++) await wheel(-22)
    await bandal.page.waitForTimeout(250)
    expect(await run(bandal, root, 'location.pathname')).toBe('/lecture')
  } finally { await bandal.close(); await site.close() }
})

test('profile session and tab identity survive restart without replacing the default login', async () => {
  const site = await fixture()
  let bandal = await launchBandal({ keepProfileOnClose: true })
  try {
    await createCourse(bandal.page, '프로필 복원')
    await openTab(bandal, `${site.origin}/lecture`)
    const profile = await bandal.page.evaluate(() => window.bandal.invoke('browser:saveProfile', { name: '복원 계정', color: '#9757b0', icon: '●' }))
    await bandal.page.getByRole('button', { name: '브라우저 프로필', exact: true }).click()
    await bandal.page.getByRole('dialog').getByRole('button', { name: '● 복원 계정', exact: true }).click()
    const id = await childAt(bandal, `${site.origin}/lecture`)
    await run(bandal, id, `location.href='${site.origin}/after-login'`)
    await expect.poll(() => run(bandal, id, 'location.pathname')).toBe('/after-login')
    await run(bandal, id, `document.cookie='account=retained;max-age=86400';localStorage.setItem('profile','retained')`)
    // Layout writes are debounced; wait for the actual descriptor to be persisted.
    await expect.poll(() => bandal.page.evaluate(async () => { const state = await window.bandal.invoke('overlay:getState', {}); return state.courseId ? JSON.stringify(await window.bandal.invoke('layout:get', { courseId: state.courseId })) : '' })).toContain(profile.id)
    const directory = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: directory })
    await expect(bandal.page.getByRole('button', { name: '브라우저 프로필', exact: true })).toContainText('복원 계정')
    const restored = await childAt(bandal, `${site.origin}/after-login`)
    expect(await run(bandal, restored, `document.cookie+':'+localStorage.getItem('profile')`)).toBe('account=retained:retained')
    expect(await bandal.page.evaluate(id => window.bandal.invoke('browser:profiles', {}).then(p => p.some(x => x.id === id)), profile.id)).toBe(true)
  } finally { await bandal.close(); await site.close() }
})

test('cancelled beforeunload keeps the current profile and its page alive', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '프로필 전환 취소')
    const id = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, id, `addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='unsaved'});document.body.innerHTML='<button style="position:fixed;inset:0">Edit</button>'`)
    await bandal.app.evaluate(({ webContents, dialog }, id) => {
      dialog.showMessageBoxSync = () => 0
      const wc = webContents.fromId(id)!
      wc.sendInputEvent({ type: 'mouseDown', x: 80, y: 80, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: 80, y: 80, button: 'left', clickCount: 1 })
    }, id)
    // Electron owns beforeunload; prevent Playwright's automatic CDP dismiss from racing it.
    bandal.app.context().pages().find(p => p.url() === `${site.origin}/lecture`)?.on('dialog', () => {})
    const tabId = await bandal.page.locator('.browser-guest').getAttribute('data-tab-id')
    expect(tabId).toBeTruthy()
    const result = await bandal.page.evaluate(tabId => window.bandal.invoke('browser:prepareProfileSwitch', { tabId: tabId! }), tabId)
    expect(result.allowed).toBe(false)
    expect(await run(bandal, id, 'document.body.textContent')).toBe('Edit')
    await run(bandal, id, 'onbeforeunload=null')
    await bandal.app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1 })
  } finally { await bandal.close(); await site.close() }
})

test('two-finger history works inside a cross-origin iframe', async () => {
  const site = await fixture(), bandal = await launchBandal()
  try {
    await createCourse(bandal.page, '프레임 제스처')
    const id = await openTab(bandal, `${site.origin}/lecture`)
    await run(bandal, id, `location.href='${site.origin}/second'`)
    await expect.poll(() => run(bandal, id, 'location.pathname')).toBe('/second')
    await run(bandal, id, `document.body.innerHTML='<iframe src="${site.other}/frame" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>'`)
    await expect.poll(() => bandal.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.mainFrame.frames.length, id)).toBe(1)
    await bandal.page.waitForTimeout(200)
    for (let i = 0; i < 12; i++) {
      await bandal.app.evaluate(({ webContents }, id) => { const wc = webContents.fromId(id)!; wc.focus(); wc.sendInputEvent({ type: 'mouseWheel', x: 120, y: 120, deltaX: 22, deltaY: 0, hasPreciseScrollingDeltas: true, canScroll: true }) }, id)
      await bandal.page.waitForTimeout(40)
    }
    await expect.poll(() => run(bandal, id, 'location.pathname')).toBe('/lecture')
  } finally { await bandal.close(); await site.close() }
})
