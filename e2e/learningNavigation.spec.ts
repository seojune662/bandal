import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { learningHash, splitLearningParagraphs } from '../src/main/features/learning/model'
import { workspaceKey } from '../src/shared/types/workspace'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { ENGLISH_FIXTURE_SETTINGS } from './helpers/learning'

const projects = (page: Page) => page.getByRole('complementary', { name: '프로젝트 목록', exact: true })
async function projectList(page: Page): Promise<void> { await page.locator('.app-rail:not([hidden])').getByRole('tab', { name: '프로젝트', exact: true }).click() }
async function publish(bandal: BandalApp, courseId: string, rootRelPath: string): Promise<void> {
  await bandal.app.evaluate(({ BrowserWindow }, binding) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('learning:changed', { binding }) }, { courseId, rootRelPath })
}
async function openProject(page: Page, name: string): Promise<void> {
  await projectList(page)
  await projects(page).locator('.project-list-row__open').filter({ hasText: name }).click()
  await expect(page.locator('.workspace-course:not([hidden])')).toHaveCount(1)
}

test('home tabs change the list, while project selection hides and restores the native course page', async ({}, info) => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html><title>Retained browser</title><body><input id="retained" value="initial"></body></html>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/retained`
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '원래 자료 과목')
    const owner = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '원래 자료 과목')!)
    const repo = createLearningRepo({ getCourseFolder: () => owner.folderPath })
    await repo.create({ binding: { courseId: owner.id, rootRelPath: 'Review' }, name: '복습 프로젝트', topic: '과목 자료', purpose: 'course-review' })
    await publish(bandal, owner.id, 'Review')
    await bandal.app.evaluate(({ BrowserWindow }, input) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', input) }, { url, courseId: owner.id })
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url && !contents.isLoading())?.id ?? null, url)).not.toBeNull()
    const nativeId = await bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.id, url)
    await bandal.app.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.executeJavaScript('document.querySelector("#retained").value = "browser state preserved"') }, nativeId)
    const visible = () => bandal.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.contentView.children.some(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.id === id && view.getVisible() && view.getBounds().width > 100), nativeId)
    await expect.poll(visible).toBe(true)
    await projectList(page)
    await expect(projects(page)).toBeVisible()
    await expect.poll(visible).toBe(true)
    await openProject(page, '복습 프로젝트')
    await expect.poll(visible).toBe(false)
    await expect(page.getByRole('navigation', { name: '학습 화면' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '자료', exact: true })).toBeVisible()
    await page.locator('.app-rail:not([hidden])').getByRole('tab', { name: '과목', exact: true }).click()
    await expect.poll(visible).toBe(false)
    await page.getByRole('complementary', { name: '과목 목록', exact: true }).getByRole('button', { name: '원래 자료 과목', exact: true }).click()
    await expect.poll(visible).toBe(true)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#retained").value'), nativeId)).toBe('browser state preserved')
    await openProject(page, '복습 프로젝트')
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.screenshot({ path: info.outputPath(`project-workspace-${theme}.png`), animations: 'disabled' })
    }
  } finally { await bandal.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('nested projects retain independent resource tabs and source documents keep their original owner', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '원본 생물 과목')
    const owner = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '원본 생물 과목')!)
    const text = '# Biology\n\nCells transform energy.\n'
    writeFileSync(join(owner.folderPath, 'biology.md'), text)
    const repo = createLearningRepo({ getCourseFolder: () => owner.folderPath })
    const english = await repo.create({ binding: { courseId: owner.id, rootRelPath: 'English' }, name: '영어 프로젝트', topic: '생물', ...ENGLISH_FIXTURE_SETTINGS })
    const review = await repo.create({ binding: { courseId: owner.id, rootRelPath: 'Review' }, name: '생물 복습 프로젝트', topic: '생물', purpose: 'course-review' })
    for (const [id, title] of [['a', 'First article'], ['b', 'Second article']]) await repo.addArticle({ binding: english.binding, article: { id, title, sourceUrl: `https://example.test/${id}`, paragraphs: splitLearningParagraphs(`Cells transform energy. Article ${id} explores how organisms adapt to change.`) } })
    await repo.putArtifact({ binding: review.binding, artifact: { id: 'origin-quiz', kind: 'quiz', title: '생물 원본 퀴즈', questions: [{ id: 'q1', type: 'choice', prompt: 'What do cells transform?', options: [{ id: 'energy', text: 'Energy' }, { id: 'stone', text: 'Stone' }], answer: 'energy', explanation: 'Cells transform energy.', sourceRefs: [{ kind: 'material', pathScope: 'course', sourceCourseId: owner.id, relPath: 'biology.md', title: '생물 원본 문서', quote: 'Cells transform energy.', contentHash: learningHash(text) }] }] } })
    await publish(bandal, owner.id, 'English')
    await openProject(page, '영어 프로젝트')
    await page.locator('.project-materials').getByRole('button', { name: 'First article', exact: true }).click()
    await page.locator('.project-materials').getByRole('button', { name: 'Second article', exact: true }).click()
    await expect(page.locator('.dv-tab:visible').filter({ hasText: 'First article' })).toHaveCount(1)
    await expect(page.locator('.dv-tab:visible').filter({ hasText: 'Second article' })).toHaveCount(1)
    await openProject(page, '생물 복습 프로젝트')
    await expect(page.locator('.dv-tab:visible')).toHaveCount(0)
    await page.locator('.project-materials').getByRole('button', { name: '생물 원본 퀴즈', exact: true }).click()
    await page.locator('.learning-quiz:visible').getByRole('radio', { name: 'Energy', exact: true }).check()
    await page.locator('.learning-quiz:visible').getByRole('button', { name: '채점하고 정답 보기', exact: true }).click()
    await page.locator('.learning-sources:visible').getByRole('button', { name: '생물 원본 문서', exact: true }).click()
    await expect(page.getByLabel('마크다운 필기 편집기')).toContainText('Cells transform energy.')
    await expect(page.locator('.workspace-course:not([hidden])')).toHaveAttribute('data-workspace-key', workspaceKey({ kind: 'project', ...review.binding }))
    await expect.poll(async () => JSON.stringify((await page.evaluate(binding => window.bandal.invoke('layout:get', { courseId: binding.courseId, projectRootRelPath: binding.rootRelPath }), review.binding)).layout)).toContain(`note:${owner.id}:biology.md`)
    await openProject(page, '영어 프로젝트')
    await expect(page.locator('.dv-tab:visible').filter({ hasText: 'First article' })).toHaveCount(1)
    await expect(page.locator('.dv-tab:visible').filter({ hasText: 'Second article' })).toHaveCount(1)
    expect(JSON.stringify((await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), owner.id)).layout)).not.toContain('origin-quiz')
  } finally { await bandal.close() }
})

