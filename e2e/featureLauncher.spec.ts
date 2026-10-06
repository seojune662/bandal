import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash, splitLearningParagraphs } from '../src/main/features/learning/model'
import type { LearningBinding, LearningSourceRef } from '../src/shared/types/learning'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { configureEnglishForm, installLearningAiFixture, ENGLISH_FIXTURE_SETTINGS } from './helpers/learning'

const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })
const launcher = (page: Page) => page.getByRole('complementary', { name: '학습 도구' })
const feature = (page: Page, label: string) => launcher(page).locator('.launcher-feature').filter({ has: page.locator('strong').filter({ hasText: new RegExp(`^${label}$`) }) })
async function openLauncher(page: Page): Promise<void> {
  const opening = !await launcher(page).isVisible()
  if (opening) await rail(page).getByRole('button', { name: '도구', exact: true }).click()
  await expect(launcher(page)).toBeVisible()
  if (opening) await expect(launcher(page).getByLabel('기능 검색')).toBeFocused()
}
async function currentSource(page: Page, label: '퀴즈' | '카드', scope: 'selection' | 'material'): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: `${label} 만들기`, exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('학습 원본 선택').selectOption('current')
  await dialog.getByLabel('학습 원본 범위').selectOption(scope)
  await expect(dialog.getByRole('button', { name: `${label} 만들기`, exact: true })).toBeEnabled()
  return dialog
}

async function isolateAi(bandal: BandalApp, binding?: LearningBinding): Promise<void> {
  await installLearningAiFixture(bandal)
  await bandal.app.evaluate(({ ipcMain, BrowserWindow }, binding) => {
    const probe = { sends: [] as any[], generations: [] as any[], runs: [] as any[] }
    ;(globalThis as any).launcherProbe = probe
    const replace = (channel: string, handler: (input: any) => unknown): void => {
      ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, input) => handler(input))
    }
    replace('chat:open', input => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: input.sessionId, courseId: input.courseId, provider: 'claude-code', model: 'default', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
    replace('chat:send', input => {
      probe.sends.push(input)
      setTimeout(() => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:event-batch', { courseId: input.courseId, sessionId: input.sessionId, seq: 1, events: [{ type: 'turn-started', turnSeq: 1 }, { type: 'text-final', blockId: 'fixture-answer', text: '현재 자료에 연결된 답변입니다.' }, { type: 'turn-complete', stopReason: 'success' }] }) }, 30)
      return { turnSeq: 1 }
    })
    replace('learning:run', input => { probe.runs.push(input); return { runId: `fixture-run-${probe.runs.length}`, binding: input.binding } })
    if (binding) replace('study:generate', input => { probe.generations.push(input); return { runId: `fixture-generated-${probe.generations.length}`, binding } })
  }, binding ?? null)
}

