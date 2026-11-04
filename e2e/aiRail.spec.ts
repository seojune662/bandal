import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'
import { closeAiRail, openAiRail } from './helpers/aiRail'

test('AI opens as a left column that keeps its draft while closed, and materials start right under one search row', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    // No AI provider on CI: a connected fixture keeps the composer rendered.
    await bandal.app.evaluate(({ ipcMain }) => {
      const handle = (channel: string, fn: (req: any) => any) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, req) => fn(req)) }
      handle('chat:open', req => ({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { id: req.sessionId, courseId: req.courseId, provider: 'claude-code', model: 'fixture', status: 'idle', title: null, surface: 'app', cliSessionId: null, lastUsedAt: null } }))
      handle('agent:models', () => ({ models: [{ id: 'fixture', displayName: 'Fixture', isDefault: true }] }))
      handle('agent:skills', () => [])
    })
    const { page } = bandal
    await createCourse(page, 'AI 열 검사')
    const course = (await page.evaluate(() => window.bandal.invoke('courses:list', {})))[0]!
    writeFileSync(join(course.folderPath, 'first.md'), '# First\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()

    // The right panel is materials-only now.
    await expect(page.getByRole('tablist', { name: '오른쪽 사이드바' })).toHaveCount(0)
    const rail = (await page.locator('.right-sidebar').boundingBox())!
    const firstRow = (await page.locator('[data-material-path="first.md"]').boundingBox())!
    await info.attach('materials-header', { body: JSON.stringify({ headerHeight: firstRow.y - rail.y }), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('materials-header.png') })
    expect(firstRow.y - rail.y).toBeLessThan(120)

    const handle = page.getByRole('button', { name: 'AI 열기', exact: true })
    await expect(handle).toBeVisible()
    const courseRail = (await page.locator('#course-rail').boundingBox())!
    expect(Math.abs((await handle.boundingBox())!.x - (courseRail.x + courseRail.width))).toBeLessThanOrEqual(2)

    await openAiRail(page)
    const ai = page.getByRole('region', { name: 'AI', exact: true })
    await expect(ai).toBeVisible()
    // Measure after the grid transition settles; the pull tab rides the column's right edge.
    await expect.poll(async () => Math.round((await page.locator('#ai-rail').boundingBox())!.width)).toBeGreaterThanOrEqual(280)
    await expect.poll(async () => {
      const box = (await page.locator('#ai-rail').boundingBox())!, tab = (await page.getByRole('button', { name: 'AI 닫기', exact: true }).boundingBox())!
      // Narrow windows (Windows CI) collapse the course rail when AI opens; the column then follows the nav rail.
      const rail = await page.locator('#course-rail').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, width: r.width } })
      return Math.abs(box.x - (rail.x + rail.width)) <= 1 && Math.abs(tab.x - (box.x + box.width)) <= 2
    }).toBe(true)
    const input = ai.getByRole('textbox', { name: '메시지 입력' })
    await input.fill('닫아도 남는 초안')
    await page.screenshot({ path: info.outputPath('ai-rail-open.png') })

    await closeAiRail(page)
    await expect(ai).toBeHidden()
    await expect(page.locator('#ai-rail')).toHaveAttribute('inert', '')
    await openAiRail(page)
    await expect(input).toHaveValue('닫아도 남는 초안')

    // Without the course sidebar the column sits right beside the navigation rail.
    if (!await page.locator('#course-rail[aria-hidden="true"]').count()) await page.getByRole('button', { name: '홈', exact: true }).click()
    const navigation = (await page.locator('.global-navigation').boundingBox())!
    await expect.poll(async () => Math.round((await page.locator('#ai-rail').boundingBox())!.x)).toBe(Math.round(navigation.x + navigation.width))

    // A covering board hides the pull tab.
    await page.getByRole('button', { name: '학업 보드 열기', exact: true }).click()
    await expect(page.getByRole('button', { name: 'AI 닫기', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '학업 보드 닫기', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'AI 닫기', exact: true })).toBeVisible()
  } finally { await bandal.close() }
})
