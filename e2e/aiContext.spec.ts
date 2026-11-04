import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('AI material context and screen selection', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp, courseId: string
  test.beforeAll(async () => {
    bandal = await launchBandal({ extraSettings: { theme: 'light' } })
    await bandal.app.evaluate(({ ipcMain }) => {
      // Provider accounts are covered separately; keep the real context/capture IPC.
      ipcMain.removeHandler('chat:open')
      ipcMain.handle('chat:open', (_event, req) => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'default', status: 'idle', cliSessionId: null, title: null, surface: 'app', lastUsedAt: null } }))
      ipcMain.removeHandler('agent:models')
      ipcMain.handle('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }] }))
    })
    await createCourse(bandal.page, '문맥 검사')
    courseId = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    const folder = readdirSync(bandal.dataRoot)[0]!
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    for (const text of ['First page introduction', 'Second page angular momentum']) pdf.addPage([600, 800]).drawText(text, { x: 40, y: 720, font, size: 18 })
    writeFileSync(join(bandal.dataRoot, folder, 'context.pdf'), await pdf.save())
    writeFileSync(join(bandal.dataRoot, folder, 'context.md'), '# Context\n\nOriginal paragraph\n')
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
  })
  test.afterAll(async () => { await bandal?.close() })
  test('pins the last document/page, includes edited notes, and keeps course context separate', async () => {
    const page = bandal.page
    const snapshot = () => page.evaluate(id => window.bandal.invoke('chat:context', { courseId: id }), courseId)
    await page.locator('[data-material-path="context.pdf"]').click()
    await expect(page.locator('.pdf-page').first()).toBeVisible()
    await page.getByRole('textbox', { name: '페이지 이동' }).fill('2')
    await page.getByRole('textbox', { name: '페이지 이동' }).press('Enter')
    await expect.poll(async () => (await snapshot()).material?.text).toContain('angular momentum')
    expect((await snapshot()).material).toMatchObject({ page: 2, relPath: 'context.pdf' })
    const missing = await page.evaluate(id => window.bandal.invoke('chat:context', { courseId: id, sourcePanelId: 'closed-source-panel' }), courseId)
    expect(missing.refresh).toBe('failed'); expect(missing.material).toBeUndefined()
    await page.keyboard.press('ControlOrMeta+Shift+A')
    await expect(page.getByRole('textbox', { name: '메시지 입력' })).toBeVisible()
    expect((await snapshot()).material).toMatchObject({ page: 2, relPath: 'context.pdf' })
    await expect(page.locator('.chat-context-auto')).toContainText('context.pdf · 2쪽')
    await page.locator('[data-material-path="context.md"]').click()
    const editor = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(editor).toBeVisible()
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Updated before question')
    await expect.poll(async () => (await snapshot()).material?.text).toContain('Updated before question')
    await createCourse(page, '다른 과목')
    expect((await snapshot()).courseId).toBe(courseId)
    expect((await snapshot()).material?.relPath).toBe('context.md')
  })
  test('region cancellation preserves the draft; selection attaches only the cropped image', async ({}, info) => {
    const page = bandal.page
    await page.keyboard.press('ControlOrMeta+Shift+A')
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await expect(input).toBeVisible(); await input.fill('선택한 그림 설명해줘')
    await bandal.app.evaluate(({ desktopCapturer, screen, nativeImage, systemPreferences }) => {
      // Exercise the real selection windows and crop path without requiring OS access.
      systemPreferences.getMediaAccessStatus = () => 'granted'
      desktopCapturer.getSources = async () => screen.getAllDisplays().map(d => ({ id: `screen:${d.id}:0`, display_id: String(d.id), name: 'Fixture display', appIcon: null,
        thumbnail: nativeImage.createFromBitmap(Buffer.from([255, 255, 255, 255]), { width: 1, height: 1 }).resize({ width: Math.round(d.bounds.width * 2), height: Math.round(d.bounds.height * 2) }) }))
    })
    const openCapture = async () => {
      await page.getByRole('button', { name: '추가', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '대화에 추가' })).toBeVisible()
      const next = bandal.app.waitForEvent('window', { predicate: p => p.url().includes('view=capture') || p.url() === '' })
      await page.getByRole('button', { name: '영역 선택해서 질문', exact: true }).click()
      const capture = await next; await expect(capture.locator('.screen-selection')).toBeVisible(); return capture
    }
    const cancelled = await openCapture(); await cancelled.keyboard.press('Escape').catch(error => { if (!cancelled.isClosed()) throw error })
    if (process.platform === 'darwin') expect(await bandal.app.evaluate(({ app }) => app.dock?.isVisible())).toBe(true)
    await expect(input).toHaveValue('선택한 그림 설명해줘')
    expect(await page.locator('.chat-attachment img').count()).toBe(0)
    const capture = await openCapture()
    await capture.mouse.move(100, 100); await capture.mouse.down(); await capture.mouse.move(300, 250); await capture.mouse.up().catch(error => { if (!capture.isClosed()) throw error })
    await expect(page.locator('.chat-attachment img').first()).toBeVisible()
    const dimensions = await page.locator('.chat-attachment img').first().evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))
    expect(dimensions).toEqual({ width: 400, height: 300 })
    if (process.platform === 'darwin') expect(await bandal.app.evaluate(({ app }) => app.dock?.isVisible())).toBe(true)
    await expect(input).toHaveValue('선택한 그림 설명해줘')
    await page.screenshot({ path: info.outputPath('capture-preview.png') })
  })
})
