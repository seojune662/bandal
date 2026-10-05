import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_ONBOARDING, TUTORIAL_VERSION } from '../src/shared/types/settings'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const card = (page: Page) => page.locator('.tour-card[role="dialog"]')
const fresh = { theme: 'light' as const, onboarding: DEFAULT_ONBOARDING, tutorial: { seenVersion: 0, activeCourseId: null } }
async function viewport(bandal: BandalApp, width: number, height: number): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
    window.setMinimumSize(760, 560); window.setContentSize(size.width, size.height)
  }, { width, height })
}
async function screenshot(bandal: BandalApp, name: string): Promise<void> {
  const directory = process.env['BANDAL_E2E_SHOT_DIR']
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  await viewport(bandal, 1280, 800)
  await bandal.page.screenshot({ path: join(directory, `${name}-1280.png`) })
  await viewport(bandal, 900, 700)
  await bandal.page.screenshot({ path: join(directory, `${name}-narrow.png`) })
  await viewport(bandal, 1280, 800)
}
async function guardAi(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ ipcMain }) => {
    const calls: string[] = []
    ;(globalThis as any).tutorialAiCalls = calls
    const replace = (channel: string, handler: (input: any) => unknown) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, input) => handler(input)) }
    replace('chat:open', input => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: input.sessionId, courseId: input.courseId, provider: 'claude-code', model: 'default', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
    replace('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }] }))
    replace('agent:availability', () => ({ installed: true, loggedIn: true }))
    for (const channel of ['chat:send', 'learning:run', 'study:generate']) replace(channel, () => { calls.push(channel); throw new Error('The tutorial must not request AI generation') })
  })
}
async function advance(page: Page, title: string, step: number): Promise<void> {
  await card(page).getByRole('button', { name: '다음', exact: true }).click()
  await expect(card(page).getByRole('heading')).toHaveText(title)
  await expect(card(page).locator('.tour-eyebrow')).toHaveText(`${step} / 5`)
  await expect(card(page).getByRole('button', { name: step === 5 ? '끝내기' : '다음', exact: true })).toBeEnabled()
}

test('short welcome uses the current two-moon mark and direct start stays acknowledged after restart', async () => {
  const bandal = await launchBandal({ keepProfileOnClose: true, extraSettings: fresh })
  const profile = bandal.profileDir
  try {
    const welcome = bandal.page.getByRole('dialog', { name: '반달에 오신 걸 환영해요' })
    await expect(welcome).toBeVisible()
    await expect(welcome.locator('svg[data-motion="periodic"] path')).toHaveCount(2)
    await expect(welcome.getByRole('button', { name: '핵심 기능 5개 보기', exact: true })).toBeVisible()
    await screenshot(bandal, 'onboarding-welcome')
    await welcome.getByRole('button', { name: '바로 시작하기', exact: true }).click()
    await expect(welcome).toBeHidden()
    await expect.poll(() => bandal.page.evaluate(async () => (await window.bandal.invoke('settings:get', {})).onboarding.closedAt)).not.toBeNull()
    const state = await bandal.page.evaluate(async () => ({ settings: await window.bandal.invoke('settings:get', {}), courses: await window.bandal.invoke('courses:list', {}) }))
    expect(state.settings.tutorial).toEqual({ seenVersion: TUTORIAL_VERSION, activeCourseId: null }); expect(state.courses).toHaveLength(0)
  } finally { await bandal.close() }
  const restarted = await launchBandal({ reuseProfileDir: profile })
  try { await expect(restarted.page.locator('.onboarding-overlay,.tour-offer,.tour-overlay')).toHaveCount(0) } finally { await restarted.close() }
})

test('five features use real surfaces and remove the temporary sample without AI requests', async () => {
  const bandal = await launchBandal({ extraSettings: fresh })
  try {
    const { page } = bandal; await guardAi(bandal); await viewport(bandal, 1280, 800)
    await page.getByRole('dialog', { name: '반달에 오신 걸 환영해요' }).getByRole('button', { name: '핵심 기능 5개 보기' }).click()
    await expect(card(page).getByRole('heading')).toHaveText('과목에 자료 모으기')
    await expect(card(page).locator('.tour-eyebrow')).toHaveText('1 / 5')
    await expect(page.locator('[data-material-path="예시 강의자료.pdf"]')).toBeVisible()
    await expect(page.locator('[data-material-path="예시 필기.md"]')).toBeVisible()
    await screenshot(bandal, 'tutorial-1-materials')
    await advance(page, 'PDF를 읽고 필기하기', 2)
    const pdf = page.locator('.pdf-page').first(), note = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(pdf).toBeVisible(); await expect(note).toBeVisible()
    expect(await page.evaluate(() => document.querySelector('.pdf-page')?.closest('.dv-groupview') === document.querySelector('[aria-label="마크다운 필기 편집기"]')?.closest('.dv-groupview'))).toBe(false)
    await screenshot(bandal, 'tutorial-2-reading')
    await advance(page, '현재 자료에 대해 AI에게 질문하기', 3)
    const sidebar = page.locator('[data-tour="document-assistant"]')
    await expect(sidebar).toBeVisible()
    expect(await sidebar.evaluate(element => element.closest('[data-tour-panel]')?.getAttribute('data-tour-panel'))).toContain('예시 강의자료.pdf')
    await expect(page.locator('.workspace-host .chat-tab[data-variant="tab"]')).toHaveCount(0)
    await screenshot(bandal, 'tutorial-3-assistant')
    await advance(page, '내 자료로 퀴즈와 카드 만들기', 4)
    await expect(page.locator('[data-tour="quiz-tools"]')).toBeVisible()
    await screenshot(bandal, 'tutorial-4-review')
    await advance(page, '관심 있는 영어 글 읽기', 5)
    await expect(page.locator('[data-tour="english-tool"]')).toBeVisible()
    await screenshot(bandal, 'tutorial-5-english')
    // A hidden entry still leaves the final explanation readable indefinitely.
    await page.locator('[data-tour="english-tool"]').evaluate(element => { (element as HTMLElement).style.display = 'none' })
    await expect(card(page)).toHaveClass(/tour-card--centered/)
    await page.waitForTimeout(4_200)
    await expect(card(page).getByRole('heading')).toHaveText('관심 있는 영어 글 읽기')
    await card(page).getByRole('button', { name: '끝내기', exact: true }).click()
    await expect(page.locator('.tour-overlay')).toHaveCount(0)
    expect(await page.evaluate(() => window.bandal.invoke('courses:list', {}))).toHaveLength(0)
    expect((await page.evaluate(() => window.bandal.invoke('settings:get', {}))).tutorial.activeCourseId).toBeNull()
    expect(await bandal.app.evaluate(() => (globalThis as any).tutorialAiCalls)).toEqual([])
  } finally { await bandal.close() }
})

