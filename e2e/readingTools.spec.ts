import { expect, test, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { splitLearningParagraphs } from '../src/main/features/learning/model'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { configureEnglishForm, installLearningAiFixture } from './helpers/learning'

async function resize(bandal: BandalApp, width: number): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, width) => {
    const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('index.html'))!
    window.setMinimumSize(600, 500); window.setContentSize(width, 820)
  }, width)
}
async function insideViewport(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  const rect = await locator.boundingBox()
  const viewport = await locator.page().evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1)
}

test('offline dictionary preserves chosen meanings, supports keyboard reading and restores a paragraph across widths', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await installLearningAiFixture(bandal)
    await bandal.app.evaluate(({ ipcMain }) => {
      const runs: { kind: string }[] = []
      ;(globalThis as any).readingToolRuns = runs
      ipcMain.removeHandler('learning:run')
      ipcMain.handle('learning:run', (_event, input) => { runs.push(input); return { runId: 'reading-fixture', binding: input.binding } })
    })
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '학습', exact: true }).click()
    await page.getByRole('complementary', { name: '학습 공간 목록' }).getByRole('button', { name: '새 학습', exact: true }).click()
    await page.getByRole('dialog', { name: '새 학습', exact: true }).getByRole('button', { name: '영어 글 읽기', exact: false }).click()
    const setup = page.getByRole('dialog', { name: '영어 이어읽기 시작하기' })
    await configureEnglishForm(setup, '사전 읽기 검증')
    await setup.getByRole('button', { name: '공간 만들고 첫 글 찾기' }).click()
    await expect(setup).toBeHidden()
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '사전 읽기 검증')!)
    const binding = { courseId: course.id, rootRelPath: '' }
    const repo = createLearningRepo({ getCourseFolder: () => course.folderPath })
    const text = 'Inflation changed the city. Children ran towards the bank. Sustainability matters.\n\n' + Array.from({ length: 24 }, (_, i) => `Section ${i + 1} explains how people adapt to a changing climate. The city supports communities and protects nature. Scientists study the evidence and share their knowledge.`).join('\n\n')
    await repo.addArticle({ binding, article: { id: 'dictionary-article', title: 'Reading without waiting', sourceUrl: 'https://example.test/dictionary', paragraphs: splitLearningParagraphs(text) } })
    await bandal.app.evaluate(({ BrowserWindow, session }, binding) => {
      // The dictionary must work even when every HTTP request is refused.
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding })
    }, binding)
    const nav = page.getByRole('navigation', { name: '학습 화면' })
    await nav.getByRole('button', { name: '읽기', exact: true }).click()
    await expect(page.locator('.learning-reader h1')).toHaveText('Reading without waiting')
    await expect(page.getByRole('button', { name: '이 글의 단어장', exact: true })).toHaveAttribute('aria-expanded', 'false')
    const inflation = page.getByRole('button', { name: '“Inflation” 뜻 보기', exact: true })
    await inflation.click()
    const popup = page.getByRole('dialog', { name: 'Inflation 사전', exact: true })
    await expect(popup).toContainText('인플레이션')
    await popup.getByRole('button', { name: '단어장에 담기', exact: true }).click()
    await expect(popup.getByRole('button', { name: '저장됨', exact: true })).toBeDisabled()
    await expect.poll(async () => (await repo.read(binding)).words.length).toBe(1)
    const saved = await repo.read(binding)
    expect(saved.words[0]!.dictionarySource?.headword).toBe('inflation')
    expect(saved.occurrences[0]!.sentence).toBe('Inflation changed the city.')
    await popup.getByRole('button', { name: '사전 닫기', exact: true }).click()
    await page.getByRole('button', { name: '“ran” 뜻 보기', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'ran 사전', exact: true })).toContainText('run')
    await page.getByRole('button', { name: '사전 닫기', exact: true }).click()
    await page.getByRole('button', { name: '“Sustainability” 뜻 보기', exact: true }).click()
    const missing = page.getByRole('dialog', { name: 'Sustainability 사전', exact: true })
    await expect(missing.getByRole('button', { name: '네이버 영어사전에서 찾기' })).toBeVisible()
    expect(await bandal.app.evaluate(() => (globalThis as any).readingToolRuns.filter((run: any) => run.kind === 'explain-word'))).toEqual([])
    await missing.getByRole('button', { name: '사전 닫기', exact: true }).click()
    await expect(page.locator('.learning-reader-word[tabindex="0"]')).toHaveCount(1)
    await inflation.focus(); await page.keyboard.press('Enter')
    await expect(popup).toBeVisible(); await page.keyboard.press('Escape')
    await expect(inflation).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: '“changed” 뜻 보기', exact: true })).toBeFocused()
    for (const [width, theme] of [[800, 'light'], [1100, 'dark'], [1440, 'light']] as const) {
      await resize(bandal, width)
      await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
      await inflation.click(); await insideViewport(popup)
      await page.screenshot({ path: info.outputPath(`dictionary-${width}-${theme}.png`), animations: 'disabled' })
      await popup.getByRole('button', { name: '사전 닫기' }).click()
      await page.getByRole('button', { name: '이 글의 단어장', exact: true }).click()
      await insideViewport(page.getByRole('complementary', { name: '읽기 단어장' }))
      await page.getByRole('button', { name: '단어장 닫기', exact: true }).click()
    }
    const displayTimings = await page.evaluate(async () => {
      const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const values: number[] = []
      const word = document.querySelector<HTMLButtonElement>('[aria-label="“Inflation” 뜻 보기"]')!
      for (let i = 0; i < 10; i++) {
        const start = performance.now()
        word.click()
        while (!document.querySelector('.learning-dictionary-senses')) {
          if (performance.now() - start > 3000) throw new Error('Dictionary senses did not render')
          await nextFrame()
        }
        await nextFrame()
        values.push(performance.now() - start)
        document.querySelector<HTMLButtonElement>('[aria-label="사전 닫기"]')!.click()
        await nextFrame()
      }
      return values.sort((a, b) => a - b)
    })
    await info.attach('dictionary-display-latency.json', { body: JSON.stringify({ p95ms: displayTimings[9] }), contentType: 'application/json' })
    console.log('Dictionary selection to displayed senses p95 ms:', displayTimings[9])
    await page.locator('[data-learning-paragraph="p12"]').evaluate(element => {
      const reader = element.closest('.learning-reader')!
      reader.scrollTop += element.getBoundingClientRect().top - reader.getBoundingClientRect().top - 100
    })
    await expect.poll(async () => (await repo.read(binding)).articles[0]!.progress.paragraphId).toBe('p12')
    await nav.getByRole('button', { name: '나의 단어', exact: true }).click()
    await resize(bandal, 900)
    await nav.getByRole('button', { name: '읽기', exact: true }).click()
    await expect.poll(() => page.locator('[data-learning-paragraph="p12"]').evaluate(element => Math.round(element.getBoundingClientRect().top - element.closest('.learning-reader')!.getBoundingClientRect().top))).toBe(100)
    const timings = await page.evaluate(async () => {
      const values: number[] = []
      for (let i = 0; i < 30; i++) { const start = performance.now(); await window.bandal.invoke('learning:lookupDictionary', { text: ['inflation', 'ran', 'bank'][i % 3]! }); values.push(performance.now() - start) }
      return values.sort((a, b) => a - b)
    })
    await info.attach('dictionary-ipc-latency.json', { body: JSON.stringify({ p95ms: timings[28], maxMs: timings[29] }), contentType: 'application/json' })
    console.log('Dictionary IPC p95 ms:', timings[28])
    expect(timings[28]).toBeLessThan(500)
  } finally { await bandal.close() }
})

