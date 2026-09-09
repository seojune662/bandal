import { expect, test } from '@playwright/test'
import { launchBandal, type BandalApp } from './helpers/launch'

test.describe('right rail widgets', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal({
      extraSettings: {
        widgets: {
          enabled: ['todo', 'mail'],
          active: 'todo',
          heightRatio: 0.65,
          mailServiceId: null,
          mailUrl: 'https://mail.example.test/inbox',
          lastMailOpenedAt: null
        }
      }
    })
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('adds dated and colored tasks and keeps them in chronological order', async () => {
    const { page } = bandal
    const widget = page.getByRole('region', { name: '자료 사이드바' }).getByRole('region', { name: '위젯' })
    const title = widget.getByLabel('할 일 추가')
    const date = widget.getByLabel('할 일 날짜')
    const colors = widget.getByRole('group', { name: '할 일 색상' })

    await title.fill('나중 할 일')
    await date.fill('2026-09-20')
    await colors.getByRole('button', { name: '파랑' }).click()
    await widget.getByRole('button', { name: '추가', exact: true }).click()

    await title.fill('먼저 할 일')
    await date.fill('2026-09-10')
    await colors.getByRole('button', { name: '빨강' }).click()
    await widget.getByRole('button', { name: '추가', exact: true }).click()

    await title.fill('날짜 없는 일')
    await date.fill('')
    await colors.getByRole('button', { name: '색상 없음' }).click()
    await widget.getByRole('button', { name: '추가', exact: true }).click()

    const rows = widget.locator('.widget-todo-list > li:not(.widget-empty)')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.widget-task-copy strong')).toHaveText([
      '먼저 할 일',
      '나중 할 일',
      '날짜 없는 일'
    ])
    await expect(rows.nth(0)).toHaveAttribute('data-color', 'red')
    await expect(rows.nth(1)).toHaveAttribute('data-color', 'blue')

    await rows.nth(1).locator('.widget-task-copy').click()
    await widget.getByLabel('나중 할 일 날짜').fill('2026-09-05')
    await widget
      .getByRole('group', { name: '나중 할 일 색상' })
      .getByRole('button', { name: '보라' })
      .click()

    await expect(rows.locator('.widget-task-copy strong')).toHaveText([
      '나중 할 일',
      '먼저 할 일',
      '날짜 없는 일'
    ])
    await expect(rows.nth(0)).toHaveAttribute('data-color', 'violet')
  })

  test('opens a native mailbox without embedding the desktop mail website', async () => {
    const { page } = bandal
    const widget = page.getByRole('region', { name: '자료 사이드바' }).getByRole('region', { name: '위젯' })

    await widget.getByRole('tab', { name: '메일' }).click()

    await expect(widget.locator('webview')).toHaveCount(0)
    await expect(widget.getByText('공부하면서 메일도 가볍게')).toBeVisible()
    await expect(widget.getByRole('button', { name: '메일 새로고침' })).toBeVisible()
    await widget.getByRole('button', { name: '메일함 넓히기' }).click()
    await expect(page.getByRole('dialog', { name: '메일함', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '메일함 접기', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '메일함', exact: true })).toHaveCount(0)
  })
})
