import { expect, test } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { LearningBinding, LearningSourceRef } from '../src/shared/types/learning'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash, splitLearningParagraphs } from '../src/main/features/learning/model'
import { BUILTIN_PACKS } from '../src/shared/workflowPacks/builtins'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { configureEnglishForm, installLearningAiFixture, ENGLISH_FIXTURE_SETTINGS } from './helpers/learning'

/** Keep provider authentication/network out of these native storage/UI checks. */
async function isolateProvider(bandal: BandalApp): Promise<void> {
  await installLearningAiFixture(bandal)
  await bandal.app.evaluate(({ ipcMain }) => {
    const requests: unknown[] = []
    ;(globalThis as unknown as { learningTestRuns: unknown[] }).learningTestRuns = requests
    ipcMain.removeHandler('learning:run')
    ipcMain.handle('learning:run', (_event, input) => {
      requests.push(input)
      return { runId: `fixture-run-${requests.length}`, binding: input.binding }
    })
  })
}

async function publishChange(bandal: BandalApp, binding: LearningBinding): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, value) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding: value })
  }, binding)
}

test('native learning keeps article evidence, quiz results, card schedules and edited import previews through restart', async ({}, info) => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profileDir = bandal.profileDir
  try {
    await isolateProvider(bandal)
    let page = bandal.page
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '학습', exact: true }).click()
    await page.getByRole('complementary', { name: '학습 공간 목록' }).getByRole('button', { name: '새 학습', exact: true }).click()
    await page.getByRole('dialog', { name: '새 학습', exact: true }).getByRole('button', { name: '영어 글 읽기', exact: false }).click()
    const dialog = page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('한 편의 읽기 시간')).toHaveValue('')
    await configureEnglishForm(dialog, '도시의 회복력', '사회·문화')
    await dialog.getByRole('button', { name: '공간 만들고 첫 글 찾기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.learning-topbar:visible')).toContainText('도시의 회복력')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '도시의 회복력')!)
    const binding = { courseId: course.id, rootRelPath: '' }
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    expect((await repo.read(binding)).readingMinutes).toBe(4)

    const firstText = 'Resilient teams build resilient cities. People adapt to change.'
    await repo.addArticle({ binding, article: { id: 'article-1', title: 'Building resilient cities', sourceUrl: 'https://example.test/resilient-cities', siteName: 'Learning fixture', paragraphs: splitLearningParagraphs(firstText) } })
    await repo.addArticle({ binding, article: { id: 'article-2', title: 'A resilient community', sourceUrl: 'https://example.test/community', paragraphs: splitLearningParagraphs('A resilient community adapts to change. Neighbors support one another.') } })
    const source: LearningSourceRef = { kind: 'article', articleId: 'article-1', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'resilient', start: 22, end: 31, title: 'Building resilient cities' }
    await repo.putArtifact({ binding, artifact: { id: 'quiz-1', kind: 'quiz', title: '회복력 이해하기', articleIds: ['article-1'], questions: [
      { id: 'q1', type: 'choice', prompt: 'What can resilient communities do?', options: [{ id: 'avoid', text: 'Avoid every change' }, { id: 'adapt', text: 'Recover and adapt' }], answer: 'adapt', explanation: 'The article describes adapting to change.', sourceRefs: [source] },
      { id: 'q2', type: 'cloze', prompt: '___ teams build strong cities.', answer: 'resilient', explanation: 'Resilient means able to recover.', sourceRefs: [source] },
      { id: 'q3', type: 'short-answer', prompt: 'Explain resilience in your own words.', answer: '', modelAnswer: 'A resilient community can recover and adapt to change.', checkingPoints: ['Mentions recovery or adaptation'], explanation: '', sourceRefs: [source] }
    ] } })
    await repo.putArtifact({ binding, artifact: { id: 'cards-1', kind: 'cards', title: '문맥 속 단어 카드', cards: [{ id: 'resilient-card', front: 'resilient', back: '회복력이 있는', sourceRefs: [source] }] } })
    await publishChange(bandal, binding)

    const nav = () => page.getByRole('navigation', { name: '학습 화면' })
    await nav().getByRole('button', { name: '읽기', exact: true }).click()
    await expect(page.locator('.learning-reader h1')).toHaveText('Building resilient cities')
    await page.getByRole('button', { name: '“resilient” 단어 선택', exact: true }).click()
    await expect(page.locator('.learning-word-selection blockquote')).toHaveText('Resilient teams build resilient cities.')
    await page.getByLabel('뜻 또는 나의 메모').fill('회복력이 있는')
    await page.getByRole('button', { name: '모르는 단어로 담기', exact: true }).click()
    await expect(page.locator('.learning-word-mini-list')).toContainText('회복력이 있는')
    const saved = await repo.read(binding)
    expect(saved.words).toHaveLength(1)
    expect(saved.occurrences[0]!.sourceRef).toMatchObject({ quote: 'resilient', start: 22, end: 31 })
    expect(saved.occurrences[0]!.sentence).toBe('Resilient teams build resilient cities.')
    await page.screenshot({ path: info.outputPath('learning-reader.png') })
    await page.getByRole('button', { name: '이 글의 문맥 설명', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { learningTestRuns: { kind: string }[] }).learningTestRuns.some(item => item.kind === 'explain-word'))).toBe(true)
    await page.getByRole('button', { name: '읽기 완료 · 다음 글 찾기', exact: true }).click()
    await expect(page.locator('.learning-article-card__status[data-status="completed"]')).toHaveCount(1)
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { learningTestRuns: { kind: string }[] }).learningTestRuns.filter(item => item.kind === 'find-articles').length)).toBe(2)
    await page.locator('.learning-article-card').filter({ hasText: 'A resilient community' }).click()
    await expect(page.locator('.learning-reader-word[data-recurring="true"]')).toHaveText('resilient')
    await page.getByRole('button', { name: '“resilient” 단어 선택', exact: true }).click()
    await expect(page.locator('.learning-prior-examples')).toContainText('Resilient teams build resilient cities.')
    await page.getByLabel('뜻 또는 나의 메모').fill('변화에 잘 적응하는')
    await page.getByRole('button', { name: '이 문맥도 단어장에 담기', exact: true }).click()
    await expect.poll(async () => (await repo.read(binding)).occurrences.length).toBe(2)
    expect((await repo.read(binding)).words).toHaveLength(1)

    await nav().getByRole('button', { name: '퀴즈 · 카드' }).click()
    await page.locator('.learning-artifact-card').filter({ hasText: '회복력 이해하기' }).click()
    await expect(page.getByText('The article describes adapting to change.', { exact: true })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Recover and adapt' }).check()
    await page.getByLabel('2번 답 입력').fill('  RESILIENT  ')
    await page.getByLabel('3번 답 입력').fill('It can recover from change.')
    await expect(page.getByRole('button', { name: '채점하고 정답 보기', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '모범 답안과 비교하기', exact: true }).click()
    await page.getByRole('button', { name: '잘 설명했어요', exact: true }).click()
    await page.getByRole('button', { name: '채점하고 정답 보기', exact: true }).click()
    await expect(page.locator('.learning-result')).toContainText('자동 채점 2 / 2')
    await expect(page.locator('.learning-result')).toContainText('단답형 자기 확인 1 / 1')
    await expect(page.getByText('The article describes adapting to change.', { exact: true })).toBeVisible()
    await nav().getByRole('button', { name: '퀴즈 · 카드' }).click()
    await page.locator('.learning-artifact-card').filter({ hasText: '문맥 속 단어 카드' }).click()
    await expect(page.locator('.learning-flashcard')).not.toContainText('회복력이 있는')
    await page.getByRole('button', { name: '카드 답 확인', exact: true }).click()
    await expect(page.locator('.learning-flashcard')).toContainText('회복력이 있는')
    await page.getByRole('button', { name: '기억함', exact: false }).click()
    await expect(page.locator('.learning-review-complete')).toContainText('오늘의 복습을 마쳤어요.')
    const reviewed = (await repo.read(binding)).cards[0]!
    expect(reviewed.repetitions).toBe(1)
    expect(reviewed.intervalDays).toBe(1)
    expect(Date.parse(reviewed.dueAt)).toBeGreaterThan(Date.parse(reviewed.lastReviewedAt!))

    const oldPath = join(course.folderPath, '기존 카드.md')
    const oldContent = '# Vocabulary\n\n| Front | Back |\n| --- | --- |\n| resilient | 회복력이 있는 |\n\nCommunities adapt to change.\n'
    writeFileSync(oldPath, oldContent)
    await repo.updateRun({ binding, run: { id: 'import-1', kind: 'import-material', status: 'awaiting-confirmation', provider: 'fixture', articleIds: [], wordIds: [], source: { kind: 'material', relPath: '기존 카드.md' }, message: '미리보기를 확인하세요.', error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), draft: { version: 1, words: [{ surface: 'adapt', lemma: 'adapt', meaning: '적응하다', sentence: 'Communities adapt to change.', sourceRef: { kind: 'material', pathScope: 'course', relPath: '기존 카드.md', quote: 'Communities adapt to change.', contentHash: learningHash(oldContent) } }], artifacts: [{ id: 'import-cards', kind: 'cards', title: '변환된 카드', cards: [{ id: 'import-card', front: 'resilient', back: '회복력이 있는', sourceRefs: [{ kind: 'material', pathScope: 'course', relPath: '기존 카드.md', quote: 'resilient', contentHash: learningHash(oldContent) }] }] }] } } })
    await publishChange(bandal, binding)
    const preview = page.getByRole('region', { name: '학습 자료 변환 미리보기' })
    await expect(preview).toBeVisible()
    await expect(preview.locator('.learning-preview-word')).toContainText('Communities adapt to change.')
    await preview.getByLabel('단어 뜻', { exact: true }).fill('새 환경에 적응하다')
    await preview.getByLabel('자료 제목').fill('내가 확인한 카드')
    await preview.getByLabel('뒷면').fill('회복력과 적응력이 있는')
    await preview.getByRole('button', { name: '새 학습 자료로 저장', exact: true }).click()
    await expect(preview).toBeHidden()
    await expect(page.locator('.learning-artifact-card').filter({ hasText: '내가 확인한 카드' })).toBeVisible()
    expect(readFileSync(oldPath, 'utf8')).toBe(oldContent)
    const imported = await repo.readArtifact(binding, 'import-cards')
    expect(imported.kind === 'cards' && imported.cards[0]!.back).toBe('회복력과 적응력이 있는')
    expect((await repo.read(binding)).words.find(word => word.surface === 'adapt')?.meaning).toBe('새 환경에 적응하다')

    await nav().getByRole('button', { name: '나의 단어', exact: true }).click()
    const resilientWord = page.locator('.learning-vocabulary-word').filter({ hasText: 'resilient' })
    await resilientWord.locator('summary').click()
    await resilientWord.getByLabel('품사', { exact: true }).fill('adjective')
    await resilientWord.getByLabel('나의 뜻 정리', { exact: true }).fill('회복할 수 있는')
    await resilientWord.locator('.learning-word-edit').getByRole('button', { name: '저장', exact: true }).click()
    await expect.poll(async () => (await repo.read(binding)).words[0]!.partOfSpeech).toBe('adjective')
    await resilientWord.getByLabel('이 문장에서 쓰인 뜻', { exact: true }).nth(1).fill('새 상황에 적응하는')
    await resilientWord.getByRole('button', { name: '예문 뜻 저장', exact: true }).nth(1).click()
    await expect.poll(async () => (await repo.read(binding)).occurrences[1]!.meaning).toBe('새 상황에 적응하는')
    expect((await repo.read(binding)).occurrences[0]!.meaning).toBe('회복력이 있는')
    expect((await repo.read(binding)).words[0]!.meaning).toBe('회복할 수 있는')
    await resilientWord.getByRole('button', { name: '이제 알아요', exact: true }).click()
    await expect(page.locator('.learning-vocabulary-word').filter({ hasText: 'resilient' }).locator('summary')).toContainText('익숙함 · 2개 문맥')
    await page.screenshot({ path: info.outputPath('learning-vocabulary.png') })
    // Let the actual workspace layout debouncer persist the native view.
    await expect.poll(async () => JSON.stringify(await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), course.id))).toContain('vocabulary')
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    page = bandal.page
    await expect(page.locator('.learning-topbar:visible')).toContainText('도시의 회복력')
    await expect(page.locator('.learning-vocabulary-word').filter({ hasText: 'resilient' }).locator('summary')).toContainText('익숙함 · 2개 문맥')
    const restored = await page.evaluate(value => window.bandal.invoke('learning:get', { binding: value }), binding)
    expect(restored.quizAttempts[0]!.score).toBe(2)
    expect(restored.cards.find(item => item.id === reviewed.id)?.dueAt).toBe(reviewed.dueAt)
    expect(restored.articles[0]!.status).toBe('completed')
  } finally { await bandal.close(); rmSync(profileDir, { recursive: true, force: true }) }
})

