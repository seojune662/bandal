/**
 * A collapsed sidebar must always be reopenable.
 *
 * Both toggles lived in dockview header-action slots, which only exist when a
 * tab group does. Close every tab with a sidebar collapsed and there was no
 * button anywhere — the only way back was restarting the app.
 */

import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('sidebars', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal({
      extraSettings: {
        university: {
          universityId: 'snu',
          customUniversity: null,
          hiddenServiceIds: [],
          customServices: [],
          openExternallyOverrides: {},
          serviceOrder: [],
          secondaryOverrides: {}
        }
      }
    })
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('the course sidebar can be reopened with no tabs open', async () => {
    const { page } = bandal
    await createCourse(page, '알고리즘')

    await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
    await expect(page.locator('aside.app-rail--left')).toBeHidden()
    await expect(page.locator('.global-navigation')).toHaveCount(0)
    await expect(page.locator('.rail-resizer--left')).toHaveCount(0)

    const expand = page.getByRole('button', { name: '과목 사이드바 펼치기' })
    // Exactly one: the watermark's button must not double up with the tab bar's.
    await expect(expand).toHaveCount(1)
    await expand.click()
    await expect(page.locator('aside.app-rail--left')).toBeVisible()
  })

  test('uses the school as the rail identity instead of centered branding', async () => {
    const { page } = bandal
    const rail = page.locator('aside.app-rail--left')

    await expect(rail.locator('.course-sidebar-chrome__name')).toHaveCount(0)
    await expect(rail.locator('.course-sidebar-chrome__mark')).toHaveCount(0)
    await expect(rail.getByText('CAMPUS', { exact: true })).toHaveCount(0)
    await expect(
      rail.getByRole('button', { name: /서울대학교 바로가기/ })
    ).toBeVisible()
  })

  test('the materials sidebar can be reopened with no tabs open', async () => {
    const { page } = bandal

    await page.getByRole('button', { name: '자료 사이드바 접기' }).click()
    const expand = page.getByRole('button', { name: '자료 사이드바 펼치기' })
    await expect(expand).toHaveCount(1)
    await expand.click()
    await expect(page.getByRole('button', { name: '자료 사이드바 접기' })).toHaveCount(1)
  })

  test('opening a tab does not leave two of either toggle', async () => {
    const { page } = bandal
    await page
      .locator('.whiteboards-group')
      .getByRole('button', { name: '새 화이트보드 만들기' })
      .click()
    await expect(page.locator('.ink-layer')).toBeVisible()

    await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
    await expect(
      page.getByRole('button', { name: '과목 사이드바 펼치기' })
    ).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: '자료 사이드바 접기' })
    ).toHaveCount(1)
  })
  test('Cmd/Ctrl+S toggles the entire rail once and widgets keep independent cards', async ({}, info) => {
    const { page } = bandal
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.global-navigation')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.global-navigation')).toHaveCount(0)
    await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
    await page.evaluate(() => window.bandal.invoke('settings:set', { widgets: { enabled: ['todo', 'board', 'mail'], collapsed: [], heightRatio: 0.6 } }))
    await expect(page.locator('.widget-card')).toHaveCount(3)
    await expect(page.locator('.widget-card').first()).toHaveAttribute('data-widget', 'todo')
    const todo = page.locator('.widget-card[data-widget="todo"]')
    await expect(todo.getByRole('textbox', { name: '할 일 추가' })).toBeVisible()
    await expect(todo.locator('input[type="date"]')).toBeHidden()
    await todo.locator('summary').click()
    await expect(todo.locator('input[type="date"]')).toBeVisible()
    await todo.locator('summary').click()
    await page.getByRole('button', { name: '투두 위젯 접기' }).click()
    await expect(todo.locator('.widget-card__body')).toBeHidden()
    await expect(page.locator('.widget-card[data-widget="board"] .widget-card__body')).toBeVisible()
    await page.getByRole('button', { name: '투두 위젯 펼치기' }).click()
    await page.screenshot({ path: info.outputPath('widget-cards.png') })
  })

})
