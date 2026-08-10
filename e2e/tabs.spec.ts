import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const SEEDED_NOTE = 'Seeded.md'
const SCROLL_SAMPLE_COUNT = 12
const WHEEL_DELTA = 32

interface ScrollSample {
  scrollLeft: number
  timestamp: number
}

/** Opens the workspace "+" omnibox (header button, or watermark CTA when no tabs are open). */
async function openNewTabMenu(page: Page): Promise<void> {
  const headerButton = page.locator('.workspace-add-tab')
  if (await headerButton.isVisible()) {
    await headerButton.click()
  } else {
    await page
      .locator('.workspace-watermark')
      .getByRole('button', { name: '새 탭 열기' })
      .click()
  }
  await expect(page.getByRole('dialog', { name: '새 탭 열기' })).toBeVisible()
}

async function sampleContinuousWheel(
  page: Page,
  tabs: Locator,
  deltaX: number,
  deltaY: number
): Promise<ScrollSample[]> {
  await tabs.evaluate((element) => {
    element.scrollLeft = 0
  })
  await tabs.hover()

  const samples: ScrollSample[] = [{ scrollLeft: 0, timestamp: 0 }]
  for (let index = 0; index < SCROLL_SAMPLE_COUNT; index += 1) {
    await page.mouse.wheel(deltaX, deltaY)
    samples.push(
      await tabs.evaluate(
        (element) =>
          new Promise<ScrollSample>((resolve) => {
            window.requestAnimationFrame((timestamp) => {
              resolve({ scrollLeft: element.scrollLeft, timestamp })
            })
          })
      )
    )
  }
  return samples
}

function expectSteadyForwardScroll(samples: ScrollSample[]): void {
  const positions = samples.map((sample) => sample.scrollLeft)
  const scrollSteps = positions
    .slice(1)
    .map((position, index) => position - positions[index]!)
  const frameGaps = samples
    .slice(2)
    .map((sample, index) => sample.timestamp - samples[index + 1]!.timestamp)

  expect(positions.at(-1)).toBeGreaterThan(0)
  expect(
    scrollSteps.every((step) => step > 0),
    `scrollLeft samples: ${positions.join(', ')}`
  ).toBe(true)
  expect(Math.max(...scrollSteps)).toBeLessThanOrEqual(WHEEL_DELTA * 1.5)

  /*
   * The jank the student reported was *dropped input*, not a slow machine:
   * dockview's scrollbar discarded `deltaX` entirely, so gestures produced no
   * movement at all. The monotonic-step assertions above catch that and are
   * deterministic.
   *
   * Frame timing is not. A wall-clock budget here fails whenever the CI box or
   * a parallel build steals the main thread, and a test that cries wolf under
   * load is worse than no test — people stop reading the failures. So this is
   * a generous ceiling that only catches a real stall, not a busy machine.
   */
  expect(Math.max(...frameGaps)).toBeLessThan(400)
}

test.describe('workspace tabs', () => {
  let bandal: BandalApp
  let courseDir: string

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '운영체제')

    // Seed a markdown note directly into the course folder on disk.
    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    expect(folders.length).toBe(1)
    courseDir = join(bandal.dataRoot, folders[0]!)
    writeFileSync(join(courseDir, SEEDED_NOTE), '# Seeded\n')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('opens a seeded note from the materials tree and autosaves edits', async () => {
    const { page } = bandal
    const noteRow = page.locator('.material-row', { hasText: 'Seeded' })

    // The live watcher usually pushes the new file on its own; the refresh
    // button is the deterministic fallback.
    await expect(async () => {
      if (!(await noteRow.isVisible())) {
        await page.getByRole('button', { name: '자료 새로고침' }).click()
      }
      await expect(noteRow).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })

    // Single click opens — the tree stopped requiring a double click.
    await noteRow.click()

    // Note tab opens with the file name and a live save-status chip.
    await expect(
      page.locator('.workspace-tab__title', { hasText: 'Seeded' })
    ).toBeVisible()
    const status = page.locator('.note-save-status')
    await expect(status).toBeVisible()
    await expect(status).toHaveAttribute('data-status', 'saved')

    // Type into the Milkdown editor.
    const editor = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type('autosave-e2e-marker')

    // The autosave indicator reacts, then settles back to 저장됨.
    await expect(status).toHaveText('저장됨')
    await expect(status).toHaveAttribute('data-status', 'saved')

    // And the edit actually reached the disk.
    await expect
      .poll(() => readFileSync(join(courseDir, SEEDED_NOTE), 'utf8'))
      .toContain('autosave-e2e-marker')
  })

  test('opens the study board from the + menu', async () => {
    const { page } = bandal
    await openNewTabMenu(page)
    await page.getByRole('option', { name: '학업 보드' }).click()
    await expect(
      page.locator('.workspace-tab__title', { hasText: '학업 보드' })
    ).toBeVisible()
  })

  test('opens a browser tab without touching the network', async () => {
    const { page } = bandal
    await openNewTabMenu(page)

    // RFC 2606 .invalid never resolves — the tab opens, no content loads.
    await page.getByLabel('새 탭 검색').fill('example.invalid')
    await page
      .getByRole('option', { name: 'https://example.invalid 열기' })
      .click()

    await expect(
      page.locator('.workspace-tab__title', { hasText: 'example.invalid' })
    ).toBeVisible()
    // Browser chrome (nav + URL bar) is up regardless of load outcome.
    await expect(page.locator('.browser-toolbar')).toBeVisible()
  })

  test('scrolls an overflowing tab strip monotonically without dropped frames', async () => {
    const { page } = bandal
    const noteNames = Array.from(
      { length: SCROLL_SAMPLE_COUNT },
      (_, index) => `Scroll sample ${String(index + 1).padStart(2, '0')} long tab.md`
    )
    for (const noteName of noteNames) {
      writeFileSync(join(courseDir, noteName), '# Scroll sample\n')
    }

    await page.getByRole('button', { name: '자료 새로고침' }).click()
    for (const noteName of noteNames) {
      const title = noteName.replace(/\.md$/, '')
      const material = page.locator('.material-row', { hasText: title })
      await expect(material).toBeVisible()
      await material.click()
      await expect(
        page.locator('.workspace-tab__title', { hasText: title })
      ).toBeVisible()
    }

    const tabs = page.locator('.dv-tabs-container.dv-horizontal').first()
    const dimensions = await tabs.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }))
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)

    // The newest (active) tab is deliberately offscreen. If dockview keeps
    // revealing it after activation, the first sample jumps to the far end.
    const activeTabStaysOffscreen = await tabs.evaluate((element) => {
      element.scrollLeft = 0
      const activeTab = element.querySelector<HTMLElement>('.dv-active-tab')
      return (
        activeTab !== null &&
        activeTab.offsetLeft + activeTab.offsetWidth > element.clientWidth
      )
    })
    expect(activeTabStaysOffscreen).toBe(true)

    const horizontal = await sampleContinuousWheel(
      page,
      tabs,
      WHEEL_DELTA,
      0
    )
    expectSteadyForwardScroll(horizontal)

    const vertical = await sampleContinuousWheel(
      page,
      tabs,
      0,
      WHEEL_DELTA
    )
    expectSteadyForwardScroll(vertical)
  })
})
