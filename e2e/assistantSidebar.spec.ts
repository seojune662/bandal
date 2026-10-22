import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

test('global workspace AI keeps drafts across documents and modes, separates projects, and retains PDF highlights', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const sends: any[] = []; (globalThis as any).__sidebarSends = sends
      const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('chat:open', req => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'fixture', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
      handle('agent:models', () => ({ models: [{ id: 'fixture', displayName: 'Fixture', isDefault: true }] }))
      handle('agent:skills', () => [])
      handle('chat:send', req => { sends.push(req); setTimeout(() => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:event-batch', { courseId: req.courseId, sessionId: req.sessionId, seq: sends.length, events: [{ type: 'turn-started', turnSeq: sends.length }, { type: 'text-final', blockId: 'reply', text: '선택한 원본의 응답입니다.' }, { type: 'turn-complete', stopReason: 'success' }] }) }, 500); return { turnSeq: sends.length } })
    })
    const { page } = bandal
    await createCourse(page, '통합 AI 검사')
    const courseId = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    const dir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    writeFileSync(join(dir, 'first.md'), '# First\n\n첫 번째 자료\n'); writeFileSync(join(dir, 'second.md'), '# Second\n\n두 번째 자료\n')
    const { PDFDocument } = await import('pdf-lib'), pdf = await PDFDocument.create(); pdf.addPage([600, 800]); writeFileSync(join(dir, 'sample.pdf'), await pdf.save())
    const rail = page.getByRole('tablist', { name: '오른쪽 사이드바' }), ai = page.locator('.workspace-assistant:visible')
    const input = ai.getByRole('textbox', { name: '메시지 입력' })
    const open = async (name: string) => { await rail.getByRole('tab', { name: '자료', exact: true }).click(); await page.locator(`[data-material-path="${name}"]`).click(); await rail.getByRole('tab', { name: 'AI', exact: true }).click() }
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await open('first.md'); await expect(input).toBeVisible()
    await expect(page.locator('.tab-assistant,.tab-assistant-toggle')).toHaveCount(0)
    await input.fill('공간 전체의 초안')
    for (const mode of ['퀴즈', '플래시카드', '예상 문제', 'Chat']) { await ai.getByRole('tab', { name: mode, exact: true }).click(); await expect(input).toHaveValue('공간 전체의 초안') }
    await open('second.md'); await expect(input).toHaveValue('공간 전체의 초안'); await expect(ai.locator('.chat-context-auto')).toContainText('second')
    await open('first.md'); await ai.getByRole('button', { name: '메시지 보내기' }).click(); await open('second.md')
    await expect(ai).toContainText('선택한 원본의 응답입니다.')
    const sent = await bandal.app.evaluate(() => (globalThis as any).__sidebarSends[0])
    expect(sent.context.sourcePanelId).toBe(`note:${courseId}:first.md`); expect(sent.context.workspaceKey).toBe(courseId)
    await ai.getByRole('button', { name: '추가', exact: true }).click(); await page.getByRole('button', { name: /^자료 선택/ }).click()
    const picker = page.getByRole('dialog', { name: '대화에 추가' })
    await picker.getByRole('button', { name: /first.md/ }).click(); await picker.getByRole('button', { name: /second.md/ }).click(); await picker.getByRole('button', { name: '선택한 2개 추가' }).click()
    await expect(ai.getByLabel('첨부한 맥락')).toContainText('first.md'); await expect(ai.getByLabel('첨부한 맥락')).toContainText('second')
    await input.fill('과목에서 이어 쓸 초안')
    // Legacy in-course projects remain supported; new typed review spaces use standalone placement.
    await page.evaluate(async courseId => { await window.bandal.invoke('learning:create', { placement: 'in-course', courseId, rootRelPath: 'Project', name: '독립 프로젝트', topic: '자료' }) }, courseId)
    await page.getByRole('tab', { name: '프로젝트', exact: true }).first().click()
    await page.locator('.project-list-row__open').filter({ hasText: '독립 프로젝트' }).click()
    await rail.getByRole('tab', { name: 'AI', exact: true }).click(); await expect(input).toHaveValue('')
    await expect(ai.locator('.chat-context-auto .chat-context-chip')).toHaveCount(0)
    await input.fill('프로젝트 초안')
    await ai.getByRole('tab', { name: '퀴즈', exact: true }).click()
    await page.getByRole('tab', { name: '과목', exact: true }).first().click(); await page.locator('.course-row__select').filter({ hasText: '통합 AI 검사' }).click()
    await expect(input).toHaveValue('과목에서 이어 쓸 초안'); await expect(ai.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true')
    await open('sample.pdf'); await page.locator('.pdf-toolbar__rail-toggle').click(); await expect(page.locator('.pdf-tab .pdf-rail')).toBeVisible()
    await expect(ai.locator('.pdf-rail')).toHaveCount(0); await expect(input).toHaveValue('과목에서 이어 쓸 초안')
    await page.getByRole('button', { name: '오른쪽 사이드바 접기' }).click(); await expect(page.locator('.pdf-tab .pdf-rail')).toBeVisible()
    await page.getByRole('button', { name: '오른쪽 사이드바 펼치기' }).click(); await expect(input).toHaveValue('과목에서 이어 쓸 초안')
    await page.screenshot({ path: info.outputPath('workspace-ai-light.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' })); await page.screenshot({ path: info.outputPath('workspace-ai-dark.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await bandal.close() }
})

test('unsent workspace drafts restore text, multiple materials and annotated image snapshots after restart', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const prepare = async () => {
    await bandal.app.evaluate(({ ipcMain }) => {
      const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('chat:open', req => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'fixture', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
      handle('agent:availability', () => ({ installed: true, loggedIn: true }))
      handle('agent:models', () => ({ models: [{ id: 'fixture', displayName: 'Fixture', isDefault: true }] }))
      handle('agent:skills', () => [])
    })
  }
  try {
    await prepare()
    let page = bandal.page
    await createCourse(page, '재시작 초안')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'source.md'), '# Source\n\nSecond material content.\n')
    const { PDFDocument, StandardFonts } = await import('pdf-lib'), pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([600, 800]).drawText('Persisted annotated PDF source.', { x: 35, y: 730, size: 16, font })
    writeFileSync(join(course.folderPath, 'source.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="source.pdf"]').click()
    await expect(page.locator('.pdf-page:visible .textLayer')).toContainText('Persisted annotated PDF source.')
    await page.getByRole('tablist', { name: '오른쪽 사이드바' }).getByRole('tab', { name: 'AI', exact: true }).click()
    const ai = page.locator('.workspace-assistant:visible')
    await ai.getByRole('textbox', { name: '메시지 입력' }).fill('재시작해도 이어 쓸 요청')
    await ai.getByRole('tab', { name: '플래시카드', exact: true }).click()
    await ai.getByRole('button', { name: '추가', exact: true }).click(); await page.getByRole('button', { name: /^자료 선택/ }).click()
    const picker = page.getByRole('dialog', { name: '대화에 추가' })
    await picker.getByRole('button', { name: /source.md/ }).click(); await picker.getByRole('button', { name: /source.pdf/ }).click(); await picker.getByRole('button', { name: '선택한 2개 추가' }).click()
    await ai.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await page.locator('.pdf-page:visible .textLayer span').filter({ hasText: 'Persisted annotated PDF source.' }).click()
    await ai.getByRole('button', { name: '부분 선택 마치기' }).click()
    await ai.locator('.chat-annotation-reference input').fill('이 표식의 설명도 포함')
    const originalImage = await ai.locator('.chat-annotation-reference img').getAttribute('src')
    expect(originalImage).toMatch(/^data:image\//)
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('bandal-composer-drafts', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
      const rows = await new Promise<any[]>((resolve, reject) => { const req = db.transaction('drafts').objectStore('drafts').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
      db.close(); return rows.some(row => row.text === '재시작해도 이어 쓸 요청' && row.files.length === 2 && row.references?.[0]?.comment === '이 표식의 설명도 포함' && row.references?.[0]?.imageDataUrl)
    })).toBe(true)
    const profileDir = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir }); await prepare(); page = bandal.page
    await page.reload(); await expect(page.locator('aside.app-rail--left:visible')).toBeVisible()
    await page.getByRole('tablist', { name: '오른쪽 사이드바' }).getByRole('tab', { name: 'AI', exact: true }).click()
    const restored = page.locator('.workspace-assistant:visible')
    await expect(restored.getByRole('textbox', { name: '메시지 입력' })).toHaveValue('재시작해도 이어 쓸 요청')
    await expect(restored.getByRole('tab', { name: '플래시카드', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(restored.getByLabel('첨부한 맥락')).toContainText('source.md'); await expect(restored.getByLabel('첨부한 맥락')).toContainText('source.pdf')
    await expect(restored.locator('.chat-annotation-reference')).toContainText('Persisted annotated PDF source.')
    await expect(restored.locator('.chat-annotation-reference input')).toHaveValue('이 표식의 설명도 포함')
    await expect(restored.locator('.chat-annotation-reference img')).toHaveAttribute('src', originalImage!)
  } finally { await bandal.close() }
})