test('creates a standalone space in a short zoomed window and preserves renamed legacy subfolder bindings', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    await isolateProvider(bandal)
    await createCourse(bandal.page, '영어 자료')
    await bandal.page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '학습', exact: true }).click()
    await bandal.page.getByRole('complementary', { name: '학습 공간 목록' }).getByRole('button', { name: '새 학습', exact: true }).click()
    await bandal.page.getByRole('dialog', { name: '새 학습', exact: true }).getByRole('button', { name: '영어 글 읽기', exact: false }).click()
    const dialog = bandal.page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await bandal.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('index.html'))!
      window.setContentSize(1024, 640)
      window.webContents.setZoomFactor(1.25)
    })
    const createButton = dialog.getByRole('button', { name: '공간 만들고 첫 글 찾기', exact: true })
    const expectInside = async (): Promise<void> => {
      await expect.poll(() => createButton.evaluate(button => {
        const bounds = button.getBoundingClientRect()
        return bounds.top >= 0 && bounds.left >= 0 && bounds.bottom <= innerHeight && bounds.right <= innerWidth
      })).toBe(true)
    }
    await expectInside()
    await expect.poll(() => dialog.locator('.learning-dialog-body').evaluate(body => body.scrollHeight > body.clientHeight)).toBe(true)
    await configureEnglishForm(dialog, '새 과학 기사 읽기', '과학')
    await expectInside()
    await bandal.page.screenshot({ path: info.outputPath('learning-create-small-window.png') })
    await createButton.click()
    await expect(dialog).toBeHidden()
    await expect(bandal.page.locator('.learning-topbar:visible')).toContainText('새 과학 기사 읽기')
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.setZoomFactor(1))
    const standalone = await bandal.page.evaluate(async () => (await window.bandal.invoke('learning:list', {})).projects)
    expect(standalone).toHaveLength(1)
    expect(standalone[0]!.binding.rootRelPath).toBe('')
    const sourceCourse = await bandal.page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(course => course.name === '영어 자료')!)
    expect(await bandal.page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)?.workspaceKind, standalone[0]!.binding.courseId)).toBe('study-space')
    const legacy = await bandal.page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'in-course', courseId, rootRelPath: 'Reading/Science', name: '과학 기사 읽기', topic: 'Science' }), sourceCourse.id)
    await publishChange(bandal, legacy.binding)
    await bandal.page.getByRole('complementary', { name: '학습 공간 목록' }).getByRole('button').filter({ has: bandal.page.locator('strong').filter({ hasText: /^과학 기사 읽기$/ }) }).click()
    const projects = [{ binding: legacy.binding }]
    await bandal.page.getByRole('navigation', { name: '학습 화면' }).getByRole('button', { name: '퀴즈 · 카드' }).click()
    await bandal.page.evaluate(courseId => window.bandal.invoke('materials:rename', { courseId, relPath: 'Reading', newName: 'Library' }), projects[0]!.binding.courseId)
    await expect(bandal.page.locator('.learning-topbar:visible')).toContainText('과학 기사 읽기')
    await expect.poll(async () => JSON.stringify(await bandal.page.evaluate(courseId => window.bandal.invoke('layout:get', { courseId }), projects[0]!.binding.courseId))).toContain('Library/Science')
    await expect(bandal.page.getByRole('navigation', { name: '학습 화면' }).getByRole('button', { name: '퀴즈 · 카드' })).toHaveAttribute('aria-current', 'page')
    await bandal.page.evaluate(async courseId => {
      await window.bandal.invoke('materials:createFolder', { courseId, dirRelPath: '', name: 'Archive' })
      await window.bandal.invoke('materials:move', { courseId, fromRelPath: 'Library', toDirRelPath: 'Archive' })
    }, projects[0]!.binding.courseId)
    await expect.poll(async () => JSON.stringify(await bandal.page.evaluate(courseId => window.bandal.invoke('layout:get', { courseId }), projects[0]!.binding.courseId))).toContain('Archive/Library/Science')
    await expect(bandal.page.getByRole('navigation', { name: '학습 화면' }).getByRole('button', { name: '퀴즈 · 카드' })).toHaveAttribute('aria-current', 'page')
    const relocated = await bandal.page.evaluate(async courseId => (await window.bandal.invoke('learning:list', { courseId })).projects, projects[0]!.binding.courseId)
    expect(relocated).toHaveLength(1)
    expect(relocated[0]!.binding.rootRelPath).toBe('Archive/Library/Science')
  } finally { await bandal.close() }
})