test('thin-rail AI reuses the exact document draft and plugin actions use the captured selection for native quiz and cards', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '레일 문맥')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '레일 문맥')!)
    const biology = '# Biology\n\nCells transform energy.\n'
    writeFileSync(join(course.folderPath, 'biology.md'), biology)
    writeFileSync(join(course.folderPath, 'other.md'), '# Other\n\nA different document.\n')
    await installLearningAiFixture(bandal)
    const project = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '레일 문맥 복습', topic: 'Biology', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), course.id)
    const projectCourse = await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)!, project.binding.courseId)
    const repo = createLearningRepo({ getCourseFolder: id => id === course.id ? course.folderPath : projectCourse.folderPath })
    const source: LearningSourceRef = { kind: 'material', pathScope: 'course', sourceCourseId: course.id, relPath: 'biology.md', quote: 'Cells transform energy.', contentHash: learningHash(biology) }
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'rail-quiz', kind: 'quiz', title: '레일 퀴즈', questions: [{ id: 'q1', type: 'choice', prompt: 'What do cells transform?', options: [{ id: 'energy', text: 'Energy' }, { id: 'stone', text: 'Stone' }], answer: 'energy', explanation: 'Cells transform energy.', sourceRefs: [source] }] } })
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'rail-cards', kind: 'cards', title: '레일 카드', cards: [{ id: 'card', front: 'Cells', back: 'They transform energy.', sourceRefs: [source] }] } })
    const now = new Date().toISOString()
    for (const [index, kind] of (['create-quiz', 'create-cards'] as const).entries()) await repo.updateRun({ binding: project.binding, run: { id: `fixture-generated-${index + 1}`, kind, status: 'complete', provider: 'fixture', articleIds: [], wordIds: [], resultArtifactIds: [index ? 'rail-cards' : 'rail-quiz'], message: '완료', error: null, draft: null, createdAt: now, updatedAt: now } })
    await isolateAi(bandal, project.binding)
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="biology.md"]').click()
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    const assistant = page.locator('.tab-assistant:visible')
    const composer = assistant.getByRole('textbox', { name: '메시지 입력' })
    await expect(composer).toBeFocused()
    await composer.fill('원래 필기의 초안')
    await assistant.getByRole('button', { name: 'AI 보조 사이드바 접기', exact: true }).click()
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    await expect(composer).toHaveValue('원래 필기의 초안')
    await expect(composer).toBeFocused()
    await expect(assistant.locator('.chat-context-auto')).toContainText('biology.md')
    await assistant.getByRole('button', { name: '메시지 보내기', exact: true }).click()
    await expect(assistant).toContainText('현재 자료에 연결된 답변입니다.')
    const sent = await bandal.app.evaluate(() => (globalThis as any).launcherProbe.sends[0])
    expect(sent.context.sourcePanelId).toBe(`note:${course.id}:biology.md`)
    await page.locator('[data-material-path="other.md"]').click()
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    await expect(page.locator('.tab-assistant:visible').getByRole('textbox', { name: '메시지 입력' })).toHaveValue('')
    await page.locator('[data-material-path="biology.md"]').click()
    await assistant.getByRole('button', { name: 'AI 보조 사이드바 접기', exact: true }).click()
    const editor = page.getByLabel('마크다운 필기 편집기').locator('[contenteditable="true"]:visible')
    await editor.evaluate(element => {
      const node = Array.from(element.querySelectorAll('p')).find(item => item.textContent === 'Cells transform energy.')!.firstChild!
      const range = document.createRange(); range.selectNodeContents(node)
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await openLauncher(page)
    await expect(launcher(page).getByRole('region', { name: '현재 실행 대상' })).toHaveCount(0)
    await feature(page, '퀴즈 만들기').getByRole('button').first().click()
    const quizDialog = page.getByRole('dialog', { name: '퀴즈 만들기', exact: true })
    await expect(quizDialog.getByLabel('학습 원본 선택')).toHaveValue('')
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(0)
    await currentSource(page, '퀴즈', 'selection')
    await expect(quizDialog.locator('blockquote')).toHaveText('Cells transform energy.')
    await expect(quizDialog.getByLabel('실행 내용 확인')).toContainText('biology.md')
    await expect(quizDialog.getByLabel('실행 내용 확인')).toContainText('레일 문맥 복습')
    await expect(quizDialog.getByLabel('실행 내용 확인')).toContainText('gemini · pro')
    await page.screenshot({ path: info.outputPath('launcher-selection-preview.png') })
    await quizDialog.getByRole('button', { name: '퀴즈 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(1)
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations[0])).toMatchObject({ courseId: course.id, packId: 'quiz', binding: project.binding, ai: ENGLISH_FIXTURE_SETTINGS.ai, source: { kind: 'material', relPath: 'biology.md', selection: 'Cells transform energy.' } })
    await expect(page.locator('.learning-topbar:visible')).toContainText('레일 문맥 복습')
    await expect(feature(page, '퀴즈 만들기').locator('[role="status"]')).toHaveAttribute('data-phase', 'complete')
    await feature(page, '퀴즈 만들기').getByRole('button', { name: '결과 열기', exact: true }).click()
    await expect(page.locator('.learning-quiz:visible')).toContainText('레일 퀴즈')
    await page.getByRole('radio', { name: 'Energy', exact: true }).check()
    await page.getByRole('button', { name: '채점하고 정답 보기', exact: true }).click()
    await expect(page.locator('.learning-result')).toContainText('자동 채점 1 / 1')
    await feature(page, '카드 만들기').getByRole('button').first().click()
    const cardsDialog = page.getByRole('dialog', { name: '카드 만들기', exact: true })
    await cardsDialog.getByLabel('학습 원본 선택').selectOption('course')
    await cardsDialog.getByLabel('학습 원본 과목').selectOption(course.id)
    await expect(cardsDialog.getByLabel('실행 내용 확인')).toContainText('레일 문맥 · 과목 전체')
    await expect(cardsDialog.getByLabel('실행 내용 확인')).toContainText('레일 문맥 복습')
    await expect(cardsDialog.getByRole('button', { name: '카드 만들기', exact: true })).toBeEnabled()
    await cardsDialog.getByRole('button', { name: '카드 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(2)
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations[1])).toMatchObject({ courseId: course.id, packId: 'flashcards', binding: project.binding, source: { kind: 'course', sourceCourseId: course.id } })
    await expect(feature(page, '카드 만들기').locator('[role="status"]')).toHaveAttribute('data-phase', 'complete')
    await feature(page, '카드 만들기').getByRole('button', { name: '결과 열기', exact: true }).click()
    await page.getByRole('button', { name: '카드 답 확인', exact: true }).click()
    await expect(page.locator('.learning-flashcard')).toContainText('They transform energy.')
    await page.screenshot({ path: info.outputPath('launcher-native-review.png') })
    expect((await repo.read(project.binding)).quizAttempts[0]?.score).toBe(1)
  } finally { await bandal.close() }
})