test('legacy project reader migrates once and restores project selection and resources after restart', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profile = bandal.profileDir
  try {
    let page = bandal.page
    await createCourse(page, '복원할 과목')
    const owner = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '복원할 과목')!)
    const binding = { courseId: owner.id, rootRelPath: 'English' }
    const repo = createLearningRepo({ getCourseFolder: () => owner.folderPath })
    await repo.create({ binding, name: '복원할 프로젝트', topic: '과학', ...ENGLISH_FIXTURE_SETTINGS })
    await repo.addArticle({ binding, article: { id: 'restore-article', title: 'Restored article', sourceUrl: 'https://example.test/restore', paragraphs: splitLearningParagraphs('This article survives the layout migration.') } })
    const legacyId = `learning:${owner.id}:project:English`
    await page.evaluate(input => window.bandal.invoke('layout:save', input), { courseId: owner.id, projectRootRelPath: binding.rootRelPath, layout: { panels: { [legacyId]: { id: legacyId, contentComponent: 'learning', params: { descriptor: { kind: 'learning', payload: { ...binding, view: 'reader', itemId: 'restore-article' } } } } }, grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { id: 'legacy', views: [legacyId], activeView: legacyId }, size: 900 }] }, width: 900, height: 700, orientation: 'HORIZONTAL' }, activeGroup: 'legacy' } })
    await publish(bandal, owner.id, 'English')
    await openProject(page, '복원할 프로젝트')
    await expect(page.locator('.learning-reader:visible')).toContainText('Restored article')
    await expect.poll(async () => JSON.stringify((await page.evaluate(binding => window.bandal.invoke('layout:get', { courseId: binding.courseId, projectRootRelPath: binding.rootRelPath }), binding)).layout)).toContain('learning-resource')
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile, keepProfileOnClose: true })
    page = bandal.page
    await expect(page.locator('.workspace-course:not([hidden])')).toHaveAttribute('data-workspace-key', workspaceKey({ kind: 'project', ...binding }))
    await expect(page.locator('.learning-reader:visible')).toContainText('Restored article')
    await expect(page.getByRole('navigation', { name: '학습 화면' })).toHaveCount(0)
  } finally { await bandal.close(); rmSync(profile, { recursive: true, force: true }) }
})
