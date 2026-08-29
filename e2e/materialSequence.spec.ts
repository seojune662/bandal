import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

const FIRST_NOTE = 'first-note.md'
const SECOND_NOTE = 'second-note.md'

/**
 * 자료 행 드래그 → 탭 오른쪽 가장자리 드롭존 → '다음' 연결 생성 → 탭 상단
 * 내비 바로 이동까지의 순서 연결 UX 전체를 검증한다. 파일 행 드래그는
 * 네이티브 승격이라 dataTransfer 가 없으므로(materialsDrag.spec 과 동일)
 * 드롭존은 files 가 빈 합성 drop 에서 모듈 상태를 신뢰한다.
 */
test('edge drop links materials in sequence and the nav bar navigates', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '순서 연결 과목')

    const courseFolder = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory())
    expect(courseFolder).toBeDefined()
    const courseDir = join(bandal.dataRoot, courseFolder!.name)
    writeFileSync(join(courseDir, FIRST_NOTE), '# 첫 번째 자료\n')
    writeFileSync(join(courseDir, SECOND_NOTE), '# 두 번째 자료\n')

    await page.getByRole('button', { name: '자료 새로고침' }).click()
    const firstRow = page.locator(`[data-material-path="${FIRST_NOTE}"]`)
    const secondRow = page.locator(`[data-material-path="${SECOND_NOTE}"]`)
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()

    // 첫 노트를 탭으로 연다.
    await firstRow.click()
    await expect(page.locator('.note-editor-shell').first()).toBeVisible({
      timeout: 30_000
    })

    // 드래그 시작 전에는 드롭존이 없다.
    await expect(page.locator('.sequence-drop-strip')).toHaveCount(0)

    // 두 번째 노트 행 드래그 시작 — 네이티브 승격 전에 모듈 상태가 기록된다.
    await secondRow.evaluate((row) => {
      row.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer()
        })
      )
    })

    const nextStrip = page.locator('.sequence-drop-strip--next')
    await expect(nextStrip).toBeVisible()
    await expect(page.locator('.sequence-drop-strip--prev')).toBeVisible()

    // 오른쪽 가장자리에 드롭 → "현재 탭의 다음 = 드래그한 자료".
    await nextStrip.evaluate((strip) => {
      const dataTransfer = new DataTransfer()
      const bounds = strip.getBoundingClientRect()
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        dataTransfer
      }
      strip.dispatchEvent(new DragEvent('dragover', eventInit))
      strip.dispatchEvent(new DragEvent('drop', eventInit))
    })

    // 드롭존은 드래그 종료와 함께 사라진다.
    await expect(page.locator('.sequence-drop-strip')).toHaveCount(0)

    // 내비 바가 나타나고 다음 자료로 이동할 수 있다.
    const nextLink = page.locator('.sequence-nav__link--next')
    await expect(nextLink).toBeVisible({ timeout: 15_000 })
    await expect(nextLink).toContainText('second-note')

    await nextLink.click()

    // 두 번째 노트 탭이 열리고, 그쪽 내비 바에는 이전 자료가 보인다.
    const prevLink = page.locator('.sequence-nav__link--prev')
    await expect(prevLink).toBeVisible({ timeout: 30_000 })
    await expect(prevLink).toContainText('first-note')
  } finally {
    await bandal.close()
  }
})