test('launcher preserves search and rail width across courses while pack and installed extension availability update immediately', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '기능 첫 과목')
    await openLauncher(page)
    const initial = (await launcher(page).boundingBox())!.width
    const resizer = await page.getByRole('separator', { name: '과목 사이드바 폭 조절' }).boundingBox()
    await page.mouse.move(resizer!.x + resizer!.width / 2, resizer!.y + 80)
    await page.mouse.down(); await page.mouse.move(resizer!.x + resizer!.width / 2 + 60, resizer!.y + 80); await page.mouse.up()
    await expect.poll(async () => Math.round((await launcher(page).boundingBox())!.width)).toBe(Math.round(initial + 60))
    await launcher(page).getByLabel('기능 검색').fill('퀴즈')
    await page.evaluate(() => window.bandal.invoke('packs:setEnabled', { id: 'quiz', enabled: false }))
    await expect(feature(page, '퀴즈 만들기').getByRole('button').first()).toBeDisabled()
    await expect(feature(page, '퀴즈 만들기')).toContainText('비활성화')
    await page.evaluate(() => window.bandal.invoke('packs:setEnabled', { id: 'quiz', enabled: true }))
    await expect(feature(page, '퀴즈 만들기').getByRole('button').first()).toBeEnabled()
    await rail(page).getByRole('button', { name: '과목', exact: true }).click()
    await createCourse(page, '기능 둘째 과목')
    await openLauncher(page)
    await expect(launcher(page).getByLabel('기능 검색')).toHaveValue('퀴즈')
    await expect(launcher(page).getByRole('region', { name: '현재 실행 대상' })).toHaveCount(0)
    expect(Math.round((await launcher(page).boundingBox())!.width)).toBe(Math.round(initial + 60))
    await page.evaluate(path => window.bandal.invoke('plugins:installFromFolder', { path }), resolve(__dirname, '../examples/plugins/word-count'))
    await launcher(page).getByLabel('기능 검색').fill('단어 수')
    const command = feature(page, '현재 과목 필기 단어 수').getByRole('button').first()
    await expect(command).toBeDisabled()
    await page.evaluate(async () => {
      await window.bandal.invoke('plugins:approve', { id: 'bandal.word-count' })
      await window.bandal.invoke('plugins:setEnabled', { id: 'bandal.word-count', enabled: true })
    })
    await expect(command).toBeEnabled()
    await command.click()
    await expect(page.getByText('기능 둘째 과목: 단어 0개 · 글자 0자', { exact: false })).toBeVisible()
    await feature(page, '단어 수').getByRole('button').first().click()
    await expect(page.locator('.plugin-panel[data-state="active"] webview')).toBeAttached()
    await expect.poll(() => bandal.app.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('bandal-plugin://bandal.word-count/ui/') && !contents.isLoading()))).toBe(true)
    await page.evaluate(() => window.bandal.invoke('plugins:setEnabled', { id: 'bandal.word-count', enabled: false }))
    await expect(command).toBeDisabled()
    await expect(feature(page, '단어 수').getByRole('button').first()).toBeDisabled()
    await page.screenshot({ path: info.outputPath('launcher-installed-features.png') })
  } finally { await bandal.close() }
})

