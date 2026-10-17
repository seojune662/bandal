/**
 * The text tool has to actually produce a text box.
 *
 * It silently did nothing: the draft textarea autofocuses, but the text branch
 * of the pointer-down handler returned before `preventDefault()`, so the
 * browser's default focus shift ran afterwards, moved focus to the panel, and
 * blurred the draft — which is then discarded for being empty.
 *
 * No unit test could catch that. It is entirely about real focus behaviour, so
 * it belongs here, in a real Electron window running the production build.
 */

import { expect, test } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { createPdfNote } from './helpers/pdfNotes'

test.describe('editable PDF note objects', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('the text tool opens an editable box and keeps what is typed', async () => {
    const { page } = bandal
    await createCourse(page, '알고리즘')
    await createPdfNote(page, '텍스트 필기 검증')

    const surface = page.locator('.pdf-page[data-pdf-page="1"]:visible .ink-layer')
    await expect(surface).toBeVisible()
    if (!await page.getByRole('button', { name: '텍스트', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '주석 도구', exact: true }).click()
    }
    await page.getByRole('button', { name: '텍스트', exact: true }).click()

    const bounds = await surface.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.click(bounds!.x + 200, bounds!.y + 160)

    // Focus has to land in the draft, or the next keystroke goes nowhere.
    const draft = page.getByRole('textbox', { name: '텍스트 입력' })
    await expect(draft).toBeFocused()

    await page.keyboard.type('중간고사 범위')
    await expect(draft).toHaveText('중간고사 범위')

    // Clicking away commits it — and opens a fresh placeholder at the click
    // (GoodNotes 방식: 클릭이 "확정"으로만 소비되지 않는다).
    await page.mouse.click(bounds!.x + 600, bounds!.y + 480)
    await expect(
      page.locator('.ink-layer__textbox', { hasText: '중간고사 범위' })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: '텍스트 입력' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('an empty box is discarded instead of leaving an invisible shape behind', async () => {
    const { page } = bandal
    const surface = page.locator('.pdf-page[data-pdf-page="1"]:visible .ink-layer')
    const bounds = await surface.boundingBox()
    const before = await page.locator('.ink-layer__textbox').count()

    await page.mouse.click(bounds!.x + 240, bounds!.y + 360)
    await expect(page.getByRole('textbox', { name: '텍스트 입력' })).toBeFocused()
    await page.keyboard.press('Escape')

    // An empty text box renders as nothing but still catches the eraser and
    // clutters the note, so it must never be stored.
    await expect(page.locator('.ink-layer__textbox')).toHaveCount(before)
  })

  test('the format bar recolors a committed PDF note textbox', async () => {
    const { page } = bandal
    const committed = page.locator('.ink-layer__textbox-object', {
      hasText: '중간고사 범위'
    })
    await expect(committed).toBeVisible()
    const body = (await committed.boundingBox())!
    // text 툴 단일 클릭 = 편집 → 서식 바가 뜬다.
    await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2)
    const bar = page.locator('.ink-format-row')
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: '파랑', exact: true }).click()
    await expect(
      committed.locator('[data-text-color="blue"]')
    ).toHaveText('중간고사 범위')
    await page.keyboard.press('Escape')
  })
})
