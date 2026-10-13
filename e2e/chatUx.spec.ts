import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../src/shared/types/agent-events'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const AERODYNAMICS_REPLY = String.raw`# 항공역학 지배방정식

이 페이지의 세 식은 **질량·운동량·에너지 보존**을 나타냅니다. 밀도는 \(\rho\), 속도는 \(\mathbf{V}\)로 표현해요.

## 질량 보존

\[
\frac{\partial \rho}{\partial t}+\nabla\cdot(\rho\mathbf{V})=0
\]

> 질량은 생성되거나 사라지지 않습니다.

| 수식 | 의미 |
| --- | --- |
| \(\displaystyle \frac{\partial \rho}{\partial t}+\nabla\cdot(\rho\mathbf{V})=0\) | 질량보존식(연속방정식) |
| \(\displaystyle \frac{\partial(\rho\mathbf{V})}{\partial t}+\nabla\cdot(\rho\mathbf{V}\mathbf{V})=-\nabla p+\nabla\cdot\boldsymbol{\tau}+\rho\mathbf{f}\) | 운동량보존식 |
| 에너지 변화 = 압력일 + 점성일 + 열 + 외력의 일 | 에너지보존식 |

## 오일러 방정식과의 관계

- 점성응력 \(\boldsymbol{\tau}\)를 포함하면 나비에–스토크스 방정식이에요.
  - 점성을 무시하면 오일러 방정식으로 단순화됩니다.
- 압축성, 점성, 난류는 유동을 설명하는 중요한 특성입니다.

\[
\boxed{\text{Euler} = \text{Navier–Stokes} - \text{viscosity}}
\]

따라서 두 방정식은 서로 별개가 아니라, 점성 효과를 포함하는지에 따라 연결됩니다.`

test.describe('shared chat composer, readable replies and confirmations', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal({ extraSettings: { theme: 'light' } })
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const configs = new Map<string, { model: string; effort: string | null }>()
      const state = { configs, sends: [] as any[], failSend: true, streamNext: false, turnSeq: 0, permissionCalls: 0, seq: 0, courseId: '', sessionId: '' }
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
        const turnSeq = ++state.turnSeq
        const events = state.streamNext
          ? [{ type: 'turn-started', turnSeq }, { type: 'thinking-delta', blockId: 'private-thought', text: 'INTERNAL_REASONING_FIXTURE: inspect the raw PDF and CLI configuration.' }]
          : [{ type: 'turn-started', turnSeq }, { type: 'text-final', blockId: `reply-${turnSeq}`, text: '확인했어요.' }, { type: 'turn-complete', stopReason: 'success' }]
        state.streamNext = false
        const batch = { courseId: req.courseId, sessionId: req.sessionId, seq: ++state.seq, events }
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', batch)
        return { turnSeq }
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

  const emitEvents = async (events: AgentEvent[]): Promise<void> => {
    await bandal.app.evaluate(({ BrowserWindow }, pendingEvents) => {
      const state = (globalThis as any).__chatUx
      const seq = ++state.seq
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', {
        courseId: state.courseId, sessionId: state.sessionId, seq, events: pendingEvents
      })
    }, events)
  }

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

  test('streaming shows one friendly status and renders readable math and tables when complete', async ({}, info) => {
    const { page, app } = bandal
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    const chat = page.locator('.chat-tab:visible')
    await app.evaluate(() => { (globalThis as any).__chatUx.streamNext = true })
    await input.fill('이 페이지의 수식을 설명해줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(chat.locator('.chat-response-status')).toHaveCount(1)
    await expect(chat.locator('.chat-response-status')).toContainText('생각 중')
    await expect(chat).not.toContainText('INTERNAL_REASONING_FIXTURE')
    await input.fill('다음 질문을 작성하는 중')
    await emitEvents([{
      type: 'tool-start', toolCallId: 'raw-command', toolName: 'Bash',
      label: "/bin/zsh -lc 'cat .bandal/COURSE.md'",
      input: { command: "/bin/zsh -lc 'cat .bandal/COURSE.md'" }
    }])
    await expect(chat.locator('.chat-response-status')).toHaveCount(1)
    await expect(chat.locator('.chat-response-status')).toContainText('자료를 살펴보는 중')
    await expect(chat).not.toContainText('/bin/zsh')
    await expect(chat).not.toContainText('COURSE.md')
    await expect(chat.locator('.chat-tool, .chat-thinking, .chat-approval-dock')).toHaveCount(0)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('다음 질문을 작성하는 중')
    await page.screenshot({ path: info.outputPath('chat-reading-light.png') })

    await emitEvents([
      { type: 'tool-end', toolCallId: 'raw-command', ok: true, result: { summary: 'cat .bandal/COURSE.md', preview: 'RAW_TOOL_OUTPUT_FIXTURE' } },
      { type: 'text-delta', blockId: 'aerodynamics', text: String.raw`# 항공역학 지배방정식

이 페이지의 세 식은 **질량·운동량·에너지 보존**을 나타냅니다.

