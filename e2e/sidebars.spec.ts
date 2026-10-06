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
    await expect(page.locator('.global-navigation')).toBeHidden()
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

  test('sidebar resize handles support keyboard adjustment and retain the chosen width', async () => {
    const { page } = bandal
    for (const side of ['left', 'right']) {
      const handle = page.locator(`.rail-resizer--${side}`)
      await handle.focus()
      await page.keyboard.press('Home')
      const minimum = side === 'left' ? 176 : 220
      await expect(handle).toHaveAttribute('aria-valuenow', String(minimum))
      await page.keyboard.press(side === 'left' ? 'ArrowRight' : 'ArrowLeft')
      await expect(handle).toHaveAttribute('aria-valuenow', String(minimum + 16))
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem('bandal:rail-widths:v1')!)[key], side)
      expect(saved).toBe(minimum + 16)
      await handle.dblclick()
    }
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
    await expect(page.locator('.global-navigation')).toBeHidden()
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

  test('course button collapses only the list and whole-left toggle also controls settings', async () => {
    const { page } = bandal
    const menu = page.locator('.global-navigation')
    const course = page.locator('aside.app-rail--left')
    const search = course.getByRole('searchbox')
    await search.fill('알고')
    await page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
    await expect(menu).toBeVisible()
    await expect(course).toBeHidden()
    await page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
    await expect(course).toBeVisible()
    await expect(search).toHaveValue('알고')
    await search.fill('')
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('.settings-sidebar')).toBeVisible()
    await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
    await expect(menu).toBeHidden()
    await expect(page.locator('.settings-sidebar')).toBeHidden()
    await expect(page.getByRole('button', { name: '앱으로 돌아가기' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+s')
    await expect(page.locator('.settings-sidebar')).toBeVisible()
    await page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
    await expect(page.locator('.shell-settings-overlay')).toHaveCount(0)
    await expect(course).toBeVisible()
  })

  test('native fullscreen shifts chrome and the collapsed workspace spacer together', async ({}, info) => {
    const { page, app } = bandal
    if (await page.locator('.workspace-chrome-spacer').count() === 0) {
      await createCourse(page, '전체화면')
      await page.locator('.whiteboards-group').getByRole('button', { name: '새 화이트보드 만들기' }).click()
    }
    await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
    const chrome = page.locator('.shell-chrome')
    const normalWidth = await chrome.evaluate(element => element.getBoundingClientRect().width)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setFullScreen(true))
    try {
      await expect(page.locator('html')).toHaveAttribute('data-fullscreen', 'true')
      await expect(chrome).toHaveCSS('width', '48px')
      await expect(page.locator('.workspace-chrome-spacer').first()).toHaveCSS('width', '48px')
      await page.screenshot({ path: info.outputPath('fullscreen-collapsed.png') })
    } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setFullScreen(false))
    }
    await expect(page.locator('html')).toHaveAttribute('data-fullscreen', 'false')
    await expect(chrome).toHaveCSS('width', `${normalWidth}px`)
    await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
  })

  test('rapid sidebar reversal preserves state and reduced motion settles immediately', async () => {
    const { page } = bandal
    await page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>('.shell-chrome button')!
      button.click()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      button.click()
    })
    await expect(page.locator('.app-shell')).toHaveAttribute('data-left-rail', 'open')
    await expect(page.locator('aside.app-rail--left')).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    try {
      await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
      await expect(page.locator('.global-navigation')).toBeHidden()
      await expect(page.locator('.shell-course-rail')).toHaveCSS('width', '0px')
      await expect(page.locator('.global-navigation')).toHaveCSS('transition-delay', '0s')
      await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
      await expect(page.locator('aside.app-rail--left')).toBeVisible()
    } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }) }
  })

})

test('shell controls remain reachable over the academic board and retained tab chrome', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await page.getByRole('button', { name: '학업 보드 열기', exact: true }).click()
    await expect(page.locator('.board-overlay')).toBeVisible()
    const toggle = page.locator('.shell-chrome button')
    expect(await toggle.evaluate(button => {
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    await toggle.click()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-left-rail', 'closed')
    await expect(page.locator('.board-overlay')).toBeVisible()
    await toggle.click()
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('.settings-sidebar')).toBeVisible()
    const courseButton = page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true })
    expect(await courseButton.evaluate(button => {
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    await toggle.click()
    await expect(page.locator('.settings-sidebar')).toBeHidden()
    await toggle.click()
    await expect(page.locator('.settings-sidebar')).toBeVisible()
    await page.locator('.global-navigation').getByRole('button', { name: '과목', exact: true }).click()
    await expect(page.locator('.shell-settings-overlay')).toHaveCount(0)
    await expect(page.locator('.board-overlay')).toHaveCount(0)
    await expect(page.locator('aside.app-rail--left')).toBeVisible()
    await createCourse(page, '첫 과목')
    await page.locator('.whiteboards-group').getByRole('button', { name: '새 화이트보드 만들기' }).click()
    await expect(page.locator('.ink-layer')).toBeVisible()
    await createCourse(page, '두 번째 과목')
    const inactiveHeaders = page.locator('.workspace-course[hidden] .dv-tabs-and-actions-container')
    expect(await inactiveHeaders.count()).toBeGreaterThan(0)
    expect(await inactiveHeaders.evaluateAll(elements => elements.every(element => getComputedStyle(element).getPropertyValue('-webkit-app-region') !== 'drag'))).toBe(true)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  } finally { await bandal.close() }
})