test('material palette keeps its source through search and setup and starts only after confirmation', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await resize(bandal, 1100)
    await createCourse(page, '학습 팔레트 검증')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '학습 팔레트 검증')!)
    writeFileSync(join(course.folderPath, 'source.md'), '# Source\n\nCells transform energy.\n')
    writeFileSync(join(course.folderPath, 'other.md'), '# Other\n\nA different document.\n')
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage().drawText('Aerodynamics describes how air moves around objects.', { x: 40, y: 700, size: 16, font })
    writeFileSync(join(course.folderPath, 'Aerodynamics.pdf'), await pdf.save())
    await installLearningAiFixture(bandal)
    const review = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '팔레트 복습', topic: 'Science', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), course.id)
    await bandal.app.evaluate(({ ipcMain }, binding) => {
      const calls: any[] = []; (globalThis as any).paletteCalls = calls
      ipcMain.removeHandler('study:generate'); ipcMain.handle('study:generate', (_event, input) => { calls.push(input); return { runId: 'palette-quiz', binding } })
      ipcMain.removeHandler('study:run'); ipcMain.handle('study:run', (_event, input) => { calls.push(input); return { relPath: 'AI 학습자료/요약.md' } })
    }, review.binding)
    await expect(page.locator('[data-material-path="other.md"]')).toBeVisible()
    await page.locator('[data-material-path="other.md"]').click()
    const source = page.locator('[data-material-path="source.md"]')
    const open = async (row = source): Promise<Locator> => {
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: '이 자료로 학습하기', exact: false }).click()
      const palette = page.getByRole('dialog', { name: '이 자료로 학습하기', exact: true })
      await expect(palette).toBeVisible(); return palette
    }
    let palette = await open()
    await expect(palette).toContainText('source.md')
    await expect(palette).not.toContainText('영어 이어읽기')
    await palette.getByLabel('학습 도구 검색').fill('퀴즈')
    await palette.getByRole('button', { name: '퀴즈 만들기', exact: false }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(palette.getByLabel('실행 내용 확인')).toContainText('source.md')
    expect(await bandal.app.evaluate(() => (globalThis as any).paletteCalls)).toEqual([])
    await page.screenshot({ path: info.outputPath('palette-setup.png'), animations: 'disabled' })
    await palette.getByRole('button', { name: '도구 선택으로 돌아가기', exact: true }).click()
    await expect(palette.getByLabel('학습 도구 검색')).toHaveValue('퀴즈')
    await page.keyboard.press('Escape'); await expect(palette).toBeHidden()
    await expect(source).toBeFocused()
    palette = await open(page.locator('[data-material-path="Aerodynamics.pdf"]'))
    await palette.getByRole('button', { name: '퀴즈 만들기', exact: false }).click()
    await expect(palette.getByLabel('실행 내용 확인')).toContainText('Aerodynamics.pdf')
    await palette.getByRole('button', { name: '퀴즈 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).paletteCalls.length)).toBe(1)
    expect(await bandal.app.evaluate(() => (globalThis as any).paletteCalls[0])).toMatchObject({ courseId: course.id, packId: 'quiz', source: { kind: 'material', relPath: 'Aerodynamics.pdf' } })
    await expect(palette).toBeHidden()
    await expect(page.locator('.learning-topbar:visible')).toContainText('팔레트 복습')
    const coursesButton = page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '과목', exact: true })
    if (await coursesButton.getAttribute('aria-expanded') !== 'true') await coursesButton.click()
    await page.getByRole('complementary', { name: '과목 목록' }).locator('.course-row').filter({ hasText: '학습 팔레트 검증' }).click()
    await resize(bandal, 800)
    await page.evaluate(() => window.bandal.invoke('settings:set', { theme: 'light' }))
    palette = await open()
    await insideViewport(palette)
    await page.screenshot({ path: info.outputPath('palette-light-narrow.png'), animations: 'disabled' })
    await palette.getByRole('button', { name: '핵심 요약', exact: false }).click()
    await palette.getByRole('button', { name: '요약 만들기', exact: true }).click()
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).paletteCalls.length)).toBe(2)
    expect(await bandal.app.evaluate(() => (globalThis as any).paletteCalls[1])).toMatchObject({ courseId: course.id, tool: 'summary', relPath: 'source.md' })
  } finally { await bandal.close() }
})
