import { expect, test, type Locator, type Page } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { ENGLISH_FIXTURE_SETTINGS, installLearningAiFixture } from './helpers/learning'

const GUIDE_KEY = 'bandal:english-reading-guide:v1'
const guide = (page: Page) => page.getByRole('dialog', { name: '영어 읽기 사용 방법', exact: true })
const setup = (page: Page) => page.getByRole('dialog', { name: '영어 이어읽기 시작하기', exact: true })
const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })

async function guardAi(bandal: BandalApp): Promise<void> {
  await installLearningAiFixture(bandal)
  await bandal.app.evaluate(({ ipcMain }) => {
    const calls: string[] = []
    ;(globalThis as typeof globalThis & { englishGuideAiCalls: string[] }).englishGuideAiCalls = calls
    for (const channel of ['learning:run', 'study:run', 'study:generate', 'chat:send']) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => { calls.push(channel); throw new Error('Reading guide must not request AI generation') })
    }
  })
}

async function expectNoAi(bandal: BandalApp): Promise<void> {
  expect(await bandal.app.evaluate(() => (globalThis as typeof globalThis & { englishGuideAiCalls: string[] }).englishGuideAiCalls)).toEqual([])
}

async function openNewEnglish(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: '학습', exact: true }).click()
  await page.getByRole('complementary', { name: '학습 공간 목록', exact: true }).getByRole('button', { name: '새 학습', exact: true }).click()
  await page.getByRole('dialog', { name: '새 학습', exact: true }).getByRole('button', { name: '영어 글 읽기', exact: false }).click()
}

async function viewport(bandal: BandalApp, width: number, height: number): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('index.html'))!
    window.setMinimumSize(500, 500)
    window.setContentSize(size.width, size.height)
  }, { width, height })
  await expect.poll(() => bandal.page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height })
}

async function expectContained(dialog: Locator): Promise<void> {
  await expect.poll(() => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1
      && element.scrollWidth <= element.clientWidth + 1
  })).toBe(true)
  const action = dialog.getByRole('button', { name: /^(다음|관심 주제 고르기|읽기 시작하기)$/ })
  await expect.poll(() => action.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1
  })).toBe(true)
}

test('first English entry explains all three steps before setup and fits light, dark and narrow windows', async ({}, info) => {
  const bandal = await launchBandal({ englishReadingGuide: true, extraSettings: { theme: 'light' } })
  try {
    const { page } = bandal
    await guardAi(bandal)
    await viewport(bandal, 1280, 800)
    await openNewEnglish(page)
    const intro = guide(page)
    await expect(intro).toBeVisible()
    await expect(intro.getByRole('heading', { name: '영어 기사 한 편이, 나의 단어가 되는 시간', exact: true })).toBeVisible()
    await expect(intro.getByRole('heading', { name: '좋아하는 이야기로 시작해요', exact: true })).toBeVisible()
    await expect(setup(page)).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBeNull()
    await expectContained(intro)
    await page.screenshot({ path: info.outputPath('english-guide-1-wide-light.png'), animations: 'disabled' })

    // Shift+Tab from the first control and Tab back must stay inside the dialog.
    const close = intro.getByRole('button', { name: '소개 닫기', exact: true })
    await close.focus()
    await page.keyboard.press('Shift+Tab')
    expect(await intro.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()

    await intro.getByRole('button', { name: '다음', exact: true }).click()
    await expect(intro.getByRole('heading', { name: '모르는 단어는, 그 자리에서', exact: true })).toBeVisible()
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'dark' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expectContained(intro)
    await page.screenshot({ path: info.outputPath('english-guide-2-wide-dark.png'), animations: 'disabled' })

    await intro.getByRole('button', { name: '3. 이어 읽기', exact: true }).click()
    await expect(intro.getByRole('heading', { name: '한 번 만난 단어를 오래 기억하도록', exact: true })).toBeVisible()
    await viewport(bandal, 600, 650)
    await expectContained(intro)
    await expect.poll(() => intro.locator('.reading-guide-explanation h3').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const scroller = element.closest('.reading-guide-body')!.getBoundingClientRect()
      return bounds.top >= scroller.top && bounds.bottom <= scroller.bottom
    })).toBe(true)
    await page.screenshot({ path: info.outputPath('english-guide-3-narrow-dark.png'), animations: 'disabled' })
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expectContained(intro)
    await page.screenshot({ path: info.outputPath('english-guide-3-narrow-light.png'), animations: 'disabled' })
    await viewport(bandal, 600, 500)
    await intro.getByRole('region', { name: '단계별 사용 설명' }).focus()
    await page.keyboard.press('PageDown')
    await expect.poll(() => intro.locator('.reading-guide-body').evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    await intro.getByRole('button', { name: '1. 글 찾기', exact: true }).click()
    await expect(intro.getByRole('heading', { name: '좋아하는 이야기로 시작해요', exact: true })).toBeVisible()
    await intro.getByRole('button', { name: '2. 단어 담기', exact: true }).click()
    await expect(intro.getByRole('heading', { name: '모르는 단어는, 그 자리에서', exact: true })).toBeVisible()
    await intro.getByRole('button', { name: '다음', exact: true }).click()
    await intro.getByRole('button', { name: '관심 주제 고르기', exact: true }).click()
    await expect(intro).toBeHidden()
    await expect(setup(page)).toBeVisible()
    await expect(setup(page).getByLabel('학습 공간 이름', { exact: true })).toBeFocused()
    expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBe('seen')
    expect((await page.evaluate(() => window.bandal.invoke('learning:list', {}))).projects).toHaveLength(0)
    await expectNoAi(bandal)
  } finally { await bandal.close() }
})