test('same learning panel refreshes article and vocabulary targets without reopening the launcher', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '학습 화면 문맥')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '학습 화면 문맥')!)
    await installLearningAiFixture(bandal)
    const original = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'in-course', courseId, rootRelPath: 'Reading', name: '영어 화면 문맥', topic: 'Resilient cities' }), course.id)
    const project = await page.evaluate(input => window.bandal.invoke('learning:updateSettings', input), { binding: original.binding, ...ENGLISH_FIXTURE_SETTINGS })
    const binding = project.binding
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    const sentence = 'Resilient communities adapt to change.'
    await repo.addArticle({ binding, article: { id: 'context-article', title: 'Resilient communities', sourceUrl: 'https://example.org/context-article', paragraphs: splitLearningParagraphs(sentence) } })
    for (const surface of ['Resilient', 'adapt']) {
      const start = sentence.indexOf(surface)
      await page.evaluate(input => window.bandal.invoke('learning:saveWord', input), { binding, surface, sentence, sourceRef: { kind: 'article', articleId: 'context-article', paragraphId: 'p1', sentenceId: 'p1-s1', quote: surface, start, end: start + surface.length } })
    }
    const wordIds = await page.evaluate(async binding => (await window.bandal.invoke('learning:get', { binding })).words.map(word => word.id), binding)
    await isolateAi(bandal, binding)
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, binding)
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await page.getByRole('region', { name: '이어서 학습하기' }).getByRole('button').filter({ hasText: '영어 화면 문맥' }).click()
    await expect(page.locator('.learning-reader:visible h1')).toHaveText('Resilient communities')
    await openLauncher(page)
    const panels = () => page.evaluate(async courseId => {
      const layout = (await window.bandal.invoke('layout:get', { courseId })).layout as { panels?: Record<string, { params?: { descriptor?: { kind: string; payload: { view?: string } } } }> } | null
      return Object.entries(layout?.panels ?? {}).filter(([, panel]) => panel.params?.descriptor?.kind === 'learning').map(([id, panel]) => ({ id, view: panel.params!.descriptor!.payload.view }))
    }, course.id)
    const panelId = `learning:${course.id}:project:Reading`
    await expect.poll(panels).toEqual([{ id: panelId, view: 'reader' }])
    const navigation = page.locator('.learning-panel:visible').getByRole('navigation', { name: '학습 화면' })
    await navigation.getByRole('button', { name: '나의 단어', exact: true }).click()
    await expect(page.locator('.learning-vocabulary-word')).toHaveCount(2)
    await expect(feature(page, '카드 만들기').getByRole('button').first()).toBeEnabled()
    await expect.poll(panels).toEqual([{ id: panelId, view: 'vocabulary' }])
    await feature(page, '카드 만들기').getByRole('button').first().click()
    const cardsDialog = await currentSource(page, '카드', 'material')
    await expect(cardsDialog.getByLabel('실행 내용 확인')).toContainText('단어장')
    await expect(cardsDialog.getByLabel('실행 내용 확인')).toContainText('영어 화면 문맥')
    await cardsDialog.getByRole('button', { name: '카드 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(1)
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations[0])).toEqual({ courseId: course.id, packId: 'flashcards', binding: { courseId: course.id, rootRelPath: 'Reading' }, ai: ENGLISH_FIXTURE_SETTINGS.ai, source: { kind: 'vocabulary', wordIds, sourceCourseId: course.id } })
    await navigation.getByRole('button', { name: '읽기', exact: true }).click()
    await expect(page.locator('.learning-reader:visible h1')).toHaveText('Resilient communities')
    await expect(feature(page, '퀴즈 만들기').getByRole('button').first()).toBeEnabled()
    await expect.poll(panels).toEqual([{ id: panelId, view: 'reader' }])
    await feature(page, '퀴즈 만들기').getByRole('button').first().click()
    const quizDialog = await currentSource(page, '퀴즈', 'material')
    await expect(quizDialog.getByLabel('실행 내용 확인')).toContainText('Resilient communities')
    await quizDialog.getByRole('button', { name: '퀴즈 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(2)
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations[1])).toEqual({ courseId: course.id, packId: 'quiz', binding: { courseId: course.id, rootRelPath: 'Reading' }, ai: ENGLISH_FIXTURE_SETTINGS.ai, source: { kind: 'article', articleIds: ['context-article'], sourceCourseId: course.id } })
  } finally { await bandal.close() }
})