test('native learning pack approval keeps app IPC responsive until its actual dialog is canceled', async () => {
  const bandal = await launchBandal()
  try {
    await isolateProvider(bandal)
    const project = await bandal.page.evaluate(settings => window.bandal.invoke('learning:create', { placement: 'standalone', name: '승인 응답성', topic: 'Science', ...settings }), ENGLISH_FIXTURE_SETTINGS)
    const quiz = BUILTIN_PACKS.find(pack => pack.id === 'quiz')!
    const imported = await bandal.page.evaluate(json => window.bandal.invoke('packs:importText', { json }), JSON.stringify({ ...quiz, name: '승인 응답성 검증 팩' }))
    await bandal.app.evaluate(({ dialog, BrowserWindow }) => {
      const native = dialog.showMessageBox.bind(dialog)
      const probe = { waiting: false, parented: false, signal: null as AbortSignal | null, controller: new AbortController() }
      ;(globalThis as unknown as { learningApprovalProbe: typeof probe }).learningApprovalProbe = probe
      dialog.showMessageBox = ((owner: Electron.BrowserWindow, options: Electron.MessageBoxOptions) => {
        probe.parented = owner instanceof BrowserWindow && !owner.isDestroyed()
        if (!probe.parented || !options?.signal) throw new Error('Learning approval requires a live parent and abort signal')
        probe.signal = options.signal
        options.signal.addEventListener('abort', () => probe.controller.abort(), { once: true })
        probe.waiting = true
        // Delegate to the real native dialog. A watchdog bounds failures without approving anything.
        const timer = setTimeout(() => probe.controller.abort(), 10_000)
        return native(owner, { ...options, signal: probe.controller.signal }).finally(() => { clearTimeout(timer); probe.waiting = false })
      }) as typeof dialog.showMessageBox
    })
    const generating = bandal.page.evaluate(async input => {
      try { await window.bandal.invoke('study:generate', input); return 'unexpectedly allowed' }
      catch (error) { return String(error) }
    }, { courseId: project.binding.courseId, rootRelPath: project.binding.rootRelPath, packId: imported.pack.id, source: { kind: 'course' as const } })
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { learningApprovalProbe: { waiting: boolean } }).learningApprovalProbe.waiting)).toBe(true)
    const state = await bandal.page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), project.binding)
    expect(state.name).toBe('승인 응답성')
    expect((await bandal.page.evaluate(() => window.bandal.invoke('courses:list', {}))).map(course => course.name)).toContain('승인 응답성')
    expect(await bandal.app.evaluate(() => (globalThis as unknown as { learningApprovalProbe: { waiting: boolean; parented: boolean; signal: AbortSignal } }).learningApprovalProbe.waiting)).toBe(true)
    await bandal.app.evaluate(() => (globalThis as unknown as { learningApprovalProbe: { controller: AbortController } }).learningApprovalProbe.controller.abort())
    expect(await generating).toContain('학습 팩 실행이 취소되었습니다')
    const packs = await bandal.page.evaluate(() => window.bandal.invoke('packs:list', {}))
    expect(packs.packs.find(item => item.pack.id === imported.pack.id)?.approvedAt).toBeNull()
    expect((await bandal.page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), project.binding)).runs).toHaveLength(0)
  } finally { await bandal.close() }
})