test('skipping opens setup once and remains acknowledged after reopening and renderer reload', async () => {
  const bandal = await launchBandal({ englishReadingGuide: true })
  try {
    const { page } = bandal
    await guardAi(bandal)
    await openNewEnglish(page)
    await guide(page).getByRole('button', { name: '설정으로 건너뛰기', exact: true }).click()
    await expect(setup(page)).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBe('seen')
    await setup(page).getByRole('button', { name: '취소', exact: true }).click()
    await openNewEnglish(page)
    await expect(setup(page)).toBeVisible()
    await expect(guide(page)).toHaveCount(0)
    await setup(page).getByRole('button', { name: '취소', exact: true }).click()
    await page.reload()
    await expect(page.locator('aside.app-rail--left:visible')).toBeVisible()
    await openNewEnglish(page)
    await expect(setup(page)).toBeVisible()
    await expect(guide(page)).toHaveCount(0)
    await expectNoAi(bandal)
  } finally { await bandal.close() }
})

for (const dismissal of ['close button', 'Escape'] as const) {
  test(`${dismissal} cancels first-use creation and the next entry goes directly to setup`, async () => {
    const bandal = await launchBandal({ englishReadingGuide: true })
    try {
      const { page } = bandal
      await guardAi(bandal)
      await openNewEnglish(page)
      await expect(guide(page)).toBeVisible()
      if (dismissal === 'Escape') await page.keyboard.press('Escape')
      else await guide(page).getByRole('button', { name: '소개 닫기', exact: true }).click()
      await expect(guide(page)).toHaveCount(0)
      await expect(setup(page)).toHaveCount(0)
      expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBe('seen')
      expect((await page.evaluate(() => window.bandal.invoke('learning:list', {}))).projects).toHaveLength(0)
      await openNewEnglish(page)
      await expect(setup(page)).toBeVisible()
      await expect(guide(page)).toHaveCount(0)
      await expectNoAi(bandal)
    } finally { await bandal.close() }
  })
}

test('existing English spaces introduce reading once and can replay it while review spaces have no guide', async () => {
  const bandal = await launchBandal({ englishReadingGuide: true })
  try {
    const { page } = bandal
    await guardAi(bandal)
    await createCourse(page, '원본 과목')
    await page.evaluate(async settings => {
      const source = (await window.bandal.invoke('courses:list', {})).find(course => course.name === '원본 과목')!
      await window.bandal.invoke('learning:create', { placement: 'standalone', name: '기존 영어 읽기', topic: '과학', ...settings })
      await window.bandal.invoke('learning:create', { placement: 'standalone', name: '개념 복습', topic: '과목 자료', purpose: 'course-review', linkedCourseId: source.id, ai: settings.ai })
    }, ENGLISH_FIXTURE_SETTINGS)
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    const spaces = page.getByRole('complementary', { name: '학습 공간 목록', exact: true })
    await spaces.getByRole('button').filter({ has: page.locator('strong').filter({ hasText: /^개념 복습$/ }) }).click()
    await expect(page.locator('.learning-topbar:visible')).toContainText('개념 복습')
    await expect(guide(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '영어 읽기 사용 방법', exact: true })).toHaveCount(0)
    expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBeNull()

    await spaces.getByRole('button').filter({ has: page.locator('strong').filter({ hasText: /^기존 영어 읽기$/ }) }).click()
    await expect(guide(page)).toBeVisible()
    await guide(page).getByRole('button', { name: '3. 이어 읽기', exact: true }).click()
    await guide(page).getByRole('button', { name: '읽기 시작하기', exact: true }).click()
    await expect(guide(page)).toHaveCount(0)
    await expect(page.locator('.learning-topbar:visible')).toContainText('기존 영어 읽기')
    expect(await page.evaluate(key => localStorage.getItem(key), GUIDE_KEY)).toBe('seen')
    const replay = page.getByRole('button', { name: '영어 읽기 사용 방법', exact: true })
    await replay.click()
    await expect(guide(page).getByRole('heading', { name: '좋아하는 이야기로 시작해요', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(guide(page)).toHaveCount(0)
    await expect(replay).toBeFocused()
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await spaces.getByRole('button').filter({ has: page.locator('strong').filter({ hasText: /^기존 영어 읽기$/ }) }).click()
    await expect(page.locator('.learning-topbar:visible')).toContainText('기존 영어 읽기')
    await expect(guide(page)).toHaveCount(0)
    await expectNoAi(bandal)
  } finally { await bandal.close() }
})
