import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('shared chat composer and approvals', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal({ extraSettings: { assistantMode: 'desktop', theme: 'light' } })
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const configs = new Map<string, { model: string; effort: string | null }>()
      const state = { configs, sends: [] as any[], failSend: true, permissionCalls: 0, seq: 0, courseId: '', sessionId: '' }
      ;(globalThis as any).__chatUx = state
      const handle = (channel: string, fn: (req: any) => any): void => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('chat:open', (req) => {
        state.courseId = req.courseId; state.sessionId = req.sessionId
        return { availability: { installed: true, loggedIn: true }, history: [], sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: configs.get(req.sessionId)?.model ?? 'model-a', effort: configs.get(req.sessionId)?.effort ?? null, status: 'idle', cliSessionId: null, title: null, surface: req.surface ?? 'app', lastUsedAt: null } }
      })
      handle('agent:models', () => ({ models: [{ id: 'model-a', displayName: 'Model A', isDefault: true, supportedEfforts: ['low', 'high'] }, { id: 'model-b', displayName: 'Model B', isDefault: false }] }))
      handle('chat:setConfiguration', (req) => { configs.set(req.sessionId, req); for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:configurationChanged', req); return { model: req.model, effort: req.effort } })
      handle('agent:skills', () => [{ id: 'pdf-fixture', name: 'PDF', description: 'PDF 생성 스킬', creationKinds: ['pdf'] }])
      handle('chat:send', (req) => {
        state.sends.push(req)
        if (state.failSend) { state.failSend = false; throw new Error('테스트 연결 오류') }
        const batch = { courseId: req.courseId, sessionId: req.sessionId, seq: ++state.seq, events: [{ type: 'turn-started', turnSeq: 1 }, { type: 'text-final', blockId: 'reply', text: '확인했어요.' }, { type: 'turn-complete', stopReason: 'success' }] }
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', batch)
        return { turnSeq: 1 }
      })
      handle('agentTools:confirmations', () => [])
      handle('chat:respondPermission', (req) => {
        state.permissionCalls++
        if (state.permissionCalls === 1) throw new Error('테스트 승인 전송 오류')
        const batch = { courseId: req.courseId, sessionId: req.sessionId, seq: ++state.seq, events: [{ type: 'permission-resolved', requestId: req.requestId, behavior: req.response.behavior }] }
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', batch)
        return { ok: true }
      })
    })
    await createCourse(bandal.page, 'AI 화면 검사')
    const folder = readdirSync(bandal.dataRoot)[0]!
    writeFileSync(join(bandal.dataRoot, folder, '강의 메모.md'), '# 강의 메모\n')
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
    await bandal.page.keyboard.press('Meta+Shift+A')
    await expect(bandal.page.getByRole('textbox', { name: '메시지 입력' })).toBeVisible()
  })
  test.afterAll(async () => { await bandal?.close() })

  test('model and supported Effort are inside the composer and survive reopening', async ({}, info) => {
    const page = bandal.page
    const composer = page.locator('.chat-composer')
    await composer.getByRole('button', { name: '모델 및 Effort 설정' }).click()
    await page.getByRole('combobox', { name: 'AI Effort 선택' }).selectOption('high')
    await expect(composer.getByRole('button', { name: '모델 및 Effort 설정' })).toContainText('high')
    await page.keyboard.press('Escape')
    await composer.getByRole('button', { name: '모델 및 Effort 설정' }).click()
    await expect(page.getByRole('combobox', { name: 'AI Effort 선택' })).toHaveValue('high')
    await page.screenshot({ path: info.outputPath('chat-model-light.png') })
    await page.getByRole('combobox', { name: 'AI 모델 선택' }).selectOption('model-b')
    await expect(page.getByRole('combobox', { name: 'AI Effort 선택' })).toBeDisabled()
    await expect(page.getByRole('combobox', { name: 'AI Effort 선택' })).toHaveValue('')
    await page.keyboard.press('Escape')
  })

  test('Add selects files and generation skills; failed sends preserve the draft', async ({}, info) => {
    const page = bandal.page
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await expect(page.getByRole('button', { name: /PDF 만들기/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /이미지 만들기/ })).toBeDisabled()
    await page.screenshot({ path: info.outputPath('chat-add-light.png') })
    await page.getByRole('button', { name: /PDF 만들기/ }).click()
    await expect(page.locator('.chat-context-chips')).toContainText('PDF 만들기')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: /^과목 자료/ }).click()
    await page.getByRole('dialog', { name: '대화에 추가' }).getByRole('button', { name: /강의 메모.md/ }).click()
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await input.fill('요약 문서를 만들어줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(page.getByRole('alert')).toContainText('테스트 연결 오류')
    await expect(input).toHaveValue('요약 문서를 만들어줘')
    await expect(page.locator('.chat-context-chips')).toContainText('강의 메모.md')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(input).toHaveValue('')
    await expect(page.locator('.chat-composer-zone .chat-context-chip')).toHaveCount(0)
    const sent = await bandal.app.evaluate(() => (globalThis as any).__chatUx.sends.at(-1))
    expect(sent.context.creation).toBe('pdf')
    expect(sent.context.skillIds).toEqual(['pdf-fixture'])
    expect(sent.context.files[0].relPath).toBe('강의 메모.md')
  })

  test('permission failures can be retried; expiry clears queued approvals without taking typing focus', async ({}, info) => {
    const { page, app } = bandal
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await input.fill('계속 입력하는 메모')
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx
      const request = { requestId: 'site-request', courseId: state.courseId, conversationId: state.sessionId, turnId: `${state.sessionId}:2`, tool: 'browser_access', summary: '학교 사이트의 강의자료를 읽을까요?', details: ['https://example.edu'], scopes: ['once', 'site'] }
      state.request = request
      state.nextRequest = { ...request, requestId: 'next-site-request', summary: '다음 페이지를 읽을까요?' }
      const page = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('index.html'))!
      page.webContents.send('agentTools:confirmationChanged', { request, status: 'pending', revision: 1 })
      page.webContents.send('agentTools:confirmationChanged', { request: state.nextRequest, status: 'pending', revision: 2 })
      page.webContents.send('chat:event-batch', { courseId: state.courseId, sessionId: state.sessionId, seq: ++state.seq, events: [{ type: 'turn-started', turnSeq: 2 }, { type: 'permission-request', requestId: 'cli-request', toolName: 'Read', input: { file_path: '강의 메모.md' } }] })
    })
    await expect(input).toBeFocused()
    await expect(page.locator('.chat-approval-dock')).toContainText('승인 대기 3개')
    await page.getByRole('button', { name: '이번만 허용', exact: true }).click()
    await expect(page.locator('.chat-approval-dock').getByRole('alert')).toContainText('응답을 보내지 못했어요')
    await page.getByRole('button', { name: '이번만 허용', exact: true }).click()
    await expect(page.locator('.chat-approval-dock')).toContainText('학교 사이트')
    await page.screenshot({ path: info.outputPath('chat-approval-light.png') })
    await page.getByRole('combobox', { name: '허용 범위' }).selectOption('site')
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx
      for (const page of BrowserWindow.getAllWindows()) page.webContents.send('agentTools:confirmationChanged', { request: state.request, status: 'expired', revision: 3 })
    })
    await expect(page.locator('.chat-approval-dock')).toContainText('다음 페이지')
    await expect(page.getByRole('combobox', { name: '허용 범위' })).toHaveValue('once')
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx
      for (const page of BrowserWindow.getAllWindows()) page.webContents.send('agentTools:confirmationChanged', { request: state.nextRequest, status: 'expired', revision: 4 })
    })
    await expect(page.locator('.chat-approval-dock')).toHaveCount(0)
    await page.getByText('작업 기록', { exact: true }).last().click()
    await expect(page.getByText('시간 초과', { exact: true }).first()).toBeVisible()
    await expect(input).toHaveValue('계속 입력하는 메모')
  })

  test('in-app and desktop orb menus stay in bounds and Escape closes only the menu', async ({}, info) => {
    const { page, app } = bandal
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await page.locator('.assistant-orb').click()
    const popup = page.locator('.assistant-popup')
    await expect(popup).toBeVisible()
    await popup.getByRole('button', { name: '모델 및 Effort 설정' }).click()
    await expect(page.getByRole('dialog', { name: 'AI 실행 설정' })).toBeVisible()
    const orbBounds = await popup.boundingBox()
    const modelBounds = await page.getByRole('dialog', { name: 'AI 실행 설정' }).boundingBox()
    expect(modelBounds!.x).toBeGreaterThanOrEqual(orbBounds!.x)
    expect(modelBounds!.x + modelBounds!.width).toBeLessThanOrEqual(orbBounds!.x + orbBounds!.width)
    await page.screenshot({ path: info.outputPath('orb-model-dark.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'AI 실행 설정' })).toHaveCount(0)
    await expect(popup).toBeVisible()
    await popup.getByRole('textbox', { name: '메시지 입력' }).fill('@')
    await expect(popup.getByRole('listbox', { name: '과목 파일' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup.getByRole('listbox')).toHaveCount(0)
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    const courseId = await app.evaluate(() => (globalThis as any).__chatUx.courseId)
    await page.evaluate((id) => window.bandal.invoke('overlay:setCourse', { courseId: id }), courseId)
    await page.evaluate(() => window.bandal.invoke('overlay:togglePopup', { open: true }))
    const desktop = app.windows().find((candidate) => candidate.url().includes('overlay.html?view=popup'))!
    await expect(desktop.getByRole('button', { name: '모델 및 Effort 설정' })).toBeVisible()
    await desktop.getByRole('button', { name: '추가', exact: true }).click()
    const menu = desktop.getByRole('dialog', { name: '대화에 추가' })
    await expect(menu).toBeVisible()
    const dimensions = await menu.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight } })
    expect(dimensions.left).toBeGreaterThanOrEqual(0); expect(dimensions.top).toBeGreaterThanOrEqual(0)
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.w); expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.h)
    await desktop.screenshot({ path: info.outputPath('desktop-add-dark.png') })
    await desktop.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('overlay.html?view=popup'))?.isVisible())).toBe(true)
    const sessionId = await app.evaluate(() => [...(globalThis as any).__chatUx.configs.keys()][0])
    await page.evaluate((ids) => window.bandal.invoke('overlay:setConversation', ids), { courseId, conversationId: sessionId })
    await expect(desktop.getByRole('button', { name: '모델 및 Effort 설정' })).toContainText('Model B')
    await page.evaluate((ids) => window.bandal.invoke('chat:setConfiguration', { ...ids, model: 'model-a', effort: 'high' }), { courseId, sessionId })
    await expect(desktop.getByRole('button', { name: '모델 및 Effort 설정' })).toContainText('high')
    await expect(page.locator('.chat-tab[data-variant="tab"]').getByRole('button', { name: '모델 및 Effort 설정' })).toContainText('high')
  })
})
