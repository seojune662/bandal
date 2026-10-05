import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash } from '../src/main/features/learning/model'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { installLearningAiFixture } from './helpers/learning'

const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })

async function installNavigationProbe(bandal: BandalApp): Promise<void> {
  await bandal.app.evaluate(({ ipcMain }) => {
    const probe = { chatOpens: 0, workspace: null as any }
    ;(globalThis as any).__learningNavigation = probe
    const original = (ipcMain as any)._invokeHandlers.get('agent:syncWorkspace')
    ipcMain.removeHandler('agent:syncWorkspace')
    ipcMain.handle('agent:syncWorkspace', (event, input) => { probe.workspace = input; return original(event, input) })
    ipcMain.removeHandler('chat:open')
    ipcMain.handle('chat:open', (_event, input) => {
      probe.chatOpens += 1
      return { history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: input.sessionId, courseId: input.courseId, provider: 'claude-code', model: 'default', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }
    })
    ipcMain.removeHandler('agent:models')
    ipcMain.handle('agent:models', () => ({ models: [{ id: 'default', displayName: 'Default', isDefault: true }], source: 'live', status: 'ready' }))
  })
}

test('global learning home isolates current context, preserves duplicate drafts and hides native browser without destroying its page', async ({}, info) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Retained browser</title><body><h1>Native page</h1><input id="retained" value="initial"></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/retained`
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await installNavigationProbe(bandal)
    await createCourse(page, '원래 자료 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '원래 자료 과목')!)
    writeFileSync(join(course.folderPath, 'source.md'), '# Source\n\nKeep this original material.\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="source.md"]').click()
    await page.locator('.dv-tab:visible').filter({ hasText: 'source' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '탭 복제', exact: true }).click()
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    const composer = page.locator('.tab-assistant:visible').getByRole('textbox', { name: '메시지 입력' })
    await expect(composer).toBeFocused()
    await composer.fill('복제 자료의 보존된 초안')
    const layout = () => page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), course.id)
    await expect.poll(async () => Object.keys((await layout()).layout?.panels ?? {}).filter(id => id.includes('duplicate')).length).toBe(1)
    const panelIds = Object.keys((await layout()).layout!.panels)
    const chatOpens = await bandal.app.evaluate(() => (globalThis as any).__learningNavigation.chatOpens)

    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await expect(page.getByRole('main', { name: '학습 홈' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '학습', exact: true })).toBeFocused()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
    await expect(page.locator('.shell-materials-rail')).toHaveAttribute('inert', '')
    await page.keyboard.press('ControlOrMeta+w')
    expect(Object.keys((await layout()).layout!.panels)).toEqual(panelIds)
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__learningNavigation.workspace)).toMatchObject({ selectedCourseId: null, tabs: [], documents: [], selection: '' })
    await rail(page).getByRole('button', { name: '도구', exact: true }).click()
    const target = page.getByRole('region', { name: '현재 실행 대상' })
    await expect(target).toHaveCount(0)
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'AI와 대화할 곳 선택' })
    await expect(picker).toBeVisible()
    expect(await bandal.app.evaluate(() => (globalThis as any).__learningNavigation.chatOpens)).toBe(chatOpens)
    await picker.getByRole('button', { name: '닫기', exact: true }).click()
    await rail(page).getByRole('button', { name: '과목', exact: true }).click()
    await expect(composer).toHaveValue('복제 자료의 보존된 초안')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'open')

    await bandal.app.evaluate(({ BrowserWindow }, input) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url: input.url, courseId: input.courseId })
    }, { url, courseId: course.id })
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url && !contents.isLoading())?.id ?? null, url)).not.toBeNull()
    const nativeId = await bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.id, url)
    await bandal.app.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.executeJavaScript('document.querySelector("#retained").value = "browser state preserved"'); }, nativeId)
    const nativeVisible = () => bandal.app.evaluate(({ BrowserWindow }, id) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return window.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.id === id && view.getVisible() && view.getBounds().width > 100)
    }, nativeId)
    await expect.poll(nativeVisible).toBe(true)
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await expect(page.getByRole('main', { name: '학습 홈' })).toBeVisible()
    await expect.poll(nativeVisible).toBe(false)
    expect(await bandal.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed() ?? true, nativeId)).toBe(false)
    await rail(page).getByRole('button', { name: '과목', exact: true }).click()
    await expect.poll(nativeVisible).toBe(true)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#retained").value'), nativeId)).toBe('browser state preserved')
    await page.screenshot({ path: info.outputPath('learning-home-navigation.png') })
  } finally { await bandal.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('a source in an independent review space returns to its original course instead of contaminating the review layout', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '원본 생물 과목')
    const original = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '원본 생물 과목')!)
    const text = '# Biology\n\nCells transform energy.\n'
    writeFileSync(join(original.folderPath, 'biology.md'), text)
    await installLearningAiFixture(bandal)
    const project = await page.evaluate(courseId => window.bandal.invoke('learning:create', { placement: 'standalone', name: '생물 원본 복습', topic: '생물', purpose: 'course-review', linkedCourseId: courseId, ai: { provider: 'gemini', model: 'pro', effort: null } }), original.id)
    const owner = await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(course => course.id === id)!, project.binding.courseId)
    const repo = createLearningRepo({ getCourseFolder: id => id === original.id ? original.folderPath : owner.folderPath })
    await repo.putArtifact({ binding: project.binding, artifact: { id: 'origin-quiz', kind: 'quiz', title: '생물 원본 퀴즈', questions: [{ id: 'q1', type: 'choice', prompt: 'What do cells transform?', options: [{ id: 'energy', text: 'Energy' }, { id: 'stone', text: 'Stone' }], answer: 'energy', explanation: 'Cells transform energy.', sourceRefs: [{ kind: 'material', pathScope: 'course', sourceCourseId: original.id, relPath: 'biology.md', title: '생물 원본 문서', quote: 'Cells transform energy.', contentHash: learningHash(text) }] }] } })
    await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, project.binding)
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    await page.getByRole('region', { name: '모든 학습 공간' }).getByRole('button').filter({ hasText: '생물 원본 복습' }).first().click()
    await expect(page.locator('.learning-review-sources')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
    await page.locator('.learning-review-sources').getByRole('button', { name: '생물 원본 문서', exact: true }).click()
    await expect(page.getByLabel('마크다운 필기 편집기')).toContainText('Cells transform energy.')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'open')
    await expect(page.locator(`.workspace-course[data-workspace-course="${original.id}"]`)).not.toHaveAttribute('hidden')
    await expect.poll(async () => JSON.stringify((await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), original.id)).layout)).toContain(`note:${original.id}:biology.md`)
    const reviewLayout = await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), owner.id)
    expect(Object.values(reviewLayout.layout?.panels ?? {}).some(panel => (panel.params as any)?.descriptor?.kind === 'note')).toBe(false)
  } finally { await bandal.close() }
})

test('global learning home visuals fit wide and narrow windows in light and dark themes', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '원본 학습 자료')
    const original = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(course => course.name === '원본 학습 자료')!)
    await installLearningAiFixture(bandal)
    await page.evaluate(async courseId => {
      const ai = { provider: 'gemini' as const, model: 'pro', effort: null }
      for (const name of ['우주와 기술의 변화를 영어로 읽기', '과학 이야기와 생활 속 발견']) {
        await window.bandal.invoke('learning:create', { placement: 'standalone', name, topic: '과학과 기술', purpose: 'english-reading', topicIds: ['science', 'technology-ai'], readingSetupConfirmed: true, level: 'intermediate', readingMinutes: 4, ai })
      }
      await window.bandal.invoke('learning:create', { placement: 'standalone', name: '생물학 핵심 개념 복습', topic: '원본 자료', purpose: 'course-review', linkedCourseId: courseId, ai })
    }, original.id)
    await rail(page).getByRole('button', { name: '학습', exact: true }).click()
    const home = page.getByRole('main', { name: '학습 홈' })
    await expect(home).toBeVisible()
    await expect(home.getByRole('region', { name: '모든 학습 공간' })).toContainText('생물학 핵심 개념 복습')
    const measurements: unknown[] = []
    for (const [width, height] of [[1280, 800], [1024, 640]] as const) {
      await bandal.app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(size.width, size.height)
      }, { width, height })
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height })
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
        await expect(page.locator('.shell-materials-rail')).toHaveAttribute('inert', '')
        const measurement = await home.evaluate(async (element, input) => {
          const scroller = element.querySelector<HTMLElement>('.learning-content-scroll')!
          scroller.scrollTop = 0
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          const bounds = element.getBoundingClientRect()
          return { ...input, home: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
        }, { width, height, theme })
        expect(measurement.documentWidth).toBeLessThanOrEqual(width + 1)
        expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth + 1)
        expect(measurement.home.x + measurement.home.width).toBeLessThanOrEqual(width + 1)
        expect(measurement.home.y + measurement.home.height).toBeLessThanOrEqual(height + 1)
        measurements.push(measurement)
        await page.screenshot({ path: info.outputPath(`learning-home-${width}x${height}-${theme}.png`), animations: 'disabled' })
      }
    }
    await info.attach('learning-home-layout', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
  } finally { await bandal.close() }
})