test('skip restores the original course, active document, and open plugin panel', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal; await guardAi(bandal); await createCourse(page, '원래 과목')
    const original = (await page.evaluate(() => window.bandal.invoke('courses:list', {})))[0]!
    await page.evaluate(courseId => window.bandal.invoke('materials:writeFile', { courseId, dirRelPath: '', fileName: '원래 필기.md', encoding: 'utf8', data: '# 기존 필기\n\n이 내용은 유지됩니다.\n' }), original.id)
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="원래 필기.md"]').click()
    await expect(page.locator('[aria-label="마크다운 필기 편집기"]')).toBeVisible()
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '도구', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '학습 도구' })).toBeVisible()
    await page.evaluate(() => window.bandal.invoke('settings:set', { tutorial: { seenVersion: 0, activeCourseId: null } }))
    await expect(card(page).getByRole('heading')).toHaveText('과목에 자료 모으기')
    await advance(page, 'PDF를 읽고 필기하기', 2)
    await card(page).getByRole('button', { name: '건너뛰기', exact: true }).click()
    await expect(page.locator('.tour-overlay')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: '학습 도구' })).toBeVisible()
    await expect(page.locator('[aria-label="마크다운 필기 편집기"]')).toContainText('이 내용은 유지됩니다.')
    const remaining = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    expect(remaining.map(course => course.id)).toEqual([original.id])
    expect(await page.evaluate(courseId => window.bandal.invoke('materials:readFile', { courseId, relPath: '원래 필기.md' }), original.id)).toMatchObject({ data: expect.stringContaining('이 내용은 유지됩니다.') })
  } finally { await bandal.close() }
})


test('replay leaves the global learning home to show materials and returns to its retained original document', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal; await guardAi(bandal); await createCourse(page, '홈에서 돌아갈 과목')
    const original = (await page.evaluate(() => window.bandal.invoke('courses:list', {})))[0]!
    await page.evaluate(courseId => window.bandal.invoke('materials:writeFile', { courseId, dirRelPath: '', fileName: '홈 이전 필기.md', encoding: 'utf8', data: '# 홈 이전 필기\n\n학습 홈을 열기 전에 읽던 내용입니다.\n' }), original.id)
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="홈 이전 필기.md"]').click()
    await expect(page.locator('[aria-label="마크다운 필기 편집기"]')).toBeVisible()
    const rail = page.getByRole('navigation', { name: '앱 메뉴' })
    await rail.getByRole('button', { name: '학습', exact: true }).click()
    const home = page.getByRole('main', { name: '학습 홈' })
    await expect(home).toBeVisible()
    await page.evaluate(async () => {
      const settings = await window.bandal.invoke('settings:get', {})
      await window.bandal.invoke('settings:set', { tutorial: { ...settings.tutorial, seenVersion: 0 } })
    })
    await expect(card(page).getByRole('heading')).toHaveText('과목에 자료 모으기')
    await expect(home).toBeHidden()
    await expect(page.locator('[data-material-path="예시 강의자료.pdf"]')).toBeVisible()
    await advance(page, 'PDF를 읽고 필기하기', 2)
    await expect(page.locator('.pdf-page').first()).toBeVisible()
    await card(page).getByRole('button', { name: '건너뛰기', exact: true }).click()
    await expect(page.locator('.tour-overlay')).toHaveCount(0)
    await expect(home).toBeVisible()
    await expect(rail.getByRole('button', { name: '학습', exact: true })).toHaveAttribute('data-active', 'true')
    expect((await page.evaluate(() => window.bandal.invoke('courses:list', {}))).map(course => course.id)).toEqual([original.id])
    await rail.getByRole('button', { name: '과목', exact: true }).click()
    await expect(home).toBeHidden()
    await expect(page.locator('[aria-label="마크다운 필기 편집기"]')).toContainText('학습 홈을 열기 전에 읽던 내용입니다.')
    expect(await bandal.app.evaluate(() => (globalThis as any).tutorialAiCalls)).toEqual([])
  } finally { await bandal.close() }
})
