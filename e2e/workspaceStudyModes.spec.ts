import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash, splitLearningParagraphs } from '../src/main/features/learning/model'
import type { LearningBinding, LearningSourceRef } from '../src/shared/types/learning'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { configureEnglishForm, installLearningAiFixture, ENGLISH_FIXTURE_SETTINGS } from './helpers/learning'

const assistant = (page: Page) => page.getByRole('region', { name: '공간 AI' })
async function openAi(page: Page): Promise<void> { await page.getByRole('tab', { name: 'AI', exact: true }).click(); await expect(assistant(page).getByRole('textbox', { name: '메시지 입력' })).toBeVisible() }
async function sendMode(page: Page, mode: string, prompt: string): Promise<void> {
  await assistant(page).getByRole('tab', { name: mode, exact: true }).click()
  await assistant(page).getByRole('textbox', { name: '메시지 입력' }).fill(prompt)
  await assistant(page).getByRole('button', { name: '메시지 보내기' }).click()
}
async function fixtureAi(bandal: BandalApp, resultBinding?: LearningBinding): Promise<void> {
  await installLearningAiFixture(bandal)
  await bandal.app.evaluate(({ ipcMain, BrowserWindow }, binding) => {
    const probe = { generations: [] as any[], runs: [] as any[], articles: [] as any[], history: {} as Record<string, any[]> }
    ;(globalThis as any).studyModeProbe = probe
    const replace = (channel: string, fn: (input: any) => unknown) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, input) => fn(input)) }
    replace('chat:open', input => ({ history: probe.history[input.sessionId] ?? [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: input.sessionId, courseId: input.courseId, provider: 'gemini', model: 'pro', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
    replace('learning:run', input => { probe.runs.push(input); return { runId: `fixture-run-${probe.runs.length}`, binding: input.binding } })
    replace('study:generate', input => {
      probe.generations.push(input)
      const index = probe.generations.length, runId = `fixture-generated-${index}`, target = binding ?? input.binding
      if (binding) {
        const conversation = input.conversation, name = input.packId === 'quiz' ? '레일 퀴즈' : '레일 카드'
        const message = (role: string, kind: string, payload: any) => { const id = `fixture-${index}-${role}`; return { id, courseId: input.courseId, sessionId: conversation.sessionId, role, turnSeq: index, createdAt: new Date().toISOString(), blocks: [{ id: `${id}-block`, messageId: id, ord: 0, kind, payload }] } }
        const messages = [message('user', 'text', { text: conversation.content, context: conversation.context }), message('assistant', 'artifact', { courseId: target.courseId, relPath: '', name, kind: 'other', learning: { binding: target, runId } })]
        probe.history[conversation.sessionId] = [...(probe.history[conversation.sessionId] ?? []), ...messages]
        for (const item of messages) for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:message', { sessionId: conversation.sessionId, message: item })
      }
      return { runId, binding: target }
    })
  }, resultBinding ?? null)
}

test('AI modes carry selected-source snapshots and open native quiz and flashcard results in the same conversation', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await fixtureAi(bandal)
    await createCourse(page, '모드 원본 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const biology = '# Biology\n\nCells transform energy.\n'
    writeFileSync(join(course.folderPath, 'biology.md'), biology)
    await installLearningAiFixture(bandal)
    const project = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '모드 원본 복습', topic: 'Biology', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), course.id)
    const projectCourse = await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)!, project.binding.courseId)
    const repo = createLearningRepo({ getCourseFolder: id => id === course.id ? course.folderPath : projectCourse.folderPath })
    const source: LearningSourceRef = { kind: 'material', pathScope: 'course', sourceCourseId: course.id, relPath: 'biology.md', quote: 'Cells transform energy.', contentHash: learningHash(biology) }
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'rail-quiz', kind: 'quiz', title: '레일 퀴즈', questions: [{ id: 'q1', type: 'choice', prompt: 'What do cells transform?', options: [{ id: 'energy', text: 'Energy' }, { id: 'stone', text: 'Stone' }], answer: 'energy', explanation: 'Cells transform energy.', sourceRefs: [source] }] } })
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'rail-cards', kind: 'cards', title: '레일 카드', cards: [{ id: 'card', front: 'Cells', back: 'They transform energy.', sourceRefs: [source] }] } })
    const now = new Date().toISOString()
    for (const [index, kind] of (['create-quiz', 'create-cards'] as const).entries()) await repo.updateRun({ binding: project.binding, run: { id: `fixture-generated-${index + 1}`, kind, status: 'complete', provider: 'fixture', articleIds: [], wordIds: [], resultArtifactIds: [index ? 'rail-cards' : 'rail-quiz'], message: '완료', error: null, draft: null, createdAt: now, updatedAt: now } })
    await fixtureAi(bandal, project.binding)
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="biology.md"]').click()
    await openAi(page)
    await page.getByRole('button', { name: '화면에서 부분 선택' }).click()
    await page.locator('.ProseMirror:visible p').filter({ hasText: 'Cells transform energy.' }).click()
    await expect(page.locator('.chat-annotation-reference')).toHaveCount(1)
    await page.getByRole('button', { name: '부분 선택 마치기' }).click()
    await page.getByRole('textbox', { name: '참조 1 코멘트' }).fill('이 문장을 중심으로')
    expect(await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations)).toEqual([])
    await sendMode(page, '퀴즈', '이 부분으로 객관식 퀴즈를 만들어 줘')
    await expect(page.locator('.chat-study-card')).toContainText('레일 퀴즈')
    const quiz = await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[0])
    expect(quiz).toMatchObject({ courseId: course.id, packId: 'quiz', ai: ENGLISH_FIXTURE_SETTINGS.ai, source: { kind: 'material', relPath: 'biology.md' }, conversation: { content: '이 부분으로 객관식 퀴즈를 만들어 줘', context: { references: [expect.objectContaining({ quote: 'Cells transform energy.', comment: '이 문장을 중심으로', relPath: 'biology.md' })] } } })
    await page.locator('.chat-study-card').getByRole('button', { name: '결과 열기' }).click()
    await expect(page.locator('.learning-quiz:visible')).toContainText('레일 퀴즈')
    await page.getByRole('radio', { name: 'Energy', exact: true }).check()
    await page.getByRole('button', { name: '채점하고 정답 보기' }).click()
    await expect(page.locator('.learning-result')).toContainText('자동 채점 1 / 1')
    await page.getByRole('tab', { name: '과목', exact: true }).click()
    await page.locator('.course-row').filter({ hasText: '모드 원본 과목' }).first().click()
    await openAi(page)
    await page.getByRole('button', { name: '자동 연결 자료 제거' }).click()
    await sendMode(page, '플래시카드', '과목 전체로 플래시카드 만들어 줘')
    await expect(assistant(page)).toContainText('현재 자료를 제외했어요.')
    expect((await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations)).length).toBe(1)
    await assistant(page).getByRole('button', { name: '추가', exact: true }).click(); await page.getByRole('button', { name: /^자료 선택/ }).click()
    await page.getByRole('dialog', { name: '대화에 추가' }).getByRole('button', { name: /biology.md/ }).click()
    await page.getByRole('button', { name: '선택한 1개 추가' }).click()
    await sendMode(page, '플래시카드', '추가한 원본으로 플래시카드 만들어 줘')
    await expect(page.locator('.chat-study-card')).toHaveCount(2)
    const cards = await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[1])
    expect(cards).toMatchObject({ packId: 'flashcards', source: { kind: 'material', relPath: 'biology.md', sourceCourseId: course.id }, conversation: { sessionId: quiz.conversation.sessionId } })
    await page.locator('.chat-study-card').filter({ hasText: '레일 카드' }).getByRole('button', { name: '결과 열기' }).click()
    await page.getByRole('button', { name: '카드 답 확인', exact: true }).click()
    await expect(page.locator('.learning-flashcard')).toContainText('They transform energy.')
    expect((await repo.read(project.binding)).quizAttempts[0]?.score).toBe(1)
    await page.screenshot({ path: info.outputPath('workspace-native-results.png') })
  } finally { await bandal.close() }
})

