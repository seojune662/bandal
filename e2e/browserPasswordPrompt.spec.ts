import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'

test('a submitted account waits through Google verification and opens a compact password card without shifting the page', async ({}, info) => {
  const bandal = await launchBandal()
  const origin = 'https://accounts.google.com'
  const loginUrl = `${origin}/signin/v2/challenge/pwd`
  try {
    await createCourse(bandal.page, '비밀번호 안내')
    await bandal.app.evaluate(({ session, ipcMain }, origin) => {
      session.fromPartition('persist:browsing').protocol.handle('https', request => {
        const url = new URL(request.url)
        const body = url.pathname.includes('/pwd')
          ? `<h1>Sign in</h1><form><label>Account<input type="email" autocomplete="username" value="student@example.edu"></label><label>Password<input type="password" autocomplete="current-password"></label><button type="submit">Continue</button></form><script>document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();setTimeout(()=>location.href='/signin/challenge/passkey',300)})</script>`
          : url.hostname === 'accounts.google.com'
            ? '<h1>Verify with your passkey</h1><p>Complete verification to continue.</p>'
            : '<h1>Your study library</h1><p>The account is ready.</p>'
        return new Response(`<html><head><title>Password card fixture</title><style>body{font:16px system-ui;color:#263b30;background:#f7faf8;padding:60px}form{display:grid;gap:20px;width:300px}label{display:grid;gap:8px}input,button{padding:10px;font:inherit}</style></head><body>${body}</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      })
      // This isolated UI fixture returns only synthetic metadata. The E2E
      // launcher disables OS safeStorage to avoid keychain prompts; actual
      // secret capture/encryption remains covered by loginCapture unit tests.
      const state = { stages: 0, commits: 0, discards: 0 }
      ;(globalThis as unknown as { passwordFixture: typeof state }).passwordFixture = state
      ipcMain.removeHandler('credentials:list')
      ipcMain.handle('credentials:list', () => [{ id: 'school', origin, username: 'school@example.edu', autoSubmit: false, updatedAt: '' }])
      ipcMain.removeHandler('credentials:capture')
      ipcMain.handle('credentials:capture', (_event, request: { mode: string }) => {
        if (request.mode === 'stage') state.stages++
        if (request.mode === 'commit') state.commits++
        if (request.mode === 'discard') { state.discards++; return null }
        return { id: 'staged:fixture', origin, username: 'student@example.edu', autoSubmit: false, updatedAt: new Date().toISOString() }
      })
    }, origin)
    const { page } = bandal
    const add = page.locator('.workspace-add-tab')
    if (await add.isVisible()) await add.click()
    else await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByLabel('새 탭 검색').fill(loginUrl)
    await page.getByRole('option', { name: `브라우저 ${loginUrl}` }).click()
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(view => view.getURL() === url)?.id ?? null, loginUrl)).not.toBeNull()
    const guestId = await bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(view => view.getURL() === url)!.id, loginUrl)
    await expect.poll(() => bandal.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.__bandalLoginReporterInstalledV2__ === true'), guestId)).toBe(true)
    await bandal.app.evaluate(async ({ webContents }, id) => {
      const guest = webContents.fromId(id)!
      guest.focus()
      await guest.executeJavaScript('document.querySelector("input[type=password]").focus()')
      await guest.insertText('synthetic-fixture-password')
      guest.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      guest.sendInputEvent({ type: 'char', keyCode: '\r' })
      guest.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    }, guestId)
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { passwordFixture: { stages: number } }).passwordFixture.stages)).toBe(1)
    await expect.poll(() => bandal.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.getURL(), guestId)).toBe(`${origin}/signin/challenge/passkey`)
    await expect(page.locator('.browser-password-trigger')).toHaveCount(0)
    const anchor = page.locator('.browser-anchor:visible').first()
    const before = await anchor.boundingBox()
    await bandal.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.loadURL('https://drive.google.com/drive/u/1/home'), guestId)
    const trigger = page.getByRole('button', { name: '비밀번호 저장 확인', exact: true })
    await expect(trigger).toBeVisible()
    await expect(page.getByRole('dialog', { name: '비밀번호 저장', exact: true })).toHaveCount(0)
    expect(await anchor.boundingBox()).toEqual(before)
    await expect(page.locator('.browser-external-auth.browser-login-prompt')).toHaveCount(0)
    const waitForNativePage = async (): Promise<void> => {
      await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .filter(window => window.webContents.getURL().includes('index.html'))
        .flatMap(window => window.contentView.children)
        .filter(view => 'webContents' in view && view.getVisible()).length)).toBe(1)
      await bandal.app.evaluate(async ({ webContents }, id) => {
        const guest = webContents.fromId(id)!
        await guest.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await guest.capturePage()
      }, guestId)
    }
    const capture = async (name: string): Promise<void> => {
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
        await Promise.all(Array.from(document.querySelectorAll<HTMLElement>('.browser-native-anchor')).map(async anchor => {
          const match = anchor.style.backgroundImage.match(/^url\("?(.*?)"?\)$/)
          if (match?.[1]) { const image = new Image(); image.src = match[1]; await image.decode().catch(() => {}) }
        }))
      })
      const png = await bandal.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('index.html'))!
        return (await window.capturePage()).toPNG().toString('base64')
      })
      writeFileSync(info.outputPath(name), Buffer.from(png, 'base64'))
    }
    await waitForNativePage()
    await trigger.click()
    const card = page.getByRole('dialog', { name: '비밀번호 저장', exact: true })
    await expect(card).toBeVisible()
    await expect(card).toContainText('accounts.google.com')
    await expect(card).toContainText('student@example.edu')
    await expect(card.getByRole('button', { name: '저장', exact: true })).toBeVisible()
    expect(await anchor.boundingBox()).toEqual(before)
    const box = (await card.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(344)
    const bounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.height)
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.width)
    await capture('password-card-dark.png')
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    await expect(trigger).toBeVisible()
    await expect(trigger).toBeFocused()
    await waitForNativePage()
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await trigger.click()
    await expect(card).toBeVisible()
    await capture('password-card-light.png')
    await card.getByRole('button', { name: '저장', exact: true }).click()
    await expect(card).toHaveCount(0)
    await expect(trigger).toHaveCount(0)
    expect(await bandal.app.evaluate(() => (globalThis as unknown as { passwordFixture: { stages: number; commits: number; discards: number } }).passwordFixture))
      .toEqual({ stages: 1, commits: 1, discards: 0 })
  } finally { await bandal.close() }
})
