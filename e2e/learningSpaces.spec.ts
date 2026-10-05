import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash } from '../src/main/features/learning/model'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { chooseLearningAi, configureEnglishForm, installLearningAiFixture } from './helpers/learning'

const rail = (bandal: BandalApp) => bandal.page.getByRole('navigation', { name: '앱 메뉴' })
const learning = (bandal: BandalApp) => bandal.page.getByRole('complementary', { name: '학습 공간 목록' })
async function isolateRuns(bandal: BandalApp): Promise<void> {
  await installLearningAiFixture(bandal)
  await bandal.app.evaluate(({ ipcMain }) => {
    const probe = { runs: [] as any[], legacy: [] as any[], generations: [] as any[] }
    ;(globalThis as any).spacesProbe = probe
    for (const channel of ['learning:run', 'study:run']) ipcMain.removeHandler(channel)
    ipcMain.handle('learning:run', (_event, input) => { probe.runs.push(input); return { runId: `run-${probe.runs.length}`, binding: input.binding } })
    ipcMain.handle('study:run', (_event, input) => { probe.legacy.push(input); return { relPath: 'legacy.md' } })
  })
}

test('English starts from explicit topics and AI in an independent space while a Korean course and review space stay separate', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await isolateRuns(bandal)
    await createCourse(page, '한국어 경제 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(course => course.name === '한국어 경제 과목')!)
    writeFileSync(join(course.folderPath, '경제.md'), '# 경제\n\n국내 소비와 생산의 관계를 살펴봅니다.\n')
    await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '경제 복습', topic: '과목 자료', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), course.id)
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="경제.md"]').click()
    await rail(bandal).getByRole('button', { name: '플러그인', exact: true }).click()
    const plugins = page.getByRole('complementary', { name: '플러그인 기능' })
    await plugins.locator('.launcher-feature').filter({ has: page.locator('strong').filter({ hasText: /^영어 이어읽기$/ }) }).getByRole('button').first().click()
    const dialog = page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('학습 공간 이름', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('편한 영어 수준', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('한 편의 읽기 시간', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('학습 AI 모델', { exact: true })).toHaveValue('')
    await expect(dialog.locator('.learning-topic-picker input')).toHaveCount(14)
    await expect(dialog.getByRole('button', { name: '학습 공간 만들기', exact: true })).toBeDisabled()
    await configureEnglishForm(dialog, '우주와 기술')
    await dialog.getByLabel('주제 기술·AI', { exact: true }).check()
    await dialog.getByLabel('주제 과학', { exact: true }).check()
    await expect(dialog.getByLabel('주제 스포츠', { exact: true })).toBeDisabled()
    await expect(dialog.locator('select option[value="default"]')).toHaveCount(0)
    await dialog.getByRole('button', { name: '학습 공간 만들기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('학습 AI 변경')).toHaveText('Gemini · pro')
    const projects = await page.evaluate(async () => (await window.bandal.invoke('learning:list', {})).projects)
    const english = projects.find(project => project.name === '우주와 기술')!
    expect(english).toMatchObject({ purpose: 'english-reading', topicIds: ['space', 'technology-ai', 'science'], readingSetupConfirmed: true, binding: { rootRelPath: '' }, ai: { provider: 'gemini', model: 'pro', effort: null } })
    expect(english.binding.courseId).not.toBe(course.id)
    expect(await bandal.app.evaluate(() => (globalThis as any).spacesProbe.runs)).toEqual([{ binding: english.binding, kind: 'find-articles', packId: 'vocab-chain-en' }])
    expect(await bandal.app.evaluate(() => (globalThis as any).spacesProbe.legacy)).toEqual([])
    await rail(bandal).getByRole('button', { name: '과목', exact: true }).click()
    const courses = page.getByRole('complementary', { name: '과목 목록' })
    await expect(courses.getByRole('button', { name: '한국어 경제 과목', exact: true })).toBeVisible()
    await expect(courses.getByRole('button', { name: '우주와 기술', exact: true })).toHaveCount(0)
    await expect(courses.getByRole('button', { name: '경제 복습', exact: true })).toHaveCount(0)
    await rail(bandal).getByRole('button', { name: '학습', exact: true }).click()
    await expect(learning(bandal).getByRole('region', { name: '영어 이어읽기' })).toContainText('우주와 기술')
    await expect(learning(bandal).getByRole('region', { name: '과목 복습' })).toContainText('경제 복습')
    await page.screenshot({ path: info.outputPath('learning-spaces-separated.png') })
    await learning(bandal).getByRole('region', { name: '과목 복습' }).getByRole('button').first().click()
    await expect(page.locator('.learning-hero:visible')).toContainText('내 자료를 다시 익혀요.')
    await expect(page.getByRole('button', { name: '첫 영어 글 찾기', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '학습 화면' }).getByRole('button', { name: '읽기', exact: true })).toHaveCount(0)
    await page.getByRole('navigation', { name: '학습 화면' }).getByRole('button', { name: '퀴즈 · 카드', exact: true }).click()
    await expect(page.getByRole('button', { name: '내 단어로 퀴즈 만들기', exact: true })).toHaveCount(0)
    await expect(page.locator('.learning-empty:visible')).toContainText('원본 과목 자료')
  } finally { await bandal.close() }
})

test('an unclassified old course root keeps word evidence and its path until explicit workspace classification', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    await isolateRuns(bandal)
    const { page } = bandal
    await createCourse(page, '기존 실제 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(course => course.name === '기존 실제 과목')!)
    // Recreate the already-existing legacy root format, which new folder creation intentionally does not make.
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    const project = await repo.create({ binding: { courseId: course.id, rootRelPath: '' }, name: '예전 학습', topic: 'My old topic' })
    const original = 'An economy changes over time.'
    writeFileSync(join(course.folderPath, 'old.md'), original)
    await page.evaluate(input => window.bandal.invoke('learning:saveWord', input), { binding: project.binding, surface: 'economy', sentence: original, sourceRef: { kind: 'material', pathScope: 'course', relPath: 'old.md', quote: original, contentHash: learningHash(original) } })
    await rail(bandal).getByRole('button', { name: '학습', exact: true }).click()
    await learning(bandal).getByRole('region', { name: '종류 확인 필요' }).getByRole('button').first().click()
    await page.getByRole('button', { name: '학습 종류와 AI 확인하기', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '학습 공간 설정' })
    const classify = settings.getByLabel('이 폴더를 독립 학습 공간으로 분류')
    await expect(classify).not.toBeChecked()
    await settings.getByLabel('학습 공간 종류', { exact: true }).selectOption('course-review')
    await chooseLearningAi(settings)
    await settings.getByRole('button', { name: '설정 저장', exact: true }).click()
    await expect(settings).toBeHidden()
    const saved = await page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), project.binding)
    expect(saved.purpose).toBe('course-review')
    expect(saved.words[0]!.surface).toBe('economy')
    expect(saved.occurrences[0]!.sourceRef.quote).toBe(original)
    expect(saved.binding).toEqual(project.binding)
    expect(await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)?.workspaceKind, course.id)).toBe('course')
    await page.getByRole('button', { name: '공간 설정', exact: true }).click()
    await settings.getByLabel('이 폴더를 독립 학습 공간으로 분류').check()
    await settings.getByRole('button', { name: '설정 저장', exact: true }).click()
    await expect(settings).toBeHidden()
    expect(await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)?.workspaceKind, course.id)).toBe('study-space')
    expect((await page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), project.binding)).occurrences[0]!.sourceRef.quote).toBe(original)
    await page.screenshot({ path: info.outputPath('learning-legacy-confirmed.png') })
  } finally { await bandal.close() }
})

