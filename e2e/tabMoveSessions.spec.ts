import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { wavHeader } from '../src/main/features/recordings/recordingRepo'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const folder = (page: Page, name: string): Locator => page.locator('.course-row').filter({ has: page.locator('.course-row__name', { hasText: new RegExp(`^${name}$`) }) })
const activeTab = (page: Page): Locator => page.locator('.workspace-course:not([hidden]) .dv-active-tab')
const content = (page: Page): Locator => page.locator('.workspace-panel-content:visible')

/** Real pointer drag: folder hover switches course while the mouse remains down. */
async function moveToCourse(page: Page, tab: Locator, target: string): Promise<void> {
  const title = await tab.locator('.workspace-tab__title').innerText()
  await page.evaluate(() => {
    const trace: unknown[] = []; (window as any).__sessionMoveTrace = trace
    for (const type of ['dragstart', 'dragend', 'drop', 'blur']) window.addEventListener(type, event => {
      trace.push({ type, target: event.target === window ? 'window' : (event.target as Element)?.className, dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging') })
      if (trace.length > 30) trace.shift()
    }, true)
  })
  const source = (await tab.boundingBox())!, destination = (await folder(page, target).boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 4 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.mouse.move(destination.x + Math.min(80, destination.width / 2), destination.y + destination.height / 2, { steps: 14 })
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.mouse.move(destination.x + Math.min(80, destination.width / 2) + i % 2, destination.y + destination.height / 2)
  }
  await expect(folder(page, target)).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.workspace-host')).toHaveAttribute('data-tab-dragging', 'true')
  const bounds = (await page.locator('.workspace-course:not([hidden])').boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 16 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.mouse.move(bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2)
  await expect(page.locator('.course-tab-move-preview')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
  try {
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^${title}$`) }) })).toBeVisible()
  } catch (error) {
    throw new Error(`${String(error)}\n${JSON.stringify(await page.evaluate(() => ({ trace: (window as any).__sessionMoveTrace, panels: [...document.querySelectorAll('.workspace-panel-content')].map(element => ({ instance: element.getAttribute('data-panel-instance'), placement: element.getAttribute('data-content-course'), hidden: (element as HTMLElement).hidden })), tabs: [...document.querySelectorAll('.workspace-course:not([hidden]) .workspace-tab__title')].map(element => element.textContent) })))}`)
  }
}
async function pair(page: Page, label: string) {
  await createCourse(page, `${label} 출발`); await createCourse(page, `${label} 도착`)
  const all = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
  const source = all.find(course => course.name === `${label} 출발`)!, target = all.find(course => course.name === `${label} 도착`)!
  await folder(page, source.name).locator('.course-row__select').click()
  return { source, target }
}
async function binding(page: Page, courseId: string, kind: string): Promise<any> {
  return page.evaluate(async ({ courseId, kind }) => {
    const { layout } = await window.bandal.invoke('layout:get', { courseId })
    return Object.values((layout as any)?.panels ?? {}).map((panel: any) => panel.params.descriptor).find((descriptor: any) => descriptor.kind === kind) ?? null
  }, { courseId, kind })
}
async function runGuest(bandal: BandalApp, id: number, code: string): Promise<any> {
  return bandal.app.evaluate(async ({ webContents }, { id, code }) => webContents.fromId(id)!.executeJavaScript(code, true), { id, code })
}

test('moving a plugin panel preserves its live guest, page token and unsaved draft', async () => {
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal, { source, target } = await pair(page, '플러그인 이동')
    await page.evaluate(async path => {
      await window.bandal.invoke('plugins:installFromFolder', { path })
      await window.bandal.invoke('plugins:approve', { id: 'bandal.word-count' })
      await window.bandal.invoke('plugins:setEnabled', { id: 'bandal.word-count', enabled: true })
    }, resolve(__dirname, '..', 'examples', 'plugins', 'word-count'))
    await page.getByRole('button', { name: '새 탭 열기' }).click()
    const menu = page.getByRole('dialog', { name: '새 탭 열기' })
    await menu.getByLabel('새 탭 검색').fill('단어 수')
    await menu.getByRole('option', { name: '단어 수 단어 수', exact: true }).click()
    const guestUrl = 'bandal-plugin://bandal.word-count/ui/index.html'
    await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url && !wc.isLoading())?.id ?? null, guestUrl)).not.toBeNull()
    const guestId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, guestUrl)
    const instanceId = await content(page).getAttribute('data-panel-instance')
    await page.evaluate(() => { (window as any).__movedPlugin = document.querySelector('.plugin-panel webview') })
    await runGuest(bandal, guestId, `window.moveToken = 'same-live-plugin'; document.body.insertAdjacentHTML('beforeend', '<textarea id="move-draft">플러그인 안의 저장 전 초안</textarea>'); window.originalDraftNode = document.querySelector('#move-draft');`)
    await moveToCourse(page, activeTab(page), target.name)
    expect(await content(page).getAttribute('data-panel-instance')).toBe(instanceId)
    expect(await page.evaluate(() => (window as any).__movedPlugin === document.querySelector('.plugin-panel webview'))).toBe(true)
    expect(await runGuest(bandal, guestId, `({ token: window.moveToken, draft: document.querySelector('#move-draft').value, sameNode: window.originalDraftNode === document.querySelector('#move-draft') })`)).toEqual({ token: 'same-live-plugin', draft: '플러그인 안의 저장 전 초안', sameNode: true })
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, guestId)).toBe(false)
    await expect.poll(() => binding(page, target.id, 'plugin-panel')).toMatchObject({ payload: { pluginId: 'bandal.word-count' } })
    await folder(page, source.name).locator('.course-row__select').click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(0)
  } finally { await bandal.close() }
})

test('moving a streaming chat retains its draft, pending approval and original course/session', async () => {
  const bandal = await launchBandal()
  try {
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = { opens: [] as any[], sends: [] as any[], closes: [] as any[], approvals: [] as any[], confirmations: [] as any[], seq: 0, courseId: '', sessionId: '' }
      ;(globalThis as any).__movingChat = state
      const handle = (name: string, fn: (req: any) => any): void => { ipcMain.removeHandler(name); ipcMain.handle(name, (_event, req) => fn(req)) }
      const broadcast = (name: string, payload: unknown): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(name, payload) }
      handle('agent:availability', () => ({ installed: true, loggedIn: true, version: '2.1.286' }))
      handle('agent:models', () => ({ models: [{ id: 'fixture-model', displayName: '이동 검사 모델', isDefault: true }], source: 'live', status: 'ready' }))
      handle('agent:skills', () => [])
      handle('chat:open', req => { state.opens.push(req); state.courseId = req.courseId; state.sessionId = req.sessionId; return { eventSeq: state.seq, availability: { installed: true, loggedIn: true }, history: [], pendingPermissions: [], sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'fixture-model', effort: null, status: 'idle', cliSessionId: null, title: null, surface: req.surface ?? 'app', lastUsedAt: null } } })
      handle('chat:send', req => { state.sends.push(req); broadcast('chat:event-batch', { courseId: req.courseId, sessionId: req.sessionId, seq: ++state.seq, events: [{ type: 'turn-started', turnSeq: 1 }, { type: 'text-delta', blockId: 'stream', text: '옮기기 전 응답 ' }] }); return { turnSeq: 1 } })
      handle('chat:close', req => { state.closes.push(req); return { ok: true } })
      handle('agentTools:confirmations', req => state.confirmations.filter(item => item.request.conversationId === req.conversationId))
      handle('agentTools:respondConfirm', req => { state.approvals.push(req); const item = state.confirmations.find(item => item.request.requestId === req.requestId); item.status = req.approved ? 'approved' : 'denied'; item.revision++; broadcast('agentTools:confirmationChanged', item); return { ok: true, state: item } })
    })
    const { page } = bandal, { source, target } = await pair(page, '대화 이동')
    await page.keyboard.press('ControlOrMeta+Shift+A')
    const input = page.getByRole('textbox', { name: '메시지 입력' })
    await expect(input).toBeVisible(); await input.fill('이 대화는 원래 과목에 연결')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(page.getByRole('button', { name: '응답 중단' })).toBeVisible()
    await input.fill('답변 중에 작성한 다음 초안')
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__movingChat
      const confirmation = { request: { requestId: 'move-approval', courseId: state.courseId, conversationId: state.sessionId, turnId: `${state.sessionId}:1`, tool: 'browser_access', summary: '옮기는 중에도 원래 대화의 승인', details: ['https://example.edu'], scopes: ['once'] }, status: 'pending', revision: 1 }
      state.confirmations.push(confirmation)
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agentTools:confirmationChanged', confirmation)
    })
    await expect(page.locator('.chat-approval-dock')).toContainText('옮기는 중에도 원래 대화의 승인')
    const before = await bandal.app.evaluate(() => ({ courseId: (globalThis as any).__movingChat.courseId, sessionId: (globalThis as any).__movingChat.sessionId, opens: (globalThis as any).__movingChat.opens.length }))
    const instanceId = await content(page).getAttribute('data-panel-instance')
    await page.evaluate(() => { (window as any).__movedComposer = document.querySelector('.chat-composer__input') })
    await moveToCourse(page, activeTab(page), target.name)
    await expect(input).toHaveValue('답변 중에 작성한 다음 초안')
    await expect(page.locator('.chat-approval-dock')).toContainText('옮기는 중에도 원래 대화의 승인')
    expect(await content(page).getAttribute('data-panel-instance')).toBe(instanceId)
    expect(await page.evaluate(() => (window as any).__movedComposer === document.querySelector('.chat-composer__input'))).toBe(true)
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as any).__movingChat
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', { courseId: state.courseId, sessionId: state.sessionId, seq: ++state.seq, events: [{ type: 'text-delta', blockId: 'stream', text: '옮긴 뒤 이어지는 응답' }] })
    })
    await expect(page.locator('.chat-msg--assistant')).toContainText('옮긴 뒤 이어지는 응답')
    await page.locator('.chat-approval-dock').getByRole('button', { name: '이번만 허용', exact: true }).click()
    await expect(page.locator('.chat-approval-dock')).toHaveCount(0)
    expect(await bandal.app.evaluate(() => ({ opens: (globalThis as any).__movingChat.opens.length, closes: (globalThis as any).__movingChat.closes.length, approvals: (globalThis as any).__movingChat.approvals.length, sends: (globalThis as any).__movingChat.sends }))).toMatchObject({ opens: before.opens, closes: 0, approvals: 1, sends: [{ courseId: source.id, sessionId: before.sessionId }] })
    await expect.poll(() => binding(page, target.id, 'chat')).toMatchObject({ payload: { courseId: source.id, conversationId: before.sessionId } })
    await expect(input).toHaveValue('답변 중에 작성한 다음 초안')
    await expect(page.getByRole('button', { name: '응답 중단' })).toBeVisible()
  } finally { await bandal.close() }
})

test('active recording keeps one microphone/worklet and its growing counter; indicator returns to moved placement', async () => {
  const bandal = await launchBandal()
  try {
    await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = { session: null as any, starts: 0, appends: 0 }
      ;(globalThis as any).__movingRecording = state
      const handle = (name: string, fn: (req: any) => any): void => { ipcMain.removeHandler(name); ipcMain.handle(name, (_event, req) => fn(req)) }
      const emit = (): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('recordings:event', { session: state.session, partial: null, segment: null, rtf: 0, cooling: false }) }
      handle('recordings:models', () => [{ id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', description: '테스트 음성 백엔드', bytes: 1, downloadedBytes: 1, status: 'installed', error: null }])
      handle('recordings:list', req => state.session?.courseId === req.courseId ? [state.session] : [])
      handle('recordings:create', req => (state.session = { id: 'moving-recording', courseId: req.courseId, title: req.title, modelId: req.modelId, createdAt: new Date().toISOString(), status: 'ready', audioRelPath: '녹음/moving/recording.wav', samples: 0, transcribedSamples: 0, nextSequence: 0, error: null }))
      handle('recordings:read', () => ({ session: state.session, segments: [], anchors: [] }))
      handle('recordings:control', req => { if (req.action === 'start') state.starts++; state.session.status = req.action === 'start' ? 'recording' : req.action === 'pause' ? 'paused' : req.action === 'interrupt' ? 'interrupted' : 'complete'; emit(); return state.session })
      handle('recordings:append', req => { if (req.id !== state.session.id || req.sequence !== state.session.nextSequence) throw new Error('녹음 스트림이 재시작됐어요.'); state.appends++; state.session.samples += req.pcm.byteLength / 2; state.session.nextSequence++; emit(); return { samples: state.session.samples, nextSequence: state.session.nextSequence } })
    })
    const { page } = bandal, { source, target } = await pair(page, '실시간 녹음 이동')
    await page.evaluate(async () => {
      const fixture = { calls: 0, worklets: 0, context: new AudioContext({ sampleRate: 16000 }), stream: null as MediaStream | null, worklet: null as AudioWorkletNode | null }
      const destination = fixture.context.createMediaStreamDestination(), oscillator = fixture.context.createOscillator()
      oscillator.frequency.value = 220; oscillator.connect(destination); oscillator.start(); await fixture.context.resume(); fixture.stream = destination.stream
      const OriginalWorklet = window.AudioWorkletNode
      Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: class extends OriginalWorklet { constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) { super(...args); fixture.worklets++; fixture.worklet = this } } })
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { fixture.calls++; return destination.stream } })
      ;(window as any).__movingMicrophone = fixture
    })
    await page.keyboard.press('ControlOrMeta+Alt+R')
    const recording = page.locator('.recording:visible')
    await expect(recording.getByRole('button', { name: '녹음 시작', exact: true })).toBeEnabled()
    await recording.getByRole('button', { name: '녹음 시작', exact: true }).click()
    await expect(page.locator('.recording-indicator')).toBeVisible()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__movingRecording.appends)).toBeGreaterThan(2)
    const before = await bandal.app.evaluate(() => ({ samples: (globalThis as any).__movingRecording.session.samples, sessionId: (globalThis as any).__movingRecording.session.id }))
    const instanceId = await content(page).getAttribute('data-panel-instance')
    await page.evaluate(() => { (window as any).__movingRecordingDom = document.querySelector('.recording'); (window as any).__originalRecordingWorklet = (window as any).__movingMicrophone.worklet })
    await moveToCourse(page, activeTab(page), target.name)
    expect(await content(page).getAttribute('data-panel-instance')).toBe(instanceId)
    expect(await page.evaluate(() => (window as any).__movingRecordingDom === document.querySelector('.recording'))).toBe(true)
    expect(await page.evaluate(() => ({ calls: (window as any).__movingMicrophone.calls, worklets: (window as any).__movingMicrophone.worklets, sameWorklet: (window as any).__originalRecordingWorklet === (window as any).__movingMicrophone.worklet, trackState: (window as any).__movingMicrophone.stream.getAudioTracks()[0].readyState }))).toEqual({ calls: 1, worklets: 1, sameWorklet: true, trackState: 'live' })
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__movingRecording.session.samples)).toBeGreaterThan(before.samples)
    expect(await bandal.app.evaluate(() => ({ starts: (globalThis as any).__movingRecording.starts, courseId: (globalThis as any).__movingRecording.session.courseId, id: (globalThis as any).__movingRecording.session.id }))).toEqual({ starts: 1, courseId: source.id, id: before.sessionId })
    await folder(page, source.name).locator('.course-row__select').click()
    await page.locator('.recording-indicator').getByRole('button', { name: '강의 녹음 중' }).click()
    await expect(folder(page, target.name)).toHaveAttribute('data-selected', 'true')
    await expect(recording).toBeVisible()
    await page.locator('.recording-indicator').getByRole('button', { name: '종료', exact: true }).click()
    await expect(page.locator('.recording-indicator')).toHaveCount(0)
    await page.evaluate(() => (window as any).__movingMicrophone.context.close())
  } finally { await bandal.close() }
})

test('saved recording playback keeps the same audio element and advances while its tab moves', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal, { source, target } = await pair(page, '재생 이동')
    const saved = await page.evaluate(courseId => window.bandal.invoke('recordings:create', { courseId, title: '계속 재생되는 녹음', modelId: 'whisper-large-v3-turbo' }), source.id)
    const samples = 60 * 16000
    writeFileSync(join(source.folderPath, saved.audioRelPath), Buffer.concat([wavHeader(samples), Buffer.alloc(samples * 2)]))
    const Database = require('better-sqlite3-node') as typeof import('better-sqlite3'), db = new Database(join(bandal.userDataDir, 'bandal.db'))
    try { db.prepare('UPDATE recording_sessions SET payload = ? WHERE id = ?').run(JSON.stringify({ ...saved, status: 'complete', samples, transcribedSamples: samples }), saved.id) } finally { db.close() }
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="녹음"]').click()
    await page.locator(`[data-material-path="${saved.audioRelPath.slice(0, -10)}"]`).click()
    await page.locator(`[data-material-path="${saved.audioRelPath}"]`).click()
    const recording = page.locator('.recording:visible'), audio = recording.locator('audio')
    await audio.evaluate((element: HTMLAudioElement) => { element.muted = true; (window as any).__movingAudio = element })
    await recording.getByRole('button', { name: '녹음 재생', exact: true }).click()
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.2)
    const before = await audio.evaluate((element: HTMLAudioElement) => element.currentTime)
    await moveToCourse(page, activeTab(page), target.name)
    expect(await audio.evaluate((element: HTMLAudioElement) => ({ same: element === (window as any).__movingAudio, paused: element.paused }))).toEqual({ same: true, paused: false })
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(before)
    await expect.poll(() => binding(page, target.id, 'recording')).toMatchObject({ payload: { courseId: source.id, sessionId: saved.id } })
  } finally { await bandal.close() }
})

test('moved browser owns future downloads, popups and visits, and rejects a stale guest ownership update', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture')
    if (url.pathname === '/download') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="move-download.txt"' }); response.end('download after moving'); return }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(`<title>${url.pathname === '/child' ? '옮긴 뒤 팝업' : '옮기는 브라우저'}</title><h1>local fixture</h1>`)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, bandal = await launchBandal()
  try {
    const { page, app } = bandal, { source, target } = await pair(page, '브라우저 소유권')
    await app.evaluate(({ BrowserWindow }, input) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', input) }, { url: `${origin}/start`, courseId: source.id })
    await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url && !wc.isLoading())?.id ?? null, `${origin}/start`)).not.toBeNull()
    const guestId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url)!.id, `${origin}/start`)
    await expect(activeTab(page)).toContainText('옮기는 브라우저')
    await expect.poll(() => binding(page, source.id, 'browser')).toMatchObject({ kind: 'browser' })
    const tabId = (await binding(page, source.id, 'browser')).payload.tabId as string
    await moveToCourse(page, activeTab(page), target.name)
    expect(await page.evaluate(({ tabId, sourceId, guestId }) => window.bandal.invoke('browser:setCourse', { tabId, courseId: sourceId, expectedWebContentsId: guestId + 1000000, revision: 999 }), { tabId, sourceId: source.id, guestId })).toEqual({ ok: false })
    // Sidebar selection must not override the retained native page's new owner.
    await folder(page, source.name).locator('.course-row__select').click()
    await runGuest(bandal, guestId, `location.href='${origin}/download'; undefined`)
    await expect.poll(() => existsSync(join(target.folderPath, 'move-download.txt'))).toBe(true)
    expect(existsSync(join(source.folderPath, 'move-download.txt'))).toBe(false)
    expect(readFileSync(join(target.folderPath, 'move-download.txt'), 'utf8')).toBe('download after moving')
    await folder(page, target.name).locator('.course-row__select').click()
    await runGuest(bandal, guestId, `window.open('${origin}/child', 'moved-child'); undefined`)
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab').filter({ hasText: '옮긴 뒤 팝업' })).toBeVisible()
    await expect.poll(() => page.evaluate(async ({ targetId, sourceId }) => { const [target, source] = await Promise.all([window.bandal.invoke('layout:get', { courseId: targetId }), window.bandal.invoke('layout:get', { courseId: sourceId })]); return [Object.keys((target.layout as any)?.panels ?? {}).length, Object.keys((source.layout as any)?.panels ?? {}).length] }, { targetId: target.id, sourceId: source.id })).toEqual([2, 0])
    await folder(page, source.name).locator('.course-row__select').click()
    await runGuest(bandal, guestId, `location.href='${origin}/visit-after-moving'; undefined`)
    const Database = require('better-sqlite3-node') as typeof import('better-sqlite3')
    await expect.poll(() => { const db = new Database(join(bandal.userDataDir, 'bandal.db'), { readonly: true }); try { return (db.prepare('SELECT course_id FROM browser_history WHERE url = ?').get(`${origin}/visit-after-moving`) as { course_id: string } | undefined)?.course_id ?? null } finally { db.close() } }).toBe(target.id)
  } finally { await bandal.close(); await new Promise<void>(done => server.close(() => done())) }
})