test('a linked original document supplies current context and all study modes while the independent project owns the conversation', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await fixtureAi(bandal)
    await createCourse(page, '원본 과목 A')
    const owner = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    const originalText = '# Original owner\n\nCells transform energy.\n'
    writeFileSync(join(owner.folderPath, 'original.md'), originalText)
    const project = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '독립 프로젝트 B', topic: 'Biology', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), owner.id)
    const destination = await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(item => item.id === id)!, project.binding.courseId)
    const repo = createLearningRepo({ getCourseFolder: id => id === owner.id ? owner.folderPath : destination.folderPath })
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'linked-quiz', kind: 'quiz', title: '원본으로 가는 퀴즈', questions: [{ id: 'q1', type: 'choice', prompt: 'What do cells transform?', options: [{ id: 'energy', text: 'Energy' }, { id: 'stone', text: 'Stone' }], answer: 'energy', explanation: 'Cells transform energy.', sourceRefs: [{ kind: 'material', pathScope: 'course', sourceCourseId: owner.id, relPath: 'original.md', title: '원본 문서 A', quote: 'Cells transform energy.', contentHash: learningHash(originalText) }] }] } })
    await bandal.app.evaluate(({ BrowserWindow, ipcMain }, binding) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding })
      ipcMain.removeHandler('study:run'); ipcMain.handle('study:run', (_event, req) => { (globalThis as any).studyModeProbe.exam = req; return { relPath: 'AI 학습자료/예상 문제.md' } })
    }, project.binding)
    await page.getByRole('tab', { name: '프로젝트', exact: true }).click()
    await page.locator('.project-list-row__open').filter({ hasText: '독립 프로젝트 B' }).click()
    await page.locator('.project-materials').getByRole('button', { name: '원본으로 가는 퀴즈', exact: true }).click()
    await page.getByRole('radio', { name: 'Energy', exact: true }).check(); await page.getByRole('button', { name: '채점하고 정답 보기' }).click()
    await page.locator('.learning-sources:visible').getByRole('button', { name: '원본 문서 A', exact: true }).click()
    await expect(page.getByLabel('마크다운 필기 편집기')).toContainText('Cells transform energy.')
    await openAi(page)
    await expect(assistant(page).getByLabel('자동 연결 자료', { exact: true })).toContainText('original')
    const scope = `project:${JSON.stringify([project.binding.courseId, project.binding.rootRelPath])}`
    await expect(page.locator('.workspace-course:not([hidden])')).toHaveAttribute('data-workspace-key', scope)
    for (const [index, mode] of ['퀴즈', '플래시카드'].entries()) {
      await sendMode(page, mode, '현재 원본을 이용해 만들어 줘')
      await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations.length)).toBe(index + 1)
      const request = await bandal.app.evaluate((_electron, index) => (globalThis as any).studyModeProbe.generations[index], index)
      expect(request).toMatchObject({ courseId: destination.id, binding: project.binding, source: { kind: 'material', relPath: 'original.md', sourceCourseId: owner.id }, conversation: { workspaceKey: scope } })
    }
    const first = await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[0])
    await sendMode(page, '예상 문제', '현재 원본으로 예상 문제')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.exam)).toMatchObject({ courseId: destination.id, sourceCourseId: owner.id, relPath: 'original.md', conversation: { sessionId: first.conversation.sessionId, workspaceKey: scope } })
    await expect(page.locator('.workspace-course:not([hidden])')).toHaveAttribute('data-workspace-key', scope)
  } finally { await bandal.close() }
})

