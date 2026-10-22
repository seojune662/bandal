import { showProjects } from './helpers/projectWorkspace'
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLearningRepo } from '../src/main/features/learning/learningRepo'
import { createCourse, launchBandal } from './helpers/launch'
import { installLearningAiFixture } from './helpers/learning'

const ai = { provider: 'gemini' as const, model: 'pro', effort: null }

test('learning list renames offline and removes only the selected space, with same-ID undo and restart restore', async ({}, info) => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profile = bandal.profileDir
  try {
    let page = bandal.page
    await installLearningAiFixture(bandal)
    await createCourse(page, '선형대수학')
    const source = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '선형대수학')!)
    writeFileSync(join(source.folderPath, '원본.md'), '# 보존할 원본\n행렬의 성질')
    const legacyRepo = createLearningRepo({ getCourseFolder: () => source.folderPath })
    const legacy = await legacyRepo.create({ binding: { courseId: source.id, rootRelPath: 'AI 학습자료' }, name: 'AI 학습자료', topic: '과목 자료', purpose: 'course-review' })
    const edited = join(source.folderPath, 'AI 학습자료', '내 정리.md')
    writeFileSync(edited, '사용자가 직접 편집한 기록')
    const independent = await page.evaluate(input => window.bandal.invoke('learning:create', input), { placement: 'standalone' as const, name: '독립 복습', purpose: 'course-review' as const, topic: '과목 자료', linkedCourseId: source.id, ai })
    const owner = await page.evaluate(async id => (await window.bandal.invoke('courses:list', {})).find(item => item.id === id)!, independent.binding.courseId)
    expect(existsSync(join(owner.folderPath, '단어장.md'))).toBe(false)
    expect(existsSync(join(owner.folderPath, '기사'))).toBe(false)
    await showProjects(page)
    let list = page.getByRole('complementary', { name: '프로젝트 목록' })
    await expect(list).toContainText('선형대수학 복습')
    await list.getByRole('button', { name: '독립 복습 더보기', exact: true }).click()
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    const rename = page.getByRole('dialog', { name: '프로젝트 이름 변경' })
    await rename.getByRole('textbox', { name: '이름', exact: true }).fill('시험 전 복습')
    await rename.getByRole('button', { name: '이름 저장', exact: true }).click()
    await expect(rename).toBeHidden()
    expect((await page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), independent.binding)).name).toBe('시험 전 복습')
    const remove = async (name: string): Promise<void> => {
      await list.getByRole('button', { name: `${name} 더보기`, exact: true }).click()
      await page.getByRole('menuitem', { name: '목록에서 삭제', exact: true }).click()
      const confirmation = page.getByRole('alertdialog', { name: '프로젝트를 목록에서 삭제' })
      await expect(confirmation).toContainText('파일·원본 과목·학습 기록은 보존')
      await confirmation.getByRole('button', { name: '목록에서 삭제', exact: true }).click()
      await expect(confirmation).toBeHidden()
    }
    await remove('선형대수학 복습')
    await expect(list.getByRole('button', { name: '선형대수학 복습 더보기', exact: true })).toHaveCount(0)
    expect(readFileSync(edited, 'utf8')).toBe('사용자가 직접 편집한 기록')
    expect((await page.evaluate(() => window.bandal.invoke('courses:list', {}))).some(item => item.id === source.id)).toBe(true)
    await page.getByRole('button', { name: '삭제 취소', exact: true }).click()
    await expect(list.getByRole('button', { name: '선형대수학 복습 더보기', exact: true })).toBeVisible()
    expect((await page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), legacy.binding)).projectId).toBe(legacy.projectId)
    await remove('시험 전 복습')
    expect(existsSync(join(owner.folderPath, '.bandal', 'learning', 'state.json'))).toBe(true)
    await page.screenshot({ path: info.outputPath('learning-home-delete.png') })
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile })
    page = bandal.page
    await showProjects(page)
    list = page.getByRole('complementary', { name: '프로젝트 목록' })
    await expect(list.getByRole('button', { name: '시험 전 복습 더보기', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
    await page.getByRole('menuitem', { name: '삭제한 프로젝트', exact: true }).click()
    const removed = page.locator('.project-deleted')
    await expect(removed).toContainText('시험 전 복습')
    await removed.getByRole('button', { name: '복원', exact: true }).click()
    await expect(list.getByRole('button', { name: '시험 전 복습 더보기', exact: true })).toBeVisible()
    const restored = await page.evaluate(binding => window.bandal.invoke('learning:get', { binding }), independent.binding)
    expect(restored.projectId).toBe(independent.projectId)
    expect(restored.binding).toEqual(independent.binding)
    expect(readFileSync(edited, 'utf8')).toBe('사용자가 직접 편집한 기록')
  } finally { await bandal.close(); rmSync(profile, { recursive: true, force: true }) }
})

test('review opens with useful creation actions and keeps old English failures in task history', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '생물학')
    const source = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {})).find(item => item.name === '생물학')!)
    const repo = createLearningRepo({ getCourseFolder: () => source.folderPath })
    const binding = { courseId: source.id, rootRelPath: 'AI 학습자료' }
    await repo.create({ binding, name: 'AI 학습자료', topic: '과목 자료', purpose: 'course-review' })
    const timestamp = '2026-10-01T00:00:00.000Z'
    await repo.updateRun({ binding, run: { id: 'old-failure', kind: 'find-articles', status: 'failed', provider: 'codex', error: '예전 영어 검색 실패', message: '', articleIds: [], wordIds: [], draft: null, createdAt: timestamp, updatedAt: timestamp } })
    await showProjects(page)
    const list = page.getByRole('complementary', { name: '프로젝트 목록' })
    await list.locator('.project-list-row__open').filter({ hasText: '생물학 복습' }).click()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await expect(page.getByRole('tab', { name: '퀴즈', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '플래시카드', exact: true })).toBeVisible()
    await expect(page.locator('.learning-run:visible')).toHaveCount(0)
    await expect(page.locator('.learning-notice:visible').filter({hasText:'읽기 설정'})).toHaveCount(0)
    await expect(page.locator('.learning-hero-orbit')).toHaveCount(0)
    await page.getByRole('region', { name: '프로젝트 AI 작업' }).getByText('작업 기록', { exact: false }).click()
    await expect(page.locator('.learning-run:visible')).toContainText('예전 영어 검색 실패')
    await page.screenshot({ path: info.outputPath('review-simple-home.png') })
  } finally { await bandal.close() }
})
