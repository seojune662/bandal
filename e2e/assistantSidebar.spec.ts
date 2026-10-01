import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test('per-tab AI keeps drafts, exact source, duplicates, highlights and expanded conversation', async ({}, info) => {
  let bandal: BandalApp = await launchBandal({ keepProfileOnClose: true, extraSettings: { theme: 'light' } })
  const mockChat = async () => bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
    const sends: any[] = []; (globalThis as any).__sidebarSends = sends
    const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
    handle('chat:open', req => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'default', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
    handle('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }] }))
    handle('chat:send', req => { sends.push(req); setTimeout(() => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:event-batch', { courseId: req.courseId, sessionId: req.sessionId, seq: 1, events: [{ type: 'turn-started', turnSeq: 1 }, { type: 'text-final', blockId: 'reply', text: '원래 탭의 응답입니다.' }, { type: 'turn-complete', stopReason: 'success' }] }) }, 600); return { turnSeq: 1 } })
  })
  try {
    await mockChat()
    const { page } = bandal
    await createCourse(page, '패널 회귀 검사')
    const courseId = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    const dir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    writeFileSync(join(dir, 'first.md'), '# First\n\n첫 번째 자료\n')
    writeFileSync(join(dir, 'second.md'), '# Second\n\n두 번째 자료\n')
    const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); writeFileSync(join(dir, 'sample.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    const open = async (name: string) => { await page.locator(`[data-material-path="${name}"]`).click(); await expect(page.locator('.tab-assistant-toggle:visible')).toBeVisible() }
    const ai = () => page.locator('.tab-assistant:visible')
    const input = () => ai().getByRole('textbox', { name: '메시지 입력' })
    await open('first.md')
    await expect(ai()).toHaveCount(0)
    await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    await expect(input()).toBeVisible(); await input().fill('첫 자료의 초안')
    await expect(ai().locator('.chat-context-auto')).toContainText('first.md')
    await ai().getByRole('button', { name: 'AI 보조 사이드바 접기' }).click()
    await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    await expect(input()).toHaveValue('첫 자료의 초안')
    await open('second.md'); await expect(ai()).toHaveCount(0)
    await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    await expect(input()).toHaveValue(''); await input().fill('두 번째 초안')
    await open('first.md'); await expect(input()).toHaveValue('첫 자료의 초안')
    await ai().getByRole('button', { name: '메시지 보내기' }).click()
    await open('second.md'); await expect(input()).toHaveValue('두 번째 초안')
    await open('first.md'); await expect(ai()).toContainText('원래 탭의 응답입니다.')
    const sent = await bandal.app.evaluate(() => (globalThis as any).__sidebarSends[0])
    expect(sent.context.sourcePanelId).toBe(`note:${courseId}:first.md`)
    await input().fill('크게 이어 쓸 초안')
    await ai().getByRole('button', { name: 'AI 대화 크게 열기' }).click()
    await expect(page.locator('.chat-tab[data-variant="tab"]:visible').getByRole('textbox', { name: '메시지 입력' })).toHaveValue('크게 이어 쓸 초안')
    await expect(page.locator('.chat-tab[data-variant="tab"]:visible')).toContainText('원래 탭의 응답입니다.')
    await open('first.md')
    await page.locator('.dv-tab:visible').filter({ hasText: 'first' }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: '탭 복제', exact: true }).click()
    await expect(ai()).toHaveCount(0)
    await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    await expect(input()).toHaveValue('')
    await input().fill('복제한 탭의 독립 초안')
    const layout = () => page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), courseId)
    await expect.poll(async () => Object.values((await layout()).layout?.panels ?? {}).filter((p: any) => p.params.assistant).length).toBeGreaterThanOrEqual(3)
    const saved: any = (await layout()).layout
    const original = saved.panels[`note:${courseId}:first.md`].params.assistant
    const duplicate: any = Object.values(saved.panels).find((p: any) => p.id?.includes('duplicate') || (p.params.descriptor.payload.relPath === 'first.md' && p.params.assistant?.conversationId !== original.conversationId))
    expect(duplicate.params.assistant.conversationId).not.toBe(original.conversationId)
    await page.keyboard.press('ControlOrMeta+w'); await page.keyboard.press('ControlOrMeta+Shift+t')
    await expect(input()).toHaveValue('복제한 탭의 독립 초안')
    await open('sample.pdf'); await page.getByRole('button', { name: 'AI 보조 사이드바 펼치기' }).click()
    await expect(ai().getByRole('tab', { name: '✦ AI', exact: true })).toHaveAttribute('aria-selected', 'true')
    await ai().getByRole('tab', { name: '하이라이트', exact: true }).click()
    await expect(ai().locator('.pdf-rail')).toBeVisible()
    await ai().getByRole('tab', { name: '✦ AI', exact: true }).click()
    await page.screenshot({ path: info.outputPath('sidebar-light.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await page.screenshot({ path: info.outputPath('sidebar-dark.png') })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!.setSize(1024, 640))
    await expect(page.locator('.tab-with-assistant:visible')).toHaveAttribute('data-assistant-overlay', 'true')
    await expect(ai()).toHaveAttribute('role', 'dialog')
    await expect(ai().getByRole('button', { name: 'AI 보조 사이드바 접기' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('sidebar-minimum-window.png') })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!.setSize(1280, 800))

    await expect(page.locator('.assistant-orb')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const profile = bandal.profileDir
    await bandal.close(); bandal = await launchBandal({ reuseProfileDir: profile }); await mockChat()
    await expect(bandal.page.locator('.tab-assistant:visible')).toBeVisible()
    const restored: any = await bandal.page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), courseId)
    expect(restored.layout.panels[`note:${courseId}:first.md`].params.assistant.conversationId).toBe(original.conversationId)
  } finally { await bandal.close() }
})
