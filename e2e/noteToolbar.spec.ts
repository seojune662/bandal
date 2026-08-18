/**
 * Regression: the v0.13.0 dead toolbar. A duplicated @milkdown/core rejected
 * editor.create() silently, so every toolbar button was a no-op while typing
 * still worked. This drives the REAL toolbar buttons and asserts the document
 * actually changes — the exact path the unit suite could not cover.
 */

import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const SEEDED_NOTE = '툴바검증.md'

test.describe('note toolbar commands', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')
    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    writeFileSync(join(bandal.dataRoot, folders[0]!, SEEDED_NOTE), '# 툴바검증\n\n본문 문단\n')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('toolbar buttons mutate the document (blockquote + heading)', async () => {
    const { page } = bandal
    const noteRow = page.locator('.material-row', { hasText: '툴바검증' })
    await expect(async () => {
      if (!(await noteRow.isVisible())) {
        await page.getByRole('button', { name: '자료 새로고침' }).click()
      }
      await expect(noteRow).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await noteRow.click()

    const editor = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(editor).toBeVisible()

    // Cursor into the body paragraph.
    await editor.getByText('본문 문단').click()

    // 인용 — the button the user reported dead.
    await page.getByRole('button', { name: '인용' }).first().click()
    await expect(editor.locator('blockquote', { hasText: '본문 문단' })).toBeVisible()

    // H2 — a second, independent command path.
    await editor.getByText('본문 문단').click()
    await page.getByRole('button', { name: '제목 2' }).first().click()
    await expect(editor.locator('h2', { hasText: '본문 문단' })).toBeVisible()
  })
})