test('anonymous article extraction retains its native view through main-process garbage collection and closes it afterward', async () => {
  const host = 'learning-gc-fixture.example.org'
  const publicIp = '93.184.216.34'
  const url = `http://${host}/article`
  const paragraph = 'The city is changing as people work together to build a better future. They have new ideas for energy and transport, and the local community can learn from the experience. A careful article explains how the change will affect their daily lives. We are looking at the results with scientists who study the climate and share their findings with the public.'
  let requests = 0
  let releaseResponse: (() => void) | undefined
  const server = createServer((request, response) => {
    if (request.url !== '/article') { response.writeHead(404); response.end(); return }
    requests++
    const watchdog = setTimeout(() => { response.writeHead(504); response.end() }, 20_000)
    response.once('close', () => clearTimeout(watchdog))
    releaseResponse = () => {
      clearTimeout(watchdog)
      if (response.writableEnded || response.destroyed) return
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<html lang="en"><head><title>Article lifetime fixture</title></head><body><article><h1>Article lifetime fixture</h1>${Array.from({ length: 4 }, () => `<p>${paragraph}</p>`).join('')}</article></body></html>`)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Article fixture did not listen')
  const bandal = await launchBandal()
  try {
    // Substitute only this test's public DNS answer and pinned numeric socket.
    // The product URL guard, anonymous session, proxy and native view stay real.
    await bandal.app.evaluate(({ app }, { host, publicIp, port, url }) => {
      type BuiltinFunction = (...args: unknown[]) => unknown
      const dns = process.getBuiltinModule('node:dns/promises') as unknown as { lookup: BuiltinFunction }
      const net = process.getBuiltinModule('node:net') as unknown as { createConnection: BuiltinFunction }
      const v8 = process.getBuiltinModule('node:v8') as unknown as { setFlagsFromString(flags: string): void }
      const vm = process.getBuiltinModule('node:vm') as unknown as { runInNewContext(code: string): unknown }
      const lookup = dns.lookup, connect = net.createConnection
      v8.setFlagsFromString('--expose-gc')
      const gc = vm.runInNewContext('gc') as () => void
      if (typeof gc !== 'function') throw new Error('Main-process GC is unavailable')
      const probe = { gc, contents: undefined as import('electron').WebContents | undefined, targets: [] as { host: string; port: number }[], restore: () => {} }
      dns.lookup = (...args) => args[0] === host ? Promise.resolve([{ address: publicIp, family: 4 }]) : lookup(...args)
      net.createConnection = (...args) => {
        const target = args[0] as { host?: string; port?: number } | undefined
        if (target?.host === publicIp && target.port === 80) {
          probe.targets.push({ host: target.host, port: target.port })
          return connect({ host: '127.0.0.1', port })
        }
        return connect(...args)
      }
      const created = (_event: unknown, contents: import('electron').WebContents): void => {
        contents.on('did-start-navigation', details => {
          if (details.url === url && details.isMainFrame) probe.contents = contents
        })
      }
      app.on('web-contents-created', created)
      probe.restore = () => { dns.lookup = lookup; net.createConnection = connect; app.removeListener('web-contents-created', created) }
      ;(globalThis as unknown as { learningGcProbe: typeof probe }).learningGcProbe = probe
    }, { host, publicIp, port: address.port, url })
    const project = await bandal.page.evaluate(() => window.bandal.invoke('learning:create', { placement: 'standalone', name: 'Article lifetime', topic: 'Cities', readingMinutes: 4 }))
    const reading = bandal.page.evaluate(async ({ binding, url }) => {
      try { return { snapshot: await window.bandal.invoke('learning:addArticle', { binding, url }), error: null } }
      catch (error) { return { snapshot: null, error: error instanceof Error ? error.message : String(error) } }
    }, { binding: project.binding, url })
    await expect.poll(() => requests).toBe(1)
    const duringLoad = await bandal.app.evaluate(async () => {
      const probe = (globalThis as unknown as { learningGcProbe: { gc(): void; contents?: import('electron').WebContents; targets: { host: string; port: number }[] } }).learningGcProbe
      // Observe contents only. Retaining the owning view here would mask the bug.
      for (let index = 0; index < 10; index++) { probe.gc(); await new Promise(resolve => setTimeout(resolve, 60)) }
      return { destroyed: probe.contents?.isDestroyed() ?? true, targets: probe.targets, loading: probe.contents?.isDestroyed() ? false : probe.contents?.isLoading() }
    })
    expect(duringLoad).toEqual({ destroyed: false, loading: true, targets: [{ host: publicIp, port: 80 }] })
    releaseResponse!()
    const result = await reading
    expect(result.error).toBeNull()
    expect(result.snapshot?.articles).toHaveLength(1)
    const article = await bandal.page.evaluate(({ binding, id }) => window.bandal.invoke('learning:getArticle', { binding, id }), { binding: project.binding, id: result.snapshot!.articles[0]!.id })
    expect(article).toMatchObject({ title: 'Article lifetime fixture', access: 'public', sourceUrl: url })
    expect(article.wordCount).toBeGreaterThan(200)
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as unknown as { learningGcProbe: { contents?: import('electron').WebContents } }).learningGcProbe.contents?.isDestroyed() ?? false)).toBe(true)
  } finally {
    releaseResponse?.()
    await bandal.app.evaluate(() => (globalThis as unknown as { learningGcProbe?: { restore(): void } }).learningGcProbe?.restore()).catch(() => {})
    await bandal.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
