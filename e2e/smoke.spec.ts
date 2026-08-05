import { expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('smoke', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('launches into the empty state', async () => {
    const { page } = bandal
    await expect(
      page.locator('.empty-state--courses .empty-state__text', {
        hasText: '첫 과목을 만들어보세요'
      })
    ).toBeVisible()
    // Fresh profile: no course rows yet.
    await expect(page.locator('.course-row')).toHaveCount(0)
  })

  test('creates a course through the dialog and shows it in the sidebar', async () => {
    const { page, dataRoot } = bandal
    await createCourse(page, '알고리즘')

    // Empty state is replaced by the course list.
    await expect(page.locator('.empty-state--courses')).toBeHidden()
    await expect(
      page.locator('.course-row__name', { hasText: '알고리즘' })
    ).toBeVisible()

    // The course got a real folder under the temp data root.
    const folders = readdirSync(dataRoot, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory()
    )
    expect(folders.length).toBe(1)
    expect(existsSync(join(dataRoot, folders[0]!.name))).toBe(true)
  })
})
