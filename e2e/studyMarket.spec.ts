import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { DEFAULT_UNIVERSITY_SETTINGS } from '../src/shared/types/university'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })
const market = (page: Page) => page.getByRole('main', { name: '공부 마켓플레이스' })
// The public navigation is retired. Exercise historical fulfillment through
// the retained internal screen, never reintroduce a marketplace entry point.
const openLegacyMarket = (page: Page) => page.evaluate(() => { window.dispatchEvent(new Event('bandal:open-study-market')) })
const remoteNote = '# Purchased study\n\nThis copy is safe to keep.\n'

/** Mock the remote service/identity only; preparation, rendering, upload and import use real IPC. */
async function installMarketService(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ ipcMain, BrowserWindow, net, shell }, fixture) => {
    process.env['BANDAL_SUPABASE_URL'] = 'https://study-market.e2e.example'
    process.env['BANDAL_SUPABASE_PUBLISHABLE_KEY'] = 'e2e-public-key'
    const root = 'https://study-market.e2e.example'
    const course = { id: 'market-course', universityId: 'snu', name: '경제학원론' }
    const file = { id: 'remote-file', path: 'purchased.md', bytes: fixture.bytes, sha256: fixture.sha256, mime: 'text/markdown' }
    const base = { id: 'listing-one', versionId: 'version-one', universityId: 'snu', course, sellerId: 'another-student', sellerName: '공부하는 달', title: '미시경제 중간고사 요약', description: '핵심 개념과 직접 정리한 연습문제를 한곳에 모았어요.', price: 2000, professor: '김교수', semester: '2026년 2학기', status: 'published', files: [file], previewUrls: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
    const probe = { calls: [] as any[], workspace: null as any, drafts: [] as any[], purchases: [] as any[], paid: false, corrupt: true, opened: '', uploads: {} as Record<string, number>, nextUpload: 0 }
    ;(globalThis as any).__studyMarketFixture = probe
    const userId = '11111111-1111-4111-8111-111111111111'
    const auth = { phase: 'signed-in', profile: { id: userId, nickname: '마켓학생', avatarColor: '#64748b', avatarEmoji: '🌙' }, email: 'student@example.test', avatarUrl: null, online: true, errorCode: null }
    ipcMain.removeHandler('auth:getState'); ipcMain.handle('auth:getState', () => auth)
    const sync = (ipcMain as any)._invokeHandlers.get('agent:syncWorkspace')
    ipcMain.removeHandler('agent:syncWorkspace'); ipcMain.handle('agent:syncWorkspace', (event, input) => { probe.workspace = input; return sync(event, input) })
    shell.openExternal = async url => { probe.opened = url }
    const originalFetch = net.fetch.bind(net)
    net.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.startsWith(root)) return originalFetch(input, init)
      const path = new URL(url).pathname
      const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
      if (path === '/functions/v1/study-market') {
        const { action, input: req } = JSON.parse(String(init?.body))
        probe.calls.push({ action, input: req })
        if (action === 'context') return json({ universities: [{ id: 'snu', name: '서울대학교' }], tradingEnabled: true, notice: '' })
        if (action === 'courses') return json([course])
        if (action === 'createCourse') return json(course)
        if (action === 'listings') return json({ listings: !req.q || base.title.includes(req.q) || course.name.includes(req.q) ? [base] : [], nextCursor: null })
        if (action === 'listing') return json(base)
        if (action === 'dashboard') return json({ configured: true, tradingEnabled: true, signedIn: true, operator: false, seller: { status: 'ready', displayName: '마켓학생' }, listings: probe.drafts, purchases: probe.purchases, payouts: [], salesCount: 0, pendingAmount: 0, paidAmount: 0, notice: '' })
        if (action === 'saveDraft') {
          const draft = { ...base, ...req, course, id: 'own-listing', versionId: 'own-version', sellerId: userId, sellerName: '마켓학생', status: 'draft', previewUrls: [] }
          probe.drafts = [draft]; return json(draft)
        }
        if (action === 'uploadGrant') return json({ url: `${root}/storage/v1/object/upload`, token: 'fixture-upload', bucket: 'study-market', objectPath: req.fileId, resumableUrl: `${root}/storage/v1/upload/resumable` })
        if (action === 'finalizeFile') return json({ ok: true })
        if (action === 'publish') { probe.drafts[0].status = 'published'; return json(probe.drafts[0]) }
        if (action === 'order') {
          const order = { id: 'order-one', listingId: base.id, versionId: base.versionId, title: base.title, courseName: course.name, amount: 2000, fee: 200, sellerAmount: 1800, status: 'pending', createdAt: '2026-10-13T00:00:00Z', paidAt: null, supplyStartedAt: null, receiptUrl: null, checkoutUrl: 'https://bandal.io/checkout?order=order-one' }
          probe.purchases = [order]; return json(order)
        }
        if (action === 'orderStatus') { if (probe.paid) Object.assign(probe.purchases[0], { status: 'paid', paidAt: '2026-10-13T00:01:00Z' }); return json(probe.purchases[0]) }
        if (action === 'download') return json({ orderId: 'order-one', title: base.title, courseName: course.name, files: [{ ...file, url: `${root}/storage/v1/object/purchased.md` }] })
        if (action === 'downloadComplete') return json({ ok: true })
        return new Response(JSON.stringify({ error: `Unhandled fixture action ${action}` }), { status: 500 })
      }
      if (path === '/storage/v1/upload/resumable' && init?.method === 'POST') {
        const upload = `${root}/storage/v1/upload/resumable/${++probe.nextUpload}`; probe.uploads[upload] = 0
        return new Response(null, { status: 201, headers: { Location: upload } })
      }
      if (path.startsWith('/storage/v1/upload/resumable/')) {
        if (init?.method === 'PATCH') probe.uploads[url] += (init.body as Uint8Array).byteLength
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(probe.uploads[url] ?? 0) } })
      }
      if (path === '/storage/v1/object/purchased.md') return new Response(probe.corrupt ? 'corrupt download' : fixture.note)
      return new Response('not found', { status: 404 })
    }
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    host.webContents.send('auth:changed', auth)
  }, { note: remoteNote, bytes: Buffer.byteLength(remoteNote), sha256: createHash('sha256').update(remoteNote).digest('hex') })
}

