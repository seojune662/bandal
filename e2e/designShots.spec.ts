/**
 * Design review captures — NOT an assertion suite.
 *
 * Drives the built app into a few representative states and writes PNGs to
 * `design-shots/<stage>/`, so a typography/chrome change can be eyeballed
 * side by side against the stage before it. Stage comes from
 * BANDAL_SHOT_STAGE (default `current`).
 *
 *   pnpm build && BANDAL_SHOT_STAGE=00-baseline npx playwright test -c e2e designShots
 *
 * Every capture is its own test and swallows setup failures, so one surface
 * that fails to open never costs the rest of the sheet.
 */

import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'

import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const STAGE = process.env['BANDAL_SHOT_STAGE'] ?? 'current'
const OUT_DIR = resolve(__dirname, '..', 'design-shots', STAGE)

let bandal: BandalApp

/** Writes a full-window PNG; never throws, so one bad surface can't cascade. */
async function shot(page: Page, name: string): Promise<void> {
  // Let fonts settle — a capture taken mid-swap shows the fallback face.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) })
}

test.describe.configure({ mode: 'serial' })

test.describe(`design shots — ${STAGE}`, () => {
  test.beforeAll(async () => {
    mkdirSync(OUT_DIR, { recursive: true })
    bandal = await launchBandal()
    const { page } = bandal
    // Enough courses that the rail shows real rhythm rather than one row.
    await createCourse(page, '알고리즘')
    await createCourse(page, '선형대수학')
    await createCourse(page, '컴퓨터구조')
    // Report which face actually resolved — the whole point of stage 01.
    const resolved = await page.evaluate(() => {
      // Two unreliable probes exist here and both had to go. fonts.check()
      // reports true whenever the chain can render the glyphs at all, and a
      // single-sentinel width probe reports true whenever the requested family
      // merely *resolves* (Chromium maps "Pretendard Variable" onto an
      // installed static "Pretendard"). Measure against TWO different
      // sentinels instead: a real family renders identically after both, a
      // missing one tracks whichever sentinel it fell through to.
      const measure = (family: string): number => {
        const el = document.createElement('span')
        el.style.cssText =
          'position:absolute;visibility:hidden;white-space:nowrap;font-size:64px;font-family:' +
          family
        el.textContent = 'Handgloves 0123'
        document.body.append(el)
        const w = el.getBoundingClientRect().width
        el.remove()
        return w
      }
      const has = (name: string): boolean =>
        measure(`"${name}", monospace`) === measure(`"${name}", cursive`)
      const probe = document.createElement('span')
      probe.textContent = '한글 Ag'
      document.body.append(probe)
      const family = getComputedStyle(probe).fontFamily
      probe.remove()
      return {
        family,
        installed: [
          'Pretendard Variable',
          'Pretendard',
          'Segoe UI',
          'Malgun Gothic',
          'Definitely Not A Real Font'
        ].filter(has),
        // What the app itself shipped, as opposed to what the OS happens to have.
        bundled: Array.from(document.fonts).map((f) => `${f.family} [${f.status}]`)
      }
    })
    writeFileSync(
      join(OUT_DIR, 'font-report.txt'),
      `stage: ${STAGE}\n--font-sans declares: ${resolved.family}\n` +
        `resolvable on this machine: ${resolved.installed.join(', ') || '(none)'}\n` +
        `bundled @font-face: ${resolved.bundled.join(', ') || '(none — using OS fonts)'}\n`
    )
  })

  test.afterAll(async () => {
    await bandal?.close()
  })

  test('01 shell', async () => {
    await shot(bandal.page, '01-shell')
  })

  test('02 board', async () => {
    const { page } = bandal
    await page
      .locator('aside.app-rail--left .rail-nav__item[aria-label^="학업 보드"]')
      .click()
    await page.locator('.board-overlay').waitFor()
    await page.getByRole('group', { name: '학업 보드 화면' }).getByRole('button', { name: '목록' }).click()
    await shot(page, '02-board')
  })

  test('03 calendar', async () => {
    const { page } = bandal
    await page.getByRole('group', { name: '학업 보드 화면' }).getByRole('button', { name: '달력' }).click()
    await page.locator('.calendar-view, .board-overlay').first().waitFor()
    await shot(page, '03-calendar')
    await page.keyboard.press('Escape')
  })

  test('04 course dialog', async () => {
    const { page } = bandal
    await page.locator('aside.app-rail--left').getByRole('button', { name: '과목 추가' }).click()
    await page
      .getByRole('menu', { name: '과목 추가' })
      .getByRole('menuitem', { name: '새 과목 만들기' })
      .click()
    await page.getByRole('dialog', { name: '새 과목' }).waitFor()
    await shot(page, '04-course-dialog')
    await page.keyboard.press('Escape')
  })

  test('05 link graph', async () => {
    const { page } = bandal
    await page
      .locator('aside.app-rail--left .rail-nav__item[aria-label="연결 그래프"]')
      .click()
    await page.waitForTimeout(600)
    await shot(page, '05-link-graph')
    await page.keyboard.press('Escape')
  })

  test('06 settings', async () => {
    const { page } = bandal
    // Settings is a full-window overlay inside the main window, not its own
    // BrowserWindow — src/renderer/settings.html is a build entry nothing loads.
    await page
      .locator('aside.app-rail--left .rail-nav__item[aria-label="설정"]')
      .click()
    await page.locator('.settings-app, .settings-overlay').first().waitFor()
    await page.waitForTimeout(600)
    await shot(page, '06-settings')
    await page.keyboard.press('Escape')
  })
})
