import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('shared chat composer and approvals', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal({ extraSettings: { theme: 'light' } })
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
      handle('agentTools:confirmations', (req) => ((state as any).confirmations ?? []).filter((item: any) => item.request.conversationId === req.conversationId))
      handle('agentTools:respondConfirm', req => { state.permissionCalls++; if (state.permissionCalls === 1) throw new Error('테스트 승인 전송 오류'); const item = (state as any).confirmations.find((item: any) => item.request.requestId === req.requestId); item.status = req.approved ? 'approved' : 'denied'; item.revision += 10; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agentTools:confirmationChanged', item); return { ok: true, state: item } })
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
    await bandal.page.keyboard.press('ControlOrMeta+Shift+A')
    await expect(bandal.page.getByRole('textbox', { name: '메시지 입력' })).toBeVisible()
  })
  test.afterAll(async () => { await bandal?.close() })

  test('model and supported Effort are inside the composer and survive reopening', async ({}, info) => {
    const page = bandal.page
    const composer = page.locator('.chat-composer-zone')
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
    await expect(page.locator('.chat-context-chips:not(.chat-context-auto)')).toContainText('PDF 만들기')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('button', { name: /^과목 자료/ }).click()
    await page.getByRole('dialog', { name: '대화에 추가' }).getByRole('button', { name: /강의 메모.md/ }).click()
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await input.fill('요약 문서를 만들어줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(page.getByRole('alert')).toContainText('테스트 연결 오류')
    await expect(input).toHaveValue('요약 문서를 만들어줘')
    await expect(page.locator('.chat-context-chips:not(.chat-context-auto)')).toContainText('강의 메모.md')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(input).toHaveValue('')
    await expect(page.locator('.chat-composer-zone .chat-context-chip')).toHaveCount(0)
    const sent = await bandal.app.evaluate(() => (globalThis as any).__chatUx.sends.at(-1))
    expect(sent.context.creation).toBe('pdf')
    expect(sent.context.skillIds).toEqual(['pdf-fixture'])
    expect(sent.context.files[0].relPath).toBe('강의 메모.md')
  })

  test('small side approvals preserve typing focus, retry safely, and handle expiry across windows', async ({}, info) => {
    const { page, app } = bandal
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await input.fill('계속 입력하는 메모')
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx
      const request = { requestId: 'site-request', courseId: state.courseId, conversationId: state.sessionId, turnId: `${state.sessionId}:2`, tool: 'browser_access', summary: '학교 사이트의 강의자료를 읽을까요?', details: ['https://example.edu'], scopes: ['once', 'site'] }
      state.confirmations = [ { request, status: 'pending', revision: 1 }, { request: { ...request, requestId: 'next-site-request', summary: '다음 페이지를 읽을까요?' }, status: 'pending', revision: 2 } ]
      for (const window of BrowserWindow.getAllWindows()) for (const confirmation of state.confirmations) window.webContents.send('agentTools:confirmationChanged', confirmation)
    })
    const approval = page.locator('.chat-approval-dock')
    await expect(approval.getByText('학교 사이트의 강의자료를 읽을까요?')).toBeVisible()
    await expect(input).toBeFocused()
    await approval.getByRole('button', { name: '이번만 허용', exact: true }).click()
    await expect(approval.getByRole('alert')).toContainText('응답을 보내지 못했어요')
    await approval.getByRole('button', { name: '이번만 허용', exact: true }).click()
    await expect(approval.getByText('다음 페이지를 읽을까요?')).toBeVisible()
    await expect(approval.getByRole('combobox', { name: '허용 범위' })).toHaveValue('once')
    await approval.screenshot({ path: info.outputPath('approval-companion.png') })
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx, item = state.confirmations[1]
      item.status = 'expired'; item.revision = 20
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agentTools:confirmationChanged', item)
    })
    await expect(approval).toHaveCount(0)
    await expect(input).toHaveValue('계속 입력하는 메모')
  })
})