test('independent project article and vocabulary tabs refresh AI generation source without replacing the conversation', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await fixtureAi(bandal)
    await createCourse(page, '프로젝트 자료 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    await installLearningAiFixture(bandal)
    const original = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'in-course', courseId, rootRelPath: 'Reading', name: '영어 자료 프로젝트', topic: 'Resilient cities' }), course.id)
    const project = await page.evaluate(input => window.bandal.invoke('learning:updateSettings', input), { binding: original.binding, ...ENGLISH_FIXTURE_SETTINGS })
    const binding = project.binding, repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    const sentence = 'Resilient communities adapt to change.'
    await repo.addArticle({ binding, article: { id: 'context-article', title: 'Resilient communities', sourceUrl: 'https://example.org/context-article', paragraphs: splitLearningParagraphs(sentence) } })
    for (const surface of ['Resilient', 'adapt']) { const start = sentence.indexOf(surface); await page.evaluate(input => window.bandal.invoke('learning:saveWord', input), { binding, surface, sentence, sourceRef: { kind: 'article', articleId: 'context-article', paragraphId: 'p1', sentenceId: 'p1-s1', quote: surface, start, end: start + surface.length } }) }
    const wordIds = await page.evaluate(async binding => (await window.bandal.invoke('learning:get', { binding })).words.map(word => word.id), binding)
    await fixtureAi(bandal)
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, binding)
    await page.getByRole('tab', { name: '프로젝트', exact: true }).click()
    await page.locator('.project-list-row__open').filter({ hasText: '영어 자료 프로젝트' }).click()
    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await page.locator('.project-materials').getByRole('button', { name: '단어장' }).click()
    await expect(page.locator('.learning-vocabulary-word')).toHaveCount(2)
    await openAi(page); await sendMode(page, '플래시카드', '저장한 표현으로 카드 만들어 줘')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations.length)).toBe(1)
    const cards = await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[0])
    expect(cards).toMatchObject({ packId: 'flashcards', binding, source: { kind: 'vocabulary', wordIds, sourceCourseId: course.id } })
    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await page.locator('.project-materials').getByRole('button', { name: 'Resilient communities', exact: true }).click()
    await expect(page.locator('.learning-reader:visible h1')).toHaveText('Resilient communities')
    await openAi(page); await sendMode(page, '퀴즈', '이 글로 퀴즈 만들어 줘')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations.length)).toBe(2)
    expect(await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[1])).toMatchObject({ packId: 'quiz', binding, source: { kind: 'article', articleIds: ['context-article'], sourceCourseId: course.id }, conversation: { sessionId: cards.conversation.sessionId } })
    await expect(page.locator('.workspace-tab__title').filter({ hasText: '단어장' })).toBeVisible()
    await expect(page.locator('.workspace-tab__title').filter({ hasText: 'Resilient communities' })).toBeVisible()
  } finally { await bandal.close() }
})