test('English always starts a new space, home resumes it, and the source wizard captures the live browser URL outside the small-window panel', async ({}, info) => {
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(`<html><title>${request.url === '/second' ? 'Live second article' : 'Original article'}</title><body><h1>Browser source</h1><p>Read this public-facing fixture in the native browser.</p></body></html>`) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await isolateAi(bandal)
    await openLauncher(page)
    await feature(page, '영어 글 읽기').getByRole('button').first().click()
    const dialog = page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await expect(dialog).toBeVisible()
    await configureEnglishForm(dialog, '레일 영어 읽기')
    await dialog.getByRole('button', { name: '공간 만들고 첫 글 찾기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.learning-topbar:visible')).toContainText('레일 영어 읽기')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).launcherProbe.runs[0]?.packId)).toBe('vocab-chain-en')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '레일 영어 읽기')!)
    const binding = { courseId: course.id, rootRelPath: '' }
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    await repo.addArticle({ binding, article: { id: 'continue-article', title: 'Saved English article', sourceUrl: 'https://example.org/saved', paragraphs: splitLearningParagraphs('The city is changing as people work together. They have new ideas and learn from one another.') } })
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, binding)
    await openLauncher(page)
    await feature(page, '영어 글 읽기').getByRole('button').first().click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('학습 공간 이름')).toHaveValue('')
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await page.getByRole('region', { name: '이어서 학습하기' }).getByRole('button').filter({ hasText: '레일 영어 읽기' }).click()
    await expect(page.locator('.learning-reader:visible h1')).toHaveText('Saved English article')
    await page.getByRole('button', { name: '새 탭 열기', exact: true }).click()
    await page.getByLabel('새 탭 검색').fill(`${origin}/first`)
    await page.getByRole('option', { name: `${origin}/first 열기` }).click()
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url && !contents.isLoading()), `${origin}/first`)).toBe(true)
    await bandal.app.evaluate(async ({ webContents }, { first, second }) => webContents.getAllWebContents().find(contents => contents.getURL() === first)!.loadURL(second), { first: `${origin}/first`, second: `${origin}/second` })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1024, 640))
    await openLauncher(page)
    const right = (await launcher(page).boundingBox())!.x + (await launcher(page).boundingBox())!.width
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as import('electron').WebContentsView).webContents.getURL() === url)
      return view?.getBounds().x ?? -1
    }, `${origin}/second`)).toBeGreaterThanOrEqual(Math.floor(right))
    const nativeVisible = () => bandal.app.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as import('electron').WebContentsView).webContents.getURL() === url)
      return view?.getVisible() ?? null
    }, `${origin}/second`)
    await expect.poll(nativeVisible).toBe(true)
    await feature(page, '퀴즈 만들기').getByRole('button').first().click()
    const sourceDialog = page.getByRole('dialog', { name: '퀴즈 만들기', exact: true })
    await sourceDialog.getByLabel('학습 원본 선택').selectOption('current')
    await sourceDialog.getByLabel('학습 원본 범위').selectOption('material')
    await expect(sourceDialog.getByLabel('실행 내용 확인')).toContainText('Live second article')
    await expect(sourceDialog.getByLabel('실행 내용 확인')).toContainText(`${origin}/second`)
    await expect(sourceDialog.getByLabel('실행 내용 확인')).toContainText('레일 영어 읽기')
    await expect(sourceDialog.getByLabel('실행 내용 확인')).not.toContainText('복습 · 새 공간')
    await expect(sourceDialog.getByLabel('실행 내용 확인')).toContainText('gemini · pro')
    await expect(sourceDialog.getByRole('button', { name: '퀴즈 만들기', exact: true })).toBeEnabled()
    expect(await bandal.app.evaluate(() => (globalThis as any).launcherProbe.generations.length)).toBe(0)
    await expect.poll(nativeVisible).toBe(false)
    await page.screenshot({ path: info.outputPath('launcher-small-native-browser.png'), animations: 'disabled' })
    await sourceDialog.getByRole('button', { name: '취소', exact: true }).click()
    await expect.poll(nativeVisible).toBe(true)
  } finally { await bandal.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
