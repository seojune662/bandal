import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'

test('browser chrome stays in one row with working AI and accessible tools in narrow splits', async ({}, info) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<html><head><title>Study library</title><style>body{font:16px system-ui;background:#f8faf9;color:#24352d;padding:48px}h1{font-size:36px}article{background:white;border:1px solid #dde5df;border-radius:14px;padding:24px;max-width:600px}a{color:#35664a}</style></head><body><h1>Study library</h1><article><h2>Everything for your next class</h2><p>Read course material, keep your accounts separate, and ask AI without leaving the page.</p><a href="/next">Open lecture notes</a></article></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const bandal = await launchBandal()
  const setViewport = async (name: string, width: number, height: number): Promise<void> => {
    // Windows CI starts at the virtual display size, which can already put a
    // single pane into overflow mode. Exercise explicit renderer dimensions.
    await bandal.app.evaluate(({ BrowserWindow }, size) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      if (host.isMaximized()) host.unmaximize()
      host.webContents.setZoomFactor(1)
      host.setContentSize(size.width, size.height)
    }, { width, height })
    await expect.poll(() => bandal.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width, height })
    await info.attach(`${name}-viewport`, { body: JSON.stringify({ width, height }), contentType: 'application/json' })
  }
  const capture = async (name: string): Promise<void> => {
    const expectedPages = await bandal.page.locator('.browser-anchor:visible').count()
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL().includes('index.html'))
      .flatMap(window => window.contentView.children)
      .filter(view => 'webContents' in view && view.getVisible()).length)).toBe(expectedPages)
    await bandal.page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
    })
    const png = await bandal.app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('index.html'))!
      for (const view of window.contentView.children) {
        if (!('webContents' in view) || !view.getVisible()) continue
        const contents = (view as Electron.WebContentsView).webContents
        await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await contents.capturePage()
      }
      return (await window.capturePage()).toPNG().toString('base64')
    })
    writeFileSync(info.outputPath(name), Buffer.from(png, 'base64'))
  }
  try {
    const { page } = bandal
    await setViewport('wide', 1440, 900)
    await createCourse(page, '브라우저 작업 공간')
    const add = page.locator('.workspace-add-tab')
    if (await add.isVisible()) await add.click()
    else await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    const newTabMenu = page.getByRole('dialog', { name: '새 탭 열기', exact: true })
    await newTabMenu.getByLabel('새 탭 검색').fill(url)
    const browserOption = newTabMenu.getByRole('option', { name: /^브라우저/ })
    await expect(browserOption).toContainText(url)
    await browserOption.click()
    await expect(page.locator('.workspace-tab__title', { hasText: 'Study library' })).toBeVisible()
    const panel = page.locator('.browser-panel:visible').first()
    await expect(page.locator('.tab-assistant-launchbar:visible')).toHaveCount(0)
    const toolbar = panel.locator('.browser-toolbar')
    await expect.poll(async () => (await toolbar.boundingBox())!.width).toBeGreaterThan(600)
    await expect.poll(async () => (await toolbar.boundingBox())!.height).toBe(44)
    const profile = toolbar.getByRole('button', { name: '브라우저 프로필', exact: true })
    await expect(profile).toHaveText('●기본⌄')
    await expect(toolbar.getByRole('button', { name: '브라우저 도구 더 보기' })).toBeHidden()
    const documentBox = (await page.locator('.tab-document').first().boundingBox())!
    const toolbarBox = (await toolbar.boundingBox())!
    expect(toolbarBox.y).toBe(documentBox.y)
    await info.attach('compact-header-geometry', { body: JSON.stringify({ toolbarHeight: toolbarBox.height, redundantRowHeight: toolbarBox.y - documentBox.y }), contentType: 'application/json' })
    await capture('browser-chrome-dark.png')

    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const assistant = page.getByRole('tabpanel', { name: 'AI', exact: true })
    await expect(assistant).toBeVisible()
    await expect(page.getByRole('tab', { name: 'AI', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await expect(assistant).toBeHidden()
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await capture('browser-chrome-light.png')

    await setViewport('narrow-splits', 1440, 900)
    await page.locator('.workspace-tab').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '오른쪽에 분할해서 열기', exact: true }).click()
    await expect(page.locator('.browser-panel:visible')).toHaveCount(2)
    await capture('browser-chrome-narrow.png')
    for (const narrow of await page.locator('.browser-panel:visible').all()) {
      const tools = narrow.getByRole('button', { name: '브라우저 도구 더 보기' })
      await expect(tools).toBeVisible()
      const geometry = await narrow.evaluate(element => {
        const bar = element.querySelector<HTMLElement>('.browser-toolbar')!
        const address = element.querySelector<HTMLElement>('.browser-address')!
        const field = element.querySelector<HTMLElement>('.browser-address__field')!
        return { height: bar.getBoundingClientRect().height, width: bar.clientWidth, content: bar.scrollWidth, addressWidth: address.getBoundingClientRect().width, fieldWidth: field.getBoundingClientRect().width }
      })
      await info.attach('narrow-header-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
      expect(geometry.width).toBeGreaterThan(340)
      expect(geometry.width).toBeLessThanOrEqual(600)
      expect(geometry.height).toBe(44)
      expect(geometry.content).toBeLessThanOrEqual(geometry.width)
      expect(geometry.addressWidth).toBeGreaterThan(100)
      expect(geometry.fieldWidth).toBeGreaterThan(40)
      await tools.click()
      const menu = page.getByRole('dialog', { name: '브라우저 도구', exact: true })
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('button', { name: '홈페이지로 이동' })).toBeVisible()
      await expect(menu.getByRole('button', { name: '시크릿 모드 켜기' })).toBeVisible()
      await expect(menu.getByRole('button', { name: '즐겨찾기에 추가' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(tools).toBeFocused()
    }
    const firstTools = panel.getByRole('button', { name: '브라우저 도구 더 보기' })
    await firstTools.click()
    await page.getByRole('dialog', { name: '브라우저 도구', exact: true }).getByRole('button', { name: '시크릿 모드 켜기' }).click()
    await expect(page.getByRole('dialog', { name: '브라우저 도구', exact: true })).toHaveCount(0)
    await expect(panel).toHaveAttribute('data-private', 'true')
    await expect(firstTools).toHaveAttribute('data-private', 'true')
    await firstTools.click()
    await page.getByRole('dialog', { name: '브라우저 도구', exact: true }).getByRole('button', { name: '시크릿 모드 끄기' }).click()
    await expect(panel).not.toHaveAttribute('data-private', 'true')
    await capture('browser-chrome-narrow.png')

    // Keyboard tab switching has no outside pointer event to dismiss a portal.
    // Its old controls must disappear and release native page occlusion.
    const firstGroup = page.locator('.dv-groupview').first()
    await firstGroup.locator('.workspace-tab').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '탭 복제', exact: true }).click()
    await expect(firstGroup.locator('.workspace-tab')).toHaveCount(2)
    // Content is retained in WorkspaceContentLayer outside Dockview's group.
    // The newly created duplicate is the newest mounted browser panel.
    const duplicateTools = page.locator('.browser-panel:visible').last().getByRole('button', { name: '브라우저 도구 더 보기' })
    await duplicateTools.click()
    await expect(page.getByRole('dialog', { name: '브라우저 도구', exact: true })).toBeVisible()
    await firstGroup.locator('.dv-tab').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '브라우저 도구', exact: true })).toHaveCount(0)
    await expect(firstGroup.locator('.dv-tab').first()).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL().includes('index.html'))
      .flatMap(window => window.contentView.children)
      .filter(view => 'webContents' in view && view.getVisible()).length)).toBe(2)

    // Focused login fields surface saved accounts in this same narrow row.
    // Synthetic metadata avoids accessing the OS credential store in E2E.
    const loginUrl = 'https://login.example.test/'
    await bandal.app.evaluate(({ session, ipcMain }) => {
      session.fromPartition('persist:browsing').protocol.handle('https', () => new Response('<html><title>Saved login fixture</title><body><input autocomplete="username"><input type="password" autocomplete="current-password"></body></html>', { headers: { 'content-type': 'text/html' } }))
      ipcMain.removeHandler('credentials:list')
      ipcMain.handle('credentials:list', () => ['school', 'personal'].map(id => ({ id, origin: 'https://login.example.test', username: `${id}@example.test`, autoSubmit: false, updatedAt: new Date().toISOString() })))
      ipcMain.removeHandler('credentials:fill')
      ipcMain.handle('credentials:fill', (_event, request: { credentialId: string }) => {
        ;(globalThis as unknown as { chosenLogin: string }).chosenLogin = request.credentialId
        return { filled: true }
      })
    })
    const firstAddress = panel.getByRole('combobox', { name: '주소 또는 검색어' })
    await firstAddress.fill(loginUrl)
    await firstAddress.press('Enter')
    await expect.poll(() => bandal.app.evaluate(({ webContents }, target) => webContents.getAllWebContents().find(contents => contents.getURL() === target)?.id ?? null, loginUrl)).not.toBeNull()
    await expect.poll(() => bandal.app.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === target)!
      return contents.executeJavaScript('window.__bandalLoginReporterInstalledV2__ === true')
    }, loginUrl)).toBe(true)
    await bandal.app.evaluate(async ({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === target)!
      await contents.executeJavaScript('document.querySelector("input[autocomplete=username]").focus()')
    }, loginUrl)
    const accounts = panel.getByRole('combobox', { name: '저장된 로그인 계정 선택' })
    await expect(accounts).toBeVisible()
    await expect(accounts.locator('option')).toHaveCount(3)
    // A later import stylesheet must not restore text over the compact key icon.
    await expect(accounts).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    await expect(accounts).toHaveCSS('appearance', 'none')
    await expect(panel.locator('.browser-login-account-control__icon')).toBeVisible()
    const loginGeometry = await firstAddress.evaluate(element => {
      const toolbar = element.closest<HTMLElement>('.browser-toolbar')!
      return { width: toolbar.clientWidth, content: toolbar.scrollWidth, field: element.getBoundingClientRect().width }
    })
    expect(loginGeometry.content).toBeLessThanOrEqual(loginGeometry.width)
    expect(loginGeometry.field).toBeGreaterThan(40)
    await accounts.selectOption('personal')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { chosenLogin: string }).chosenLogin)).toBe('personal')

    // At the supported minimum window size both sidebars leave tiny splits.
    // Give typing its own row here instead of forcing a near-zero URL field.
    await setViewport('minimum-window', 1024, 800)
    await expect.poll(async () => (await panel.locator('.browser-toolbar').boundingBox())!.height).toBeGreaterThan(44)
    for (const tiny of await page.locator('.browser-panel:visible').all()) {
      const geometry = await tiny.evaluate(element => {
        const toolbar = element.querySelector<HTMLElement>('.browser-toolbar')!
        const address = element.querySelector<HTMLElement>('.browser-address')!
        const input = element.querySelector<HTMLElement>('.browser-address input')!
        return { width: toolbar.clientWidth, content: toolbar.scrollWidth, address: address.getBoundingClientRect().width, input: input.getBoundingClientRect().width }
      })
      expect(geometry.width).toBeLessThanOrEqual(340)
      expect(geometry.content).toBeLessThanOrEqual(geometry.width)
      expect(geometry.address).toBeGreaterThan(150)
      expect(geometry.input).toBeGreaterThan(100)
    }
    const tinyProfile = panel.getByRole('button', { name: '브라우저 프로필', exact: true })
    await expect(tinyProfile).toHaveCSS('width', '32px')
    await expect(tinyProfile).toHaveAccessibleDescription('기본')
    await expect(tinyProfile).toHaveAttribute('title', /브라우저 프로필: 기본/)
    await expect(panel.locator('.browser-login-message')).toHaveText('채움')
    const controls = await panel.evaluate(element => {
      const box = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect().toJSON()
      return { profile: box('.browser-profile-trigger'), key: box('.browser-login-account'), message: box('.browser-login-message') }
    })
    await expect(panel.locator('.browser-assistant-toggle')).toHaveCount(0)
    for (const neighbor of [controls.key, controls.message]) {
      const overlap = controls.profile.left < neighbor.right && controls.profile.right > neighbor.left && controls.profile.top < neighbor.bottom && controls.profile.bottom > neighbor.top
      expect(overlap).toBe(false)
    }
    await capture('browser-chrome-minimum-window.png')
  } finally {
    await bandal.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