async function launchMarket(): Promise<BandalApp> {
  const bandal = await launchBandal({ extraSettings: { university: { ...DEFAULT_UNIVERSITY_SETTINGS, universityId: 'snu' } } })
  await installMarketService(bandal)
  return bandal
}

test('market navigation preserves live study state, clears AI context, and stays simple at narrow widths', async ({}, info) => {
  const bandal = await launchMarket()
  try {
    const { page, app } = bandal
    await createCourse(page, '경제학원론')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, 'live.md'), '# Live notes\n\nRemember this paragraph.\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="live.md"]').click()
    const editor = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(editor).toBeVisible()
    await editor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' Live draft remains.')
    await editor.evaluate(element => { (window as any).__marketLiveEditor = element })
    await expect.poll(async () => Object.keys((await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), course.id)).layout?.panels ?? {}).length).toBeGreaterThan(0)
    const panelIds = await page.evaluate(async id => Object.keys((await window.bandal.invoke('layout:get', { courseId: id })).layout!.panels), course.id)
    const labels = await rail(page).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
    expect(labels.slice(labels.indexOf('더보기'), labels.indexOf('더보기') + 3)).toEqual(['더보기', '커뮤니티', '도움말'])
    await rail(page).getByRole('button', { name: '더보기', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '앱 더보기' })).toBeVisible()
    await openLegacyMarket(page)
    await expect(market(page)).toBeVisible(); await expect(page.locator('.app-shell')).toHaveAttribute('data-course-rail', 'closed'); await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
    expect(await market(page).evaluate(element => Math.abs(element.getBoundingClientRect().width - document.querySelector('.workspace-host')!.getBoundingClientRect().width))).toBeLessThan(2)
    await expect.poll(() => app.evaluate(() => (globalThis as any).__studyMarketFixture.workspace)).toMatchObject({ selectedCourseId: null, tabs: [], documents: [], selection: '' })
    await page.keyboard.press('ControlOrMeta+w')
    expect(await page.evaluate(async id => Object.keys((await window.bandal.invoke('layout:get', { courseId: id })).layout!.panels), course.id)).toEqual(panelIds)
    await expect(market(page).getByRole('button').filter({ hasText: '미시경제 중간고사 요약' })).toBeVisible()
    const catalogCalls = await app.evaluate(() => (globalThis as any).__studyMarketFixture.calls)
    const selectedContext = catalogCalls.findIndex((call: any) => call.action === 'context' && call.input.universityId === 'snu')
    const firstCatalog = catalogCalls.findIndex((call: any) => call.action === 'courses' || call.action === 'listings')
    expect(selectedContext).toBeGreaterThanOrEqual(0); expect(firstCatalog).toBeGreaterThan(selectedContext)
    await market(page).getByRole('textbox', { name: '과목과 자료 검색' }).fill('없는 자료')
    await expect(market(page).getByRole('heading', { name: '찾는 자료가 아직 없어요' })).toBeVisible()
    await market(page).getByRole('textbox', { name: '과목과 자료 검색' }).fill('미시경제')
    await market(page).getByRole('button').filter({ hasText: '미시경제 중간고사 요약' }).click()
    const detail = page.getByRole('dialog', { name: '자료 살펴보기' })
    await expect(detail).toContainText('핵심 개념'); await detail.getByRole('button', { name: '닫기', exact: true }).click()
    await page.screenshot({ path: info.outputPath('market-dark.png') })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.screenshot({ path: info.outputPath('market-light.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setSize(900, 700))
    await expect(market(page)).toBeVisible()
    expect(await market(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath('market-narrow.png') })
    await rail(page).getByRole('button', { name: '더보기', exact: true }).click()
    await expect(market(page)).toBeHidden()
    await expect(page.getByRole('complementary', { name: '앱 더보기' })).toBeVisible()
    await expect(rail(page).getByRole('button', { name: '더보기', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await rail(page).getByRole('button', { name: '홈', exact: true }).click()
    await expect(editor).toBeVisible(); await expect(editor).toContainText('Live draft remains.')
    expect(await editor.evaluate(element => element === (window as any).__marketLiveEditor)).toBe(true)
    expect(await page.evaluate(async id => Object.keys((await window.bandal.invoke('layout:get', { courseId: id })).layout!.panels), course.id)).toEqual(panelIds)
    const browserUrl = 'https://retained-study.example.test/'
    await app.evaluate(({ session, BrowserWindow }, input) => {
      session.fromPartition('persist:browsing').protocol.handle('https', () => new Response('<html><title>Retained study</title><body><input id="draft" value="initial"></body></html>', { headers: { 'content-type': 'text/html' } }))
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', input)
    }, { courseId: course.id, url: browserUrl })
    await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url && !contents.isLoading())?.id ?? null, browserUrl)).not.toBeNull()
    const browserId = await app.evaluate(async ({ webContents }, url) => { const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!; await contents.executeJavaScript('document.querySelector("#draft").value = "Keep browser draft"'); return contents.id }, browserUrl)
    const browserVisible = () => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.id === id && view.getVisible()), browserId)
    await expect.poll(browserVisible).toBe(true)
    await openLegacyMarket(page); await expect.poll(browserVisible).toBe(false)
    await rail(page).getByRole('button', { name: '홈', exact: true }).click(); await expect.poll(browserVisible).toBe(true)
    expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), browserId)).toBe('Keep browser draft')
  } finally { await bandal.close() }
})

