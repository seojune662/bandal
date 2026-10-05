import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchBandal, type BandalApp } from './helpers/launch'

const SHOT_DIR = process.env['BANDAL_E2E_SHOT_DIR']
async function capture(bandal: BandalApp, name: string): Promise<void> {
  if (!SHOT_DIR) return
  mkdirSync(SHOT_DIR, { recursive: true })
  for (const size of [{ width: 1280, height: 800 }, { width: 900, height: 700 }]) {
    await bandal.app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!; window.setMinimumSize(760, 560); window.setContentSize(size.width, size.height) }, size)
    await expect.poll(() => bandal.page.evaluate(() => window.innerWidth)).toBe(size.width)
    await bandal.page.screenshot({ path: join(SHOT_DIR, `plugin-center-${name}-${size.width}.png`) })
    const overflow = await bandal.page.locator('.plugin-center').evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
  await bandal.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800) })
}

/** Secure-store and MCP server boundary are deterministic; no real accounts,
 * credentials, package downloads or third-party service calls are involved. */
async function installMcpFixture(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ ipcMain, BrowserWindow }) => {
    const fixture = { servers: [] as any[], calls: [] as { channel: string; enabled?: boolean }[], nextOk: false }
    ;(globalThis as any).pluginCenterFixture = fixture
    const changed = (): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('mcp:changed', {}) }
    for (const channel of ['mcp:list', 'mcp:save', 'mcp:test', 'mcp:delete']) ipcMain.removeHandler(channel)
    ipcMain.handle('mcp:list', () => ({ servers: fixture.servers, availability: { available: true, reason: null } }))
    ipcMain.handle('mcp:save', (_event, input) => {
      fixture.calls.push({ channel: 'save', enabled: input.enabled })
      const existing = fixture.servers.find(server => server.id === input.id)
      const { env, headers, ...publicInput } = input
      const server = { ...existing, ...publicInput, id: input.id ?? `fixture-${fixture.servers.length + 1}`, envKeys: env ? Object.keys(env) : existing?.envKeys ?? [], headerKeys: headers ? Object.keys(headers) : existing?.headerKeys ?? [], createdAt: '2026-10-06T01:00:00Z', updatedAt: '2026-10-06T01:00:00Z' }
      fixture.servers = [...fixture.servers.filter(item => item.id !== server.id), server]
      changed(); return { server }
    })
    ipcMain.handle('mcp:test', (_event, input) => {
      fixture.calls.push({ channel: 'test' })
      const result = { ok: fixture.nextOk, tools: fixture.nextOk ? ['search', 'read'] : [], ...(fixture.nextOk ? {} : { error: '서버를 실행하지 못했습니다. 연결 설정을 수정해 주세요.' }), durationMs: 1 }
      fixture.servers = fixture.servers.map(server => server.id === input.id ? { ...server, lastTest: { at: '2026-10-06T01:00:00Z', ...result } } : server)
      changed(); return result
    })
    ipcMain.handle('mcp:delete', (_event, input) => { fixture.servers = fixture.servers.filter(server => server.id !== input.id); changed(); return { ok: true } })
  })
}

