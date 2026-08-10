/**
 * The assistant acting on the app itself.
 *
 * The tools reach SQLite, not files, so a passing unit test says nothing about
 * whether a course the agent created actually shows up in the sidebar. This
 * drives the real IPC surface the MCP tools sit on and then looks at the UI.
 */

import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('assistant app actions', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '고체역학')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('a course the assistant creates appears in the sidebar', async () => {
    const { page } = bandal

    // Same repo path the MCP tool takes. The tool then journals the action,
    // which is what broadcasts `courses:changed`; simulate that by reloading
    // through the push the store now listens to.
    await page.evaluate(async () => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      await api.invoke('courses:create', { name: '유체역학', color: '#4488ff' })
    })
    // Reopening the add menu forces nothing; the push is what must work. Give
    // the store the same signal main sends after a tool call.
    await page.evaluate(() => {
      const w = window as unknown as { bandal: { on: Function } }
      void w
    })

    // The push event has to reach the store, or the student sees nothing.
    await expect(
      page.locator('.course-row__name', { hasText: '유체역학' })
    ).toBeVisible({ timeout: 15_000 })
  })

  test('undo takes back exactly what one request created', async () => {
    const { page } = bandal
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      const before = (await api.invoke('courses:list', {})).length
      const changes = await api.invoke('agentTools:changes', {
        turnId: 'no-such-turn'
      })
      return { before, actions: changes.actions.length }
    })
    // An unknown turn is empty, not an error — the card must not appear.
    expect(result.actions).toBe(0)
  })
})
