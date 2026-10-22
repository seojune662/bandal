import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { createCourse, launchBandal } from './helpers/launch'
import { showProjects } from './helpers/projectWorkspace'
import { installLearningAiFixture } from './helpers/learning'

test('project groups retain moves, order and collapse after restart while home tabs keep the active workspace', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const profile = bandal.profileDir
  try {
    let page = bandal.page
    await installLearningAiFixture(bandal)
    await createCourse(page, '학기 과목')
    const projects = await page.evaluate(async () => {
      const ai = { provider: 'gemini' as const, model: 'pro', effort: null }
      const source = (await window.bandal.invoke('courses:list', {})).find(course => course.name === '학기 과목')!
      const first = await window.bandal.invoke('learning:create', { placement: 'standalone', name: '시험 준비', purpose: 'course-review', topic: '시험', linkedCourseId: source.id, ai })
      const second = await window.bandal.invoke('learning:create', { placement: 'standalone', name: '주말 읽기', purpose: 'english-reading', topic: '과학', topicIds: ['science'], readingSetupConfirmed: true, level: 'intermediate', readingMinutes: 5, ai })
      return [first, second]
    })
    await showProjects(page)
    await expect(page.locator('.project-list-row__open')).toHaveCount(2)
    await page.getByRole('button', { name: '프로젝트 추가', exact: true }).click()
    await page.getByRole('menuitem', { name: '새 그룹', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '새 그룹 만들기' })
    await dialog.getByRole('textbox', { name: '이름', exact: true }).fill('이번 달')
    await dialog.getByRole('button', { name: '그룹 만들기' }).click()
    await expect(dialog).toBeHidden()
    for (const name of ['시험 준비', '주말 읽기']) {
      await page.getByRole('button', { name: `${name} 더보기`, exact: true }).click()
      await page.getByRole('combobox', { name: '프로젝트 그룹' }).selectOption({ label: '이번 달' })
      await expect(page.locator('.project-group').filter({ has: page.getByRole('button', { name: '이번 달 그룹 메뉴' }) })).toContainText(name)
    }
    await page.getByRole('button', { name: '이번 달 그룹 메뉴' }).click()
    await expect(page.getByRole('menuitem', { name: '프로젝트 추가', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: '그룹 삭제' })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    const rename = page.getByRole('dialog', { name: '그룹 이름 변경' })
    await rename.getByRole('textbox', { name: '이름', exact: true }).fill('집중 프로젝트')
    await rename.getByRole('button', { name: '변경하기' }).click()
    const group = page.locator('.project-group').filter({ has: page.getByRole('button', { name: '집중 프로젝트 그룹 메뉴' }) })
    const rows = group.locator('.project-list-row')
    await rows.filter({ hasText: '주말 읽기' }).dragTo(rows.filter({ hasText: '시험 준비' }))
    await expect(rows.first()).toContainText('주말 읽기')
    await group.locator('.project-list-row__open').filter({ hasText: '시험 준비' }).click()
    await expect(page.locator('.right-sidebar')).toContainText('시험 준비')
    await page.locator('.project-sidebar .home-tabs').getByRole('tab', { name: '과목', exact: true }).click()
    await expect(page.locator('.right-sidebar')).toContainText('시험 준비')
    await showProjects(page)
    await expect(group.locator('.project-list-row__open[aria-current="page"]')).toContainText('시험 준비')
    await group.getByRole('button', { name: '주말 읽기 펼치기', exact: true }).click()
    await group.locator('.project-folder-contents').getByRole('button', { name: '단어장', exact: true }).click()
    await expect(group.locator('.project-list-row__open[aria-current="page"]')).toContainText('주말 읽기')
    await expect(page.locator('.right-sidebar')).toContainText('주말 읽기')
    await group.locator('.project-list-row__open').filter({ hasText: '시험 준비' }).click()
    await group.locator('.project-group__toggle').click()
    await expect(rows).toHaveCount(0)
    const saved = await page.evaluate(() => window.bandal.invoke('projects:navigation', {}))
    const savedGroup = saved.groups.find(item => item.name === '집중 프로젝트')!
    expect(saved.entries.filter(item => item.groupId === savedGroup.id).map(item => item.courseId)).toEqual([projects[1]!.binding.courseId, projects[0]!.binding.courseId])
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profile })
    page = bandal.page
    await showProjects(page)
    const restored = page.locator('.project-group').filter({ has: page.getByRole('button', { name: '집중 프로젝트 그룹 메뉴' }) })
    await expect(restored.locator('.project-group__toggle')).toHaveAttribute('aria-expanded', 'false')
    await restored.locator('.project-group__toggle').click()
    await expect(restored.locator('.project-list-row').first()).toContainText('주말 읽기')
    await expect(restored.locator('.project-list-row__open[aria-current="page"]')).toContainText('시험 준비')
  } finally { await bandal.close(); rmSync(profile, { recursive: true, force: true }) }
})
