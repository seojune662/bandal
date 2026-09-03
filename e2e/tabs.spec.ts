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
    // Body paragraph included: typing must land OUTSIDE the H1 — editing the
    // H1 renames the file (title↔filename sync) and breaks the disk poll.
    writeFileSync(join(courseDir, SEEDED_NOTE), '# Seeded\n\nnote-body\n')
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
    await editor.getByText('note-body').click()
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

test.describe('pdf scroll preservation', () => {
  test('keeps the reading page across tab switches and sidebar reflows', async () => {
    const bandal = await launchBandal()
    try {
      const { page } = bandal
      await createCourse(page, '항공역학')
      const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const courseDir = join(bandal.dataRoot, folders[0]!)

      // 다페이지 PDF — 스크롤이 의미 있으려면 페이지가 여럿이어야 한다.
      const { PDFDocument, StandardFonts } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      for (let index = 1; index <= 8; index += 1) {
        pdf.addPage([595, 842]).drawText(`Page ${index}`, {
          x: 64,
          y: 720,
          size: 28,
          font
        })
      }
      writeFileSync(join(courseDir, 'long.pdf'), await pdf.save())
      writeFileSync(join(courseDir, 'memo.md'), '# 메모\n\n본문\n')

      await page.getByRole('button', { name: '자료 새로고침' }).click()
      await page.locator('[data-material-path="long.pdf"]').click()
      const scroller = page.locator('.pdf-scroller')
      await expect(page.locator('.pdf-page').first()).toBeVisible({
        timeout: 30_000
      })

      await scroller.evaluate((element) => {
        element.scrollTop = 1200
      })
      await page.waitForTimeout(400)
      const before = await scroller.evaluate((element) => element.scrollTop)
      expect(before).toBeGreaterThan(0)
      const pageInput = page.getByRole('textbox', { name: '페이지 이동' })
      const pageBeforeTabSwitch = await pageInput.inputValue()

      // 같은 그룹에서 다른 탭으로 갔다가 돌아온다 — dockview 의
      // onlyWhenVisible 렌더러가 DOM 을 떼며 scrollTop 을 0으로 리셋하던
      // 회귀 시나리오 (PdfTab 은 setRenderer('always')로 방어).
      await page.locator('[data-material-path="memo.md"]').click()
      await expect(page.locator('.note-editor-shell').first()).toBeVisible({
        timeout: 30_000
      })
      await page.locator('.dv-tab', { hasText: 'long.pdf' }).click()

      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(before - 50)
      await expect(pageInput).toHaveValue(pageBeforeTabSwitch)

      // A width change used to keep the same pixel scrollTop while making
      // every fit-width page taller/shorter. That silently moved the viewport
      // from (for example) page 6 to page 4. Assert the semantic page and the
      // position within it, in both directions and for both outer sidebars.
      await pageInput.fill('6')
      await pageInput.press('Enter')
      await expect(pageInput).toHaveValue('6')

      const pageOffset = async (): Promise<number> =>
        scroller.evaluate((element) => {
          const pageBox = element.querySelector<HTMLElement>('[data-pdf-page="6"]')
          if (pageBox === null) return -1
          const scrollerBox = element.getBoundingClientRect()
          const box = pageBox.getBoundingClientRect()
          return (scrollerBox.top + element.clientHeight / 2 - box.top) / box.height
        })
      const anchorBeforeResize = await pageOffset()
      expect(anchorBeforeResize).toBeGreaterThan(0)
      expect(anchorBeforeResize).toBeLessThan(1)

      const expectPageSixPreserved = async (): Promise<void> => {
        await expect(pageInput).toHaveValue('6')
        await expect
          .poll(pageOffset)
          .toBeGreaterThan(anchorBeforeResize - 0.02)
        await expect
          .poll(pageOffset)
          .toBeLessThan(anchorBeforeResize + 0.02)
      }

      await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
      await expect(page.locator('aside.app-rail--left')).toBeHidden()
      await expectPageSixPreserved()

      await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
      await expect(page.locator('aside.app-rail--left')).toBeVisible()
      await expectPageSixPreserved()

      await page.getByRole('button', { name: '자료 사이드바 접기' }).click()
      await expect(page.locator('aside.app-rail--right')).toBeHidden()
      await expectPageSixPreserved()

      await page.getByRole('button', { name: '자료 사이드바 펼치기' }).click()
      await expect(page.locator('aside.app-rail--right')).toBeVisible()
      await expectPageSixPreserved()

      // The PDF's own preview/highlight rails resize the exact same scroller.
      // Keep these in the regression path so a future internal rail cannot
      // reintroduce the pixel-scrollTop bug independently of the app rails.
      const previewToggle = page.getByRole('button', { name: '미리보기' })
      await previewToggle.click()
      await expect(page.locator('.pdf-preview')).toBeVisible()
      await expectPageSixPreserved()
      await previewToggle.click()
      await expect(page.locator('.pdf-preview')).toBeHidden()
      await expectPageSixPreserved()

      const highlightToggle = page.getByRole('button', {
        name: '하이라이트 목록 토글'
      })
      await highlightToggle.click()
      await expect(page.locator('.pdf-rail')).toBeVisible()
      await expectPageSixPreserved()
      await highlightToggle.click()
      await expect(page.locator('.pdf-rail')).toBeHidden()
      await expectPageSixPreserved()

      const scrollbarWidth = await scroller.evaluate((element) =>
        Number.parseFloat(
          getComputedStyle(element, '::-webkit-scrollbar').width
        )
      )
      expect(scrollbarWidth).toBeGreaterThanOrEqual(12)
    } finally {
      await bandal.close()
    }
  })
})