test('a model rejection exposes the actual run details and requires a different model before retry', async () => {
  const bandal = await launchBandal()
  try {
    await isolateRuns(bandal)
    await rail(bandal).getByRole('button', { name: '학습', exact: true }).click()
    await learning(bandal).getByRole('button', { name: '영어 이어읽기 시작하기', exact: true }).click()
    const settings = bandal.page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await configureEnglishForm(settings, '오류 복구 읽기')
    await settings.getByRole('button', { name: '학습 공간 만들기', exact: true }).click()
    await expect(settings).toBeHidden()
    const course = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(course => course.name === '오류 복구 읽기')!)
    const binding = { courseId: course.id, rootRelPath: '' }
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    const timestamp = new Date().toISOString()
    await repo.updateRun({ binding, run: { id: 'rejected', kind: 'find-articles', status: 'failed', provider: 'gemini', model: 'pro', effort: null, sessionId: 'fixture-session', errorCode: 'model-unavailable', errorCategory: 'model', actionable: '다른 모델을 선택하세요.', error: '이 계정에서 모델을 사용할 수 없어요.', articleIds: [], wordIds: [], message: '', draft: null, createdAt: timestamp, updatedAt: timestamp } })
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, binding)
    const failure = bandal.page.locator('.learning-run:visible').filter({ hasText: '이 계정에서 모델' })
    await expect(failure.getByRole('button', { name: '다시 시도', exact: true })).toBeDisabled()
    await failure.getByText('상세 보기', { exact: true }).click()
    await expect(failure).toContainText('model-unavailable')
    await expect(failure).toContainText('fixture-session')
    await failure.getByRole('button', { name: 'AI 모델 다시 선택', exact: true }).click()
    await expect(bandal.page.getByRole('dialog', { name: '학습 공간 설정' })).toBeVisible()
  } finally { await bandal.close() }
})
