import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import JSZip from 'jszip'
import { createCourse, launchBandal } from './helpers/launch'

test('imports Safari export through the real dialog with scoped bookmarks and idempotent history', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bandal-import-fixture-'))
  const previous = process.env.BANDAL_TEST_IMPORT_HOME
  process.env.BANDAL_TEST_IMPORT_HOME = home
  const zip = new JSZip()
  zip.file(
    '책갈피.html',
    '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://school.example/lecture">강의 자료</A></DL>',
  )
  zip.file(
    '방문 기록.json',
    JSON.stringify({
      metadata: { data_type: 'history', schema_version: 1 },
      history: [
        {
          url: 'https://school.example/lecture',
          title: '강의 자료',
          time_usec: Date.now() * 1000,
          visits_count: 12,
        },
      ],
    }),
  )
  const file = join(home, 'Safari.zip')
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
  const bandal = await launchBandal()
  const preview = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><html lang="ko"><head><title>운동체역학 · 강의 자료</title><style>
      :root{color-scheme:light dark}body{margin:0;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}main{max-width:640px;padding:64px 40px;margin:auto}small{opacity:.55}h1{font-size:32px;font-weight:600;letter-spacing:-1px;line-height:1.3;margin:12px 0 24px}h2{font-size:19px;font-weight:500;margin-top:36px}p{opacity:.8}hr{border:0;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent);margin:32px 0}
      </style></head><body><main><small>운동체역학 / 강의 자료</small><h1>회전 운동과 에너지</h1><p>물체의 회전 운동을 관찰하고, 일과 에너지의 관계를 정리합니다.</p><hr><h2>이번 강의에서 다룰 내용</h2><p>관성 모멘트와 각속도<br>회전 운동 에너지<br>힘이 한 일과 에너지의 변화</p><h2>학습 메모</h2><p>강의 자료를 읽으며 핵심 개념을 정리하고, 예제에 적용해 보세요.</p><hr><small>개인 정보가 없는 로컬 브라우저 검증 페이지</small></main></body></html>`)
  })
  try {
    const { page } = bandal
    await createCourse(page, '가져오기 검증')
    const profile = await page.evaluate(() =>
      window.bandal.invoke('browser:saveProfile', {
        name: '학교',
        color: '#397db5',
        icon: '●',
      }),
    )
    await bandal.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, file)
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="browser"]').click()
    await page
      .locator('.settings-card')
      .filter({ hasText: 'Chrome · Edge · Firefox · Safari' })
      .getByRole('button')
      .click()
    const dialog = page.getByRole('dialog', {
      name: '브라우저 데이터 가져오기',
    })
    await expect(dialog).toBeVisible()
    await dialog
      .getByRole('button', { name: 'Safari 내보내기 ZIP', exact: true })
      .click()
    await dialog.getByLabel('설정할 브라우저 프로필').selectOption(profile.id)
    await expect(dialog.getByLabel('로그인 상태 · 쿠키')).toBeDisabled()
    await dialog.getByLabel('비밀번호', { exact: false }).uncheck()
    const shots = process.env.BANDAL_E2E_SHOT_DIR
    if (shots) {
      mkdirSync(shots, { recursive: true })
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(
          (theme) => window.bandal.invoke('settings:set', { theme }),
          theme,
        )
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        for (const [width, height] of [[1440, 900], [1024, 640]]) {
          await bandal.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!), [width!, height!])
          await expect(dialog).toBeInViewport()
          await dialog.getByRole('button', { name: '가져오기', exact: true }).scrollIntoViewIfNeeded()
          await expect(dialog.getByRole('button', { name: '가져오기', exact: true })).toBeInViewport()
          await dialog.evaluate(element => { element.scrollTop = 0 })
          await page.screenshot({ path: join(shots, `browser-import-${theme}-${width}.png`) })
        }
      }
    }
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: '가져오기를 마쳤습니다' }),
    ).toBeVisible()
    const imported = await page.evaluate(
      async (profileId) => ({
        favorites: await window.bandal.invoke('favorites:list', {
          courseId: null,
        }),
        history: await window.bandal.invoke('browser:searchHistory', {
          query: 'school.example',
          profileId,
        }),
      }),
      profile.id,
    )
    expect(imported.favorites).toHaveLength(1)
    expect(imported.favorites[0]!.descriptor).toMatchObject({
      kind: 'browser',
      payload: { profileId: profile.id },
    })
    expect(imported.history.entries[0]).toMatchObject({
      visitCount: 12,
      title: '강의 자료',
    })
    expect(
      await page.evaluate(() =>
        window.bandal.invoke('browser:searchHistory', {
          query: 'school.example',
        }),
      ),
    ).toEqual({ entries: [] })
    await dialog.getByRole('button', { name: '다른 데이터 가져오기' }).click()
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click()
    await expect(
      dialog.getByRole('heading', { name: '가져오기를 마쳤습니다' }),
    ).toBeVisible()
    expect(
      await page.evaluate(() =>
        window.bandal.invoke('favorites:list', { courseId: null }),
      ),
    ).toHaveLength(1)
    expect(
      (
        await page.evaluate(
          (profileId) =>
            window.bandal.invoke('browser:searchHistory', {
              query: 'school.example',
              profileId,
            }),
          profile.id,
        )
      ).entries[0]!.visitCount,
    ).toBe(12)
    await dialog.getByRole('button', { name: '완료', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.locator('.settings-app .back-button').click()
    await expect(page.locator('.settings-app')).toHaveCount(0)
    await new Promise<void>(resolve => preview.listen(0, '127.0.0.1', resolve))
    const previewUrl = `http://127.0.0.1:${(preview.address() as { port: number }).port}/`
    await page.evaluate(async homePage => {
      const settings = await window.bandal.invoke('settings:get', {})
      await window.bandal.invoke('settings:set', { browser: { ...settings.browser, homePage } })
    }, previewUrl)
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('option', { name: '새 브라우저 탭', exact: false }).click()
    const browser = page.locator('.browser-panel:visible')
    await expect(browser).toBeVisible()
    await expect(browser.getByRole('button', { name: '브라우저 프로필', exact: true })).toContainText('기본')
    await expect(browser.locator('.browser-bookmark').filter({ hasText: '강의 자료' })).toHaveCount(0)
    await browser.getByRole('button', { name: '브라우저 프로필', exact: true }).click()
    await page.getByRole('dialog', { name: '브라우저 프로필 선택' }).getByRole('button', { name: '● 학교', exact: true }).click()
    await expect(browser.getByRole('button', { name: '브라우저 프로필', exact: true })).toContainText('학교')
    await expect(browser.locator('.browser-bookmark').filter({ hasText: '강의 자료' })).toHaveCount(1)
    await expect(browser.locator('.browser-bookmark').filter({ hasText: '강의 자료' })).toBeVisible()
    await expect.poll(() => bandal.app.evaluate(({ webContents, session }, { url, profileId }) => webContents.getAllWebContents().some(contents => contents.session === session.fromPartition(`persist:bandal-profile-${profileId}`) && contents.getURL() === url && !contents.isLoading()), { url: previewUrl, profileId: profile.id })).toBe(true)
    const pageIdentity = { url: previewUrl, profileId: profile.id }
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow, session }, { url, profileId }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      const view = host.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.session === session.fromPartition(`persist:bandal-profile-${profileId}`) && (child as Electron.WebContentsView).webContents.getURL() === url)
      if (!view) return false
      const bounds = view.getBounds()
      return view.getVisible() && bounds.width > 200 && bounds.height > 200 && bounds.x >= 0 && bounds.y >= 0
    }, pageIdentity)).toBe(true)
    const captureBrowserPage = async () => bandal.app.evaluate(async ({ BrowserWindow, session }, { url, profileId }) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      const view = host.contentView.children.find(child => 'webContents' in child && (child as Electron.WebContentsView).webContents.session === session.fromPartition(`persist:bandal-profile-${profileId}`) && (child as Electron.WebContentsView).webContents.getURL() === url) as Electron.WebContentsView
      const contents = view.webContents
      await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const screenshot = await contents.capturePage()
      const bitmap = screenshot.toBitmap()
      const colors = new Set<number>()
      for (let index = 0; index < bitmap.length && colors.size < 32; index += 4) {
        if (bitmap[index + 3] !== 0) colors.add((bitmap[index]! << 16) | (bitmap[index + 1]! << 8) | bitmap[index + 2]!)
      }
      return { text: await contents.executeJavaScript('document.body.innerText'), visible: view.getVisible(), bounds: view.getBounds(), size: screenshot.getSize(), colors: colors.size, png: screenshot.toPNG().toString('base64') }
    }, pageIdentity)
    const paintedPage = await captureBrowserPage()
    expect(paintedPage.text).toContain('회전 운동과 에너지')
    expect(paintedPage.colors).toBeGreaterThan(16)
    expect(paintedPage.size.width).toBeGreaterThan(200)
    expect(paintedPage.size.height).toBeGreaterThan(200)
    if (shots) {
      await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1440, 900))
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const rendered = await captureBrowserPage()
        expect(rendered.visible).toBe(true)
        expect(rendered.colors).toBeGreaterThan(16)
        writeFileSync(join(shots, `browser-content-${theme}.png`), Buffer.from(rendered.png, 'base64'))
        // BrowserWindow.capturePage only captures the host compositor; native
        // child views require their own capture or a permitted window stream.
        const shell = await bandal.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.capturePage()).toPNG().toString('base64'))
        writeFileSync(join(shots, `browser-shell-${theme}.png`), Buffer.from(shell, 'base64'))
        const windowCapture = await bandal.app.evaluate(async ({ BrowserWindow, systemPreferences }) => {
          if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { png: null, reason: 'screen-permission-not-granted' }
          const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
          // A direct source ID captures only this synthetic test window. Do not
          // enumerate desktop sources/thumbnails or request OS permission.
          const sourceId = host.getMediaSourceId()
          try {
            const png = await host.webContents.executeJavaScript(`(async () => {
              let expired = false;
              let timer;
              const capture = (async () => {
                const stream = await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:${JSON.stringify(sourceId)}}}});
                try {
                  if (expired) return null;
                  const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
                  await video.play();
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                  if (expired || !video.videoWidth || !video.videoHeight) return null;
                  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                  canvas.getContext('2d').drawImage(video,0,0);
                  return canvas.toDataURL('image/png').split(',')[1];
                } finally { stream.getTracks().forEach(track => track.stop()); }
              })();
              try { return await Promise.race([capture, new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 3000); })]); }
              finally { clearTimeout(timer); }
            })()`)
            return { png: typeof png === 'string' ? png : null, reason: typeof png === 'string' ? 'captured-test-window-only' : 'window-stream-unavailable' }
          } catch { return { png: null, reason: 'window-stream-unavailable' } }
        })
        // Never leave a host-only image under a name claiming a whole window.
        const fullPath = join(shots, `browser-${theme}.png`)
        if (windowCapture.png) writeFileSync(fullPath, Buffer.from(windowCapture.png, 'base64'))
        else rmSync(fullPath, { force: true })
        writeFileSync(join(shots, `browser-${theme}-capture.json`), JSON.stringify({ theme, visible: rendered.visible, bounds: rendered.bounds, contentSize: rendered.size, paintedColors: rendered.colors, wholeWindow: windowCapture.reason }, null, 2))
      }
    }
  } finally {
    await bandal.close()
    if (preview.listening) await new Promise<void>(resolve => preview.close(() => resolve()))
    if (previous === undefined) delete process.env.BANDAL_TEST_IMPORT_HOME
    else process.env.BANDAL_TEST_IMPORT_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('imports synthetic Firefox cookies into the selected Electron session without partitioned cookies', async () => {
  test.skip(!['darwin', 'win32'].includes(process.platform), 'Direct profile discovery supports macOS and Windows.')
  const home = mkdtempSync(join(tmpdir(), 'bandal-firefox-import-fixture-'))
  const previous = process.env.BANDAL_TEST_IMPORT_HOME
  process.env.BANDAL_TEST_IMPORT_HOME = home
  // The main process maps this fixture home to Roaming/Local on Windows;
  // neither discovery nor the test opens a real browser profile.
  const firefoxRoot = process.platform === 'win32'
    ? join(home, 'Roaming', 'Mozilla', 'Firefox')
    : join(home, 'Library', 'Application Support', 'Firefox')
  const profileDirectory = join(firefoxRoot, 'Profiles', 'cookie-fixture')
  mkdirSync(profileDirectory, { recursive: true })
  writeFileSync(join(firefoxRoot, 'profiles.ini'), '[Profile0]\nName=쿠키 검증\nIsRelative=1\nPath=Profiles/cookie-fixture\n')
  const Sqlite = createRequire(__filename)('better-sqlite3-node') as typeof import('better-sqlite3')
  const database = new Sqlite(join(profileDirectory, 'cookies.sqlite'))
  const expires = Math.floor(Date.now() / 1000) + 86_400
  try {
    database.exec('CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)')
    const insert = database.prepare('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?,?,?)')
    insert.run('cookie-import.example', 'host-session', 'synthetic-session', '/', 0, 1, 1, 1, '')
    insert.run('.cookie-import.example', 'domain-persistent', 'synthetic-persistent', '/study', expires, 1, 1, 2, '')
    insert.run('cookie-import.example', 'partitioned', 'must-not-import', '/', expires, 1, 1, 1, '^partitionKey=(https,parent.example)')
    insert.run('cookie-import.example', 'container', 'must-not-import', '/', expires, 1, 1, 1, '^userContextId=2')
  } finally {
    database.close()
  }
  let bandal: Awaited<ReturnType<typeof launchBandal>> | undefined
  try {
    bandal = await launchBandal()
    const { page } = bandal
    const profile = await page.evaluate(() => window.bandal.invoke('browser:saveProfile', { name: '쿠키 대상', color: '#397db5', icon: '●' }))
    const sources = await page.evaluate(() => window.bandal.invoke('browser:importSources', {}))
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ browser: 'firefox', profileName: '쿠키 검증', capabilities: { cookies: { supported: true }, passwords: { supported: false } } })
    const started = await page.evaluate(({ sourceId, targetProfileId }) => window.bandal.invoke('browser:importStart', { sourceId, targetProfileId, items: ['cookies'], conflict: 'keep' }), { sourceId: sources[0]!.id, targetProfileId: profile.id })
    await expect.poll(() => page.evaluate((jobId) => window.bandal.invoke('browser:importJob', { jobId }), started.id).then(job => job?.state)).toBe('completed')
    const finished = await page.evaluate((jobId) => window.bandal.invoke('browser:importJob', { jobId }), started.id)
    expect(finished?.results.cookies).toEqual({ imported: 2, kept: 0, unsupported: 2, failed: 0 })
    const actual = await bandal.app.evaluate(async ({ session }, profileId) => ({
      target: await session.fromPartition(`persist:bandal-profile-${profileId}`).cookies.get({ domain: 'cookie-import.example' }),
      defaultProfile: await session.fromPartition('persist:browsing').cookies.get({ domain: 'cookie-import.example' }),
    }), profile.id)
    expect(actual.defaultProfile).toEqual([])
    expect(actual.target.map(cookie => cookie.name).sort()).toEqual(['domain-persistent', 'host-session'])
    const host = actual.target.find(cookie => cookie.name === 'host-session')!
    expect(host).toMatchObject({ domain: 'cookie-import.example', hostOnly: true, path: '/', value: 'synthetic-session', secure: true, httpOnly: true, sameSite: 'lax', session: true })
    expect(host.expirationDate).toBeUndefined()
    const domain = actual.target.find(cookie => cookie.name === 'domain-persistent')!
    expect(domain).toMatchObject({ domain: '.cookie-import.example', hostOnly: false, path: '/study', value: 'synthetic-persistent', secure: true, httpOnly: true, sameSite: 'strict', session: false })
    expect(domain.expirationDate).toBe(expires)
  } finally {
    await bandal?.close()
    if (previous === undefined) delete process.env.BANDAL_TEST_IMPORT_HOME
    else process.env.BANDAL_TEST_IMPORT_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})
