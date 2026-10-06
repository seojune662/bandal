import { expect, test } from '@playwright/test'
import { createCourse, launchBandal } from './helpers/launch'

test('AI web shortcuts reuse the current conversation and survive layout restoration', async ({}, info) => {
  let bandal = await launchBandal({ keepProfileOnClose: true, extraSettings: { theme: 'light' } })
  const installSites = async () => bandal.app.evaluate(({ session }) => {
    session.fromPartition('persist:browsing').protocol.handle('https', request => {
      const host = new URL(request.url).hostname
      const label = host === 'gemini.google.com' ? 'Gemini' : host === 'chatgpt.com' ? 'ChatGPT' : 'Claude'
      return new Response(`<html><head><title>${label} fixture</title></head><body><h1>${label}</h1><input id="draft" aria-label="AI web draft"><script>window.fixtureToken = Math.random()</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    })
  })
  try {
    await installSites()
    const { page } = bandal
    const shortcuts = page.getByRole('region', { name: 'AI 웹 바로가기' })
    // A browser is available before the user creates their first course.
    await shortcuts.getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.dv-tab:visible')).toHaveCount(1)
    await shortcuts.getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.dv-tab:visible')).toHaveCount(1)
    await createCourse(page, 'AI 웹 검사')
    const courseId = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    await shortcuts.getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.dv-tab:visible')).toHaveCount(1)
    await expect.poll(() => bandal.app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(contents => contents.getURL().startsWith('https://gemini.google.com')).at(-1)?.getTitle())).toBe('Gemini fixture')
    const gemini = await bandal.app.evaluate(({ webContents }) => {
      const contents = webContents.getAllWebContents().filter(contents => contents.getURL().startsWith('https://gemini.google.com')).at(-1)!
      return { id: contents.id }
    })
    await bandal.app.evaluate(async ({ webContents }, id) => {
      await webContents.fromId(id)!.executeJavaScript(`document.querySelector('#draft').value = '현재 대화 초안'; history.replaceState({}, '', '/app/test-conversation')`)
    }, gemini.id)
    await shortcuts.getByRole('button', { name: 'ChatGPT', exact: true }).click()
    await shortcuts.getByRole('button', { name: 'Claude', exact: true }).click()
    await shortcuts.getByRole('button', { name: 'Gemini', exact: true }).click()
    await shortcuts.getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.dv-tab:visible')).toHaveCount(3)
    const preserved = await bandal.app.evaluate(async ({ webContents }, id) => ({ id: webContents.fromId(id)!.id, url: webContents.fromId(id)!.getURL(), draft: await webContents.fromId(id)!.executeJavaScript(`document.querySelector('#draft').value`) }), gemini.id)
    expect(preserved).toEqual({ id: gemini.id, url: 'https://gemini.google.com/app/test-conversation', draft: '현재 대화 초안' })
    await page.screenshot({ path: info.outputPath('ai-shortcuts-light.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: info.outputPath('ai-shortcuts-dark.png') })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1024, 640))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({ path: info.outputPath('ai-shortcuts-narrow.png') })
    expect(await shortcuts.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await shortcuts.getByRole('button', { name: 'AI 바로가기 접기' }).click()
    await expect(shortcuts.getByRole('button', { name: 'Gemini', exact: true })).toHaveCount(0)
    await expect.poll(async () => Object.values((await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), courseId)).layout?.panels ?? {}).filter((panel: any) => panel.params.descriptor.kind === 'browser').length).toBe(3)
    const profile = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile })
    await installSites()
    const restored = bandal.page.getByRole('region', { name: 'AI 웹 바로가기' })
    await expect(restored.getByRole('button', { name: 'AI 바로가기 펼치기' })).toBeVisible()
    await restored.getByRole('button', { name: 'AI 바로가기 펼치기' }).click()
    await restored.getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(bandal.page.locator('.dv-tab:visible')).toHaveCount(3)
  } finally { await bandal.close() }
})

test('CLI installation continues to login once across settings and chat surfaces', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { agentProvider: 'codex', theme: 'light' } })
  try {
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = { installed: false, loggedIn: false, installs: 0, logins: 0, provider: 'codex', opens: [] as any[] }
      ;(globalThis as any).__aiConnectionTest = state
      const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('agent:availability', req => req.provider === 'codex' ? { installed: state.installed, loggedIn: state.loggedIn, ...(state.installed ? { version: '0.158.0' } : {}) } : { installed: false, loggedIn: false })
      handle('agent:installCommand', () => ({ command: 'fixture install command', supported: true }))
      handle('agent:install', async req => {
        state.installs += 1
        await new Promise(resolve => setTimeout(resolve, 100))
        state.installed = true
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent:install-progress', { provider: req.provider, line: 'fixture installed', done: true, ok: true })
        return { ok: true, message: '설치를 확인했습니다.' }
      })
      handle('agent:login', () => { state.logins += 1; return { ok: true, message: 'fixture login opened' } })
      handle('agent:models', () => ({ models: [{ id: 'fixture', displayName: 'Fixture', isDefault: true }] }))
      handle('chat:setProvider', req => { state.provider = req.provider; return { sessionInfo: null, carried: null } })
      handle('chat:open', req => { state.opens.push(req); return { history: [], availability: { installed: state.installed, loggedIn: state.loggedIn }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: state.provider, model: 'fixture', status: 'idle', title: null, surface: req.surface, cliSessionId: null, lastUsedAt: null } } })
    })
    const { page } = bandal
    await createCourse(page, 'CLI 연결 검사')
    await page.keyboard.press('ControlOrMeta+Shift+A')
    const chat = page.locator('.chat-tab:visible')
    await expect(chat.getByRole('button', { name: '연결하기', exact: true })).toBeVisible()
    await chat.getByRole('button', { name: '연결하기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__aiConnectionTest.logins)).toBe(1)
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="ai"]').click()
    const codex = page.locator('#settings-ai-provider-codex').locator('..')
    await codex.scrollIntoViewIfNeeded()
    await expect(codex).toContainText('터미널에서 로그인을 마치면 자동으로 이어져요.')
    await page.screenshot({ path: info.outputPath('ai-connection-waiting.png') })
    await page.keyboard.press('Escape')
    await bandal.app.evaluate(() => { (globalThis as any).__aiConnectionTest.loggedIn = true })
    await expect(chat.getByRole('textbox', { name: '메시지 입력' })).toBeVisible()
    const counts = await bandal.app.evaluate(() => ({ installs: (globalThis as any).__aiConnectionTest.installs, logins: (globalThis as any).__aiConnectionTest.logins }))
    expect(counts).toEqual({ installs: 1, logins: 1 })
    await page.screenshot({ path: info.outputPath('ai-connection-ready.png') })
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__aiConnectionTest
      const opened = state.opens.at(-1)
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', { courseId: opened.courseId, sessionId: opened.sessionId, seq: 1, events: [{ type: 'turn-started', turnSeq: 1 }, { type: 'text-delta', blockId: 'running', text: '연결 변경 중에도 현재 응답을 이어 갑니다.' }] })
      state.loggedIn = false
    })
    await expect(chat).toContainText('연결 변경 중에도 현재 응답을 이어 갑니다.')
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="ai"]').click()
    await expect(page.locator('#settings-ai-provider-codex').locator('..')).toContainText('로그인 필요')
    await page.keyboard.press('Escape')
    await expect(chat).toContainText('연결 변경 중에도 현재 응답을 이어 갑니다.')
    await expect(chat.getByRole('button', { name: '로그인 창 열기', exact: true })).toHaveCount(0)
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const opened = (globalThis as any).__aiConnectionTest.opens.at(-1)
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', { courseId: opened.courseId, sessionId: opened.sessionId, seq: 2, events: [{ type: 'text-final', blockId: 'running', text: '연결 변경 중에도 현재 응답을 이어 갑니다.' }, { type: 'turn-complete', stopReason: 'success' }] })
    })
    await expect(chat.getByRole('button', { name: '로그인 창 열기', exact: true })).toBeVisible()
  } finally { await bandal.close() }
})