test('seller prepares and rasterizes a real PDF, and a paid buyer can retry a failed verified import', async ({}, info) => {
  const bandal = await launchMarket()
  try {
    const { page, app } = bandal
    await createCourse(page, '경제학원론')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica)
    document.addPage([600, 800]).drawText('Economics study notes', { x: 40, y: 720, size: 24, font })
    writeFileSync(join(course.folderPath, '판매.pdf'), await document.save())
    writeFileSync(join(course.folderPath, 'private.md'), '# Do not publish without selection\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await openLegacyMarket(page)
    await expect(market(page).getByRole('button', { name: '내 공부 판매', exact: true })).toBeVisible()
    await market(page).getByRole('button', { name: '내 공부 판매', exact: true }).click()
    const sale = page.getByRole('dialog', { name: '내 공부 판매하기' })
    await expect(sale.getByRole('checkbox', { name: /판매.pdf/ })).toBeVisible()
    for (const checkbox of await sale.getByRole('checkbox').all()) await checkbox.uncheck()
    await sale.getByRole('checkbox', { name: /판매.pdf/ }).check()
    await sale.getByRole('button', { name: '다음', exact: true }).click()
    await sale.getByLabel('자료 제목', { exact: true }).fill('경제학원론 핵심 자료')
    await sale.getByLabel('설명', { exact: true }).fill('직접 정리한 경제학 공부 자료입니다.')
    await sale.getByRole('textbox', { name: '묶음 가격 (원)', exact: true }).fill('2000')
    await sale.getByRole('button', { name: '미리보기 만들기', exact: true }).click()
    await expect(sale.getByRole('img', { name: '공개 미리보기 1', exact: true })).toBeVisible()
    await sale.getByRole('button', { name: '미리보기 1 삭제', exact: true }).click()
    await expect(sale.getByRole('img', { name: '공개 미리보기 1', exact: true })).toHaveCount(0)
    await sale.getByRole('button', { name: '미리보기 만들기', exact: true }).click()
    await expect(sale.getByRole('img', { name: '공개 미리보기 1', exact: true })).toBeVisible()
    await sale.getByRole('button', { name: '공개 전 확인', exact: true }).click()
    await sale.getByRole('checkbox', { name: /직접 만든 자료이거나 판매할 권한/ }).check()
    await page.screenshot({ path: info.outputPath('market-sale-preview.png') })
    await sale.getByRole('button', { name: '판매 시작', exact: true }).click()
    await expect(sale).toBeHidden()
    const saved = await app.evaluate(() => (globalThis as any).__studyMarketFixture.drafts[0])
    expect(saved.status).toBe('published'); expect(saved.files.filter((file: any) => !file.preview).map((file: any) => file.path)).toEqual(['판매.pdf'])
    expect(saved.files.filter((file: any) => file.preview)).toHaveLength(1)
    expect(await app.evaluate(() => Object.values((globalThis as any).__studyMarketFixture.uploads).every(bytes => Number(bytes) > 0))).toBe(true)
    await market(page).getByRole('button', { name: '둘러보기', exact: true }).click()
    await market(page).getByRole('button').filter({ hasText: '미시경제 중간고사 요약' }).click()
    await page.getByRole('dialog', { name: '자료 살펴보기' }).getByRole('button', { name: '구매하기', exact: true }).click()
    const checkout = page.getByRole('dialog', { name: '결제 확인', exact: true })
    await checkout.getByRole('button', { name: '브라우저에서 결제', exact: true }).click()
    expect(await app.evaluate(() => (globalThis as any).__studyMarketFixture.opened)).toContain('https://bandal.io/checkout')
    await app.evaluate(() => { (globalThis as any).__studyMarketFixture.paid = true })
    const completed = page.getByRole('dialog', { name: '구매가 완료됐어요', exact: true })
    await completed.getByRole('button', { name: '구매 내역 보기', exact: true }).click()
    const existing = join(course.folderPath, '구매 자료/미시경제 중간고사 요약')
    mkdirSync(existing, { recursive: true }); writeFileSync(join(existing, 'original.md'), 'keep existing')
    await market(page).getByRole('button', { name: '내 과목에 가져오기', exact: true }).click()
    const importer = page.getByRole('dialog', { name: '내 과목으로 가져오기', exact: true })
    await importer.getByLabel('자료를 넣을 과목').selectOption(course.id)
    await expect(importer.getByRole('button', { name: '가져오기', exact: true })).toBeDisabled()
    await importer.getByRole('checkbox').check(); await importer.getByRole('button', { name: '가져오기', exact: true }).click()
    await expect(importer.getByRole('alert')).toBeVisible()
    expect(readdirSync(join(course.folderPath, '구매 자료'))).toEqual(['미시경제 중간고사 요약'])
    expect(readFileSync(join(existing, 'original.md'), 'utf8')).toBe('keep existing')
    await app.evaluate(() => { (globalThis as any).__studyMarketFixture.corrupt = false })
    await importer.getByRole('button', { name: '가져오기', exact: true }).click(); await expect(importer).toBeHidden()
    expect(readFileSync(join(course.folderPath, '구매 자료/미시경제 중간고사 요약 (2)/purchased.md'), 'utf8')).toBe(remoteNote)
    const acknowledgements = await app.evaluate(() => (globalThis as any).__studyMarketFixture.calls.filter((call: any) => call.action === 'downloadComplete').map((call: any) => call.input.success))
    expect(acknowledgements).toEqual([false, true])
    await page.screenshot({ path: info.outputPath('market-purchase.png') })
  } finally { await bandal.close() }
})