test('Projects starts a fresh English space and resumed browser source uses the live URL from the small-window AI pane', async ({}, info) => {
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(`<html><title>${request.url === '/second' ? 'Live second article' : 'Original article'}</title><body><h1>Browser source</h1><p>Read this fixture in the native browser.</p></body></html>`) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await fixtureAi(bandal)
    await page.getByRole('tab', { name: '프로젝트', exact: true }).click()
    const openNew = async () => { await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click(); await page.getByRole('menuitem', { name: '새 프로젝트', exact: true }).click(); await page.getByRole('dialog', { name: '새 학습' }).getByRole('button').filter({ hasText: '영어 글 읽기' }).click() }
    await openNew()
    const dialog = page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await configureEnglishForm(dialog, '프로젝트 영어 읽기')
    await dialog.getByRole('button', { name: '공간 만들고 첫 글 찾기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.runs[0]?.packId)).toBe('vocab-chain-en')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '프로젝트 영어 읽기')!)
    const binding = { courseId: course.id, rootRelPath: '' }, repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    await repo.addArticle({ binding, article: { id: 'continue-article', title: 'Saved English article', sourceUrl: 'https://example.org/saved', paragraphs: splitLearningParagraphs('The city is changing as people work together.') } })
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, binding)
    await openNew(); await expect(dialog.getByLabel('학습 공간 이름')).toHaveValue(''); await dialog.getByRole('button', { name: '취소', exact: true }).click()
    await page.locator('.project-list-row__open').filter({ hasText: '프로젝트 영어 읽기' }).click()
    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await page.locator('.project-materials').getByRole('button', { name: 'Saved English article', exact: true }).click()
    await expect(page.locator('.learning-reader:visible h1')).toHaveText('Saved English article')
    await bandal.app.evaluate(({ BrowserWindow }, url) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url }) }, `${origin}/first`)
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url && !contents.isLoading()), `${origin}/first`)).toBe(true)
    await bandal.app.evaluate(async ({ webContents }, urls) => webContents.getAllWebContents().find(contents => contents.getURL() === urls.first)!.loadURL(urls.second), { first: `${origin}/first`, second: `${origin}/second` })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1024, 640))
    await openAi(page)
    await expect(assistant(page).locator('.chat-context-auto')).toContainText('Live second article')
    const left = (await page.locator('.right-sidebar').boundingBox())!.x
    await expect.poll(() => bandal.app.evaluate(({ BrowserWindow }, url) => { const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!; const view = host.contentView.children.find((view: any) => view.webContents?.getURL() === url)!; const bounds = view.getBounds(); return bounds.x + bounds.width }, `${origin}/second`)).toBeLessThanOrEqual(Math.ceil(left))
    await bandal.app.evaluate(({ ipcMain }, binding) => { ipcMain.removeHandler('learning:addArticle'); ipcMain.handle('learning:addArticle', (_event, input) => { (globalThis as any).studyModeProbe.articles.push(input); return { binding, addedArticleId: 'browser-live' } }) }, binding)
    expect(await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations)).toEqual([])
    await sendMode(page, '퀴즈', '현재 페이지로 퀴즈 만들어 줘')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations.length)).toBe(1)
    expect(await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.articles[0])).toMatchObject({ binding, url: `${origin}/second`, tabId: expect.any(String), sourceCourseId: course.id })
    expect(await bandal.app.evaluate(() => (globalThis as any).studyModeProbe.generations[0])).toMatchObject({ binding, source: { kind: 'article', articleIds: ['browser-live'], sourceCourseId: course.id } })
    await page.screenshot({ path: info.outputPath('workspace-small-native-browser.png') })
  } finally { await bandal.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