\[
\frac{\partial \rho}{\partial` }
    ])
    await expect(chat.locator('.chat-response-status')).toContainText('답변 작성 중')
    await expect(chat).not.toContainText('RAW_TOOL_OUTPUT_FIXTURE')
    await expect(chat.locator('.chat-md__math--pending')).toContainText('수식 작성 중')
    await expect(chat.locator('.katex-error')).toHaveCount(0)
    await expect(chat).not.toContainText('\\frac')
    await emitEvents([
      { type: 'text-final', blockId: 'aerodynamics', text: AERODYNAMICS_REPLY },
      { type: 'turn-complete', stopReason: 'success' }
    ])
    const reply = chat.locator('.chat-msg--assistant').last()
    await expect(chat.locator('.chat-response-status')).toHaveCount(0)
    await expect(reply.getByRole('table')).toBeVisible()
    await expect(reply.getByRole('columnheader')).toHaveText(['수식', '의미'])
    await expect(reply.getByRole('row')).toHaveCount(4)
    await expect.poll(() => reply.locator('.katex').count()).toBeGreaterThanOrEqual(7)
    await expect(reply.locator('.katex-error')).toHaveCount(0)
    await expect(reply.locator('.katex-display')).toHaveCount(2)
    await expect(reply.getByRole('button', { name: '답변 복사' })).toBeVisible()
    await expect(reply.locator('ul ul')).toHaveCount(1)
    await expect(input).toHaveValue('다음 질문을 작성하는 중')
    await page.evaluate(() => document.fonts.ready)
    expect(await chat.locator('.chat-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

    const scroller = chat.locator('.chat-scroll')
    await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    await expect(chat.getByRole('button', { name: '최신 답변으로 이동' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('chat-math-light.png') })
    await chat.getByRole('button', { name: '최신 답변으로 이동' }).click()
    await expect(chat.getByRole('button', { name: '최신 답변으로 이동' })).toHaveCount(0)
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await page.screenshot({ path: info.outputPath('chat-math-dark.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
  })

  test('explicit confirmation fallback stays inline, preserves typing and handles retry and expiry', async ({}, info) => {
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
    await expect(page.locator('.chat-approval-side')).toHaveCount(0)
    expect(await approval.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(210)
    await expect(input).toBeFocused()
    await approval.getByRole('button', { name: '계속', exact: true }).click()
    await expect(approval.getByRole('alert')).toContainText('응답을 보내지 못했어요')
    await approval.getByRole('button', { name: '계속', exact: true }).click()
    await expect(approval.getByText('다음 페이지를 읽을까요?')).toBeVisible()
    await expect(approval.getByRole('combobox', { name: '허용 범위' })).toHaveValue('once')
    await approval.screenshot({ path: info.outputPath('approval-inline.png') })
    await app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__chatUx, item = state.confirmations[1]
      item.status = 'expired'; item.revision = 20
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agentTools:confirmationChanged', item)
    })
    await expect(approval).toHaveCount(0)
    await expect(input).toHaveValue('계속 입력하는 메모')
    await input.focus()

    await emitEvents([
      { type: 'turn-started', turnSeq: 3 },
      { type: 'permission-request', requestId: 'explicit-provider-request', toolName: 'Bash', input: { command: "/bin/zsh -lc 'cat .bandal/COURSE.md'" } }
    ])
    await expect(approval).toBeVisible()
    await expect(approval).not.toContainText('/bin/zsh')
    await expect(approval).not.toContainText('COURSE.md')
    await expect(approval.locator('pre')).toHaveCount(0)
    await expect(input).toBeFocused()
    await approval.getByRole('button', { name: '계속', exact: true }).click()
    await expect(approval).toHaveCount(0)
    await expect(page.locator('.chat-thread')).not.toContainText('/bin/zsh')
    await emitEvents([{ type: 'turn-complete', stopReason: 'success' }])
  })

  test('material sidebar keeps long equations inside a readable scrolling table', async ({}, info) => {
    const { page, app } = bandal
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setSize(1440, 900))
    await page.locator('[data-material-path="강의 메모.md"]').click()
    await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    const sidebar = page.locator('.tab-assistant:visible')
    const input = sidebar.getByRole('textbox', { name: '메시지 입력' })
    await expect(input).toBeVisible()
    await emitEvents([
      { type: 'turn-started', turnSeq: 4 },
      { type: 'text-final', blockId: 'sidebar-equations', text: AERODYNAMICS_REPLY },
      { type: 'turn-complete', stopReason: 'success' }
    ])
    const table = sidebar.getByRole('table')
    await expect(table).toBeVisible()
    await expect(sidebar.locator('.katex-error')).toHaveCount(0)
    expect(await sidebar.locator('.chat-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(await sidebar.locator('.chat-md__table-wrap').evaluate(element => element.getBoundingClientRect().right <= element.closest('.tab-assistant')!.getBoundingClientRect().right)).toBe(true)
    await input.fill('다음 질문')
    await sidebar.locator('.chat-scroll').evaluate(element => {
      const table = element.querySelector('table')!
      element.scrollTop += table.getBoundingClientRect().top - element.getBoundingClientRect().top - 12
      element.dispatchEvent(new Event('scroll'))
    })
    await page.screenshot({ path: info.outputPath('chat-sidebar-math-light.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await page.screenshot({ path: info.outputPath('chat-sidebar-math-dark.png') })
  })
})