test('one understandable list, selected setup only, failed setup stays off and successful retry enables it', async () => {
  const bandal = await launchBandal()
  try {
    await installMcpFixture(bandal)
    const { page } = bandal
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="packs"]').click()
    await expect(page.locator('.settings-nav [data-category="mcp"]')).toHaveCount(0)
    const center = page.locator('.plugin-center')
    await expect(center.getByRole('list', { name: '전체 기능' })).toBeVisible()
    await expect(center.locator('textarea, input[type="password"]')).toHaveCount(0)
    await expect(center).toContainText('영어 글 읽기')
    await expect(center).toContainText('자료로 문제와 해설을 만들고')
    await capture(bandal, 'list')
    await center.getByLabel('기능 유형').selectOption('external')
    await expect(center.locator('.plugin-center-row')).toHaveCount(6)
    await center.getByLabel('플러그인 검색').fill('Notion')
    const notion = center.locator('[data-feature-id="preset:notion"]')
    await notion.getByRole('button', { name: '설정하기', exact: true }).click()
    await expect(center.getByLabel('Notion 통합 토큰')).toBeVisible()
    await expect(center.getByLabel('Slack 봇 토큰')).toHaveCount(0)
    await expect(center.locator('textarea')).toHaveCount(0)
    await capture(bandal, 'setup')
    await center.getByLabel('Notion 통합 토큰').fill('fixture-only-token')
    await center.getByRole('button', { name: '연결하고 사용하기', exact: true }).click()
    await expect(center).toContainText('확인 실패 · 꺼짐')
    await expect(center.getByRole('switch', { name: 'Notion 사용' })).toHaveAttribute('aria-checked', 'false')
    await expect(center.getByRole('button', { name: '연결 설정 수정' })).toBeVisible()
    await bandal.app.evaluate(() => { (globalThis as any).pluginCenterFixture.nextOk = true })
    await center.getByRole('switch', { name: 'Notion 사용' }).click()
    await expect(center.getByRole('switch', { name: 'Notion 사용' })).toHaveAttribute('aria-checked', 'true')
    await expect(center).toContainText('연결 확인됨')
    await expect(center).toContainText('마지막 연결 확인')
    await expect(center).toContainText('새 화면 도우미 대화부터 적용')
    await capture(bandal, 'detail')
    const calls = await bandal.app.evaluate(() => (globalThis as any).pluginCenterFixture.calls)
    expect(calls).toEqual([{ channel: 'save', enabled: false }, { channel: 'test' }, { channel: 'test' }, { channel: 'save', enabled: true }])
    await center.getByRole('button', { name: '목록으로 돌아가기' }).click()
    await expect(center.getByLabel('플러그인 검색')).toHaveValue('Notion')
    await expect(center.getByLabel('기능 유형')).toHaveValue('external')
    await expect(center.locator('.plugin-center-row')).toHaveCount(1)
    await expect(center.locator('[data-feature-id="preset:notion"]')).toHaveCount(0)
    await center.getByLabel('플러그인 검색').fill('')
    await center.getByLabel('기능 유형').selectOption('all')
    await page.keyboard.press('Escape')
    await bandal.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('ui:openSettings', { category: 'mcp' }) })
    await expect(page.locator('.settings-nav [data-category="packs"]')).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.plugin-center').getByLabel('기능 유형')).toHaveValue('external')
  } finally { await bandal.close() }
})

test('extension approval explains execution, traps focus, and Escape restores the triggering control', async () => {
  const bandal = await launchBandal({ extraSettings: { experimental: { extensionRuntime: false } } })
  try {
    const { page } = bandal
    await page.evaluate(path => window.bandal.invoke('plugins:installFromFolder', { path }), resolve(__dirname, '../examples/plugins/word-count'))
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="packs"]').click()
    const center = page.locator('.plugin-center')
    await center.getByLabel('기능 유형').selectOption('plugin')
    await expect(center.locator('.plugin-center-row')).toHaveCount(1)
    const trigger = center.locator('[data-feature-id="plugin:bandal.word-count"] [role="switch"]')
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: /단어 수.*허용/ })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('확장 기능 실행을 켜면')
    const approve = dialog.getByRole('button', { name: '승인하고 실행 켜기' })
    await approve.focus()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-checked', 'false')
    await trigger.click()
    await page.getByRole('dialog').getByRole('button', { name: '승인하고 실행 켜기' }).click()
    await expect(trigger).toHaveAttribute('aria-checked', 'true')
    await expect(center.locator('.plugin-center-row')).toContainText('사용 중')
    await center.locator('.plugin-center-row__open').click()
    await expect(center).toContainText('사용할 수 있는 작업')
    await expect(center.locator('.plugin-center-logs')).toHaveCount(0)
    await capture(bandal, 'extension-detail')
  } finally { await bandal.close() }
})
