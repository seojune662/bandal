import { expect, test } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  addCourseFromFolder,
  createCourse,
  launchBandal,
  stubFolderPicker,
  type BandalApp
} from './helpers/launch'

/** Opens the left rail "+" menu and picks 폴더에서 추가. */
async function openFolderDialog(page: Page): Promise<void> {
  await page.locator('aside.app-rail--left').getByRole('button', { name: '과목 추가' }).click()
  await page
    .getByRole('menu', { name: '과목 추가' })
    .getByRole('menuitem', { name: '폴더에서 추가' })
    .click()
}

test.describe('smoke', () => {
  let bandal: BandalApp
  /** An existing folder on disk, outside the data root, linked as a course. */
  let linkedRoot: string
  let linkedFolder: string

  test.beforeAll(async () => {
    bandal = await launchBandal()
    linkedRoot = mkdtempSync(join(tmpdir(), 'bandal-linked-'))
    // ASCII name: the prefilled-name assertion compares against basename(),
    // and Unicode normalization on APFS would make that comparison brittle.
    linkedFolder = join(linkedRoot, 'algo-lectures')
    mkdirSync(linkedFolder, { recursive: true })
    writeFileSync(join(linkedFolder, 'week1.md'), '# week1\n')
  })

  test.afterAll(async () => {
    await bandal.close()
    rmSync(linkedRoot, { recursive: true, force: true })
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

  test('prefills the course name with the picked folder basename', async () => {
    const { app, page } = bandal
    await stubFolderPicker(app, linkedFolder)
    await openFolderDialog(page)

    const dialog = page.getByRole('dialog', { name: '폴더에서 추가' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('이름')).toHaveValue(basename(linkedFolder))
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toBeHidden()
  })

  test('adds an existing folder as a course and lists its files', async () => {
    const { app, page, dataRoot } = bandal
    await addCourseFromFolder(app, page, linkedFolder, '알고리즘 (폴더)')

    // The linked course is selected and its own files show in the 자료 rail.
    await expect(page.locator('.material-row', { hasText: 'week1' })).toBeVisible({
      timeout: 30_000
    })

    // Linking creates nothing under the data root — still just the managed
    // course folder from the previous test.
    const folders = readdirSync(dataRoot, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory()
    )
    expect(folders.length).toBe(1)
  })

  test('focuses the existing course instead of registering a folder twice', async () => {
    const { app, page } = bandal
    const rowCount = await page.locator('.course-row').count()

    await stubFolderPicker(app, linkedFolder)
    await openFolderDialog(page)
    const dialog = page.getByRole('dialog', { name: '폴더에서 추가' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('이름').fill('중복 시도')
    await dialog.getByRole('button', { name: '과목으로 추가' }).click()
    await expect(dialog).toBeHidden()

    // No second row; the already-registered course stays selected.
    await expect(page.locator('.course-row')).toHaveCount(rowCount)
    await expect(
      page.locator('.course-row__name', { hasText: '중복 시도' })
    ).toHaveCount(0)
    await expect(
      page.locator('.course-row[data-selected="true"] .course-row__name')
    ).toHaveText('알고리즘 (폴더)')
  })

  test('opens the study board from the left rail bottom nav', async () => {
    const { page } = bandal
    const boardNav = page.locator('aside.app-rail--left .rail-nav__item', {
      hasText: '보드'
    })

    // [M7] The board entry point moved out of the titlebar into the rail.
    await expect(page.locator('.app-titlebar').getByText('보드')).toHaveCount(0)
    await expect(boardNav).toBeVisible()
    await expect(boardNav).toHaveAttribute('aria-pressed', 'false')

    await boardNav.click()
    await expect(page.locator('.board-overlay')).toBeVisible()
    await expect(boardNav).toHaveAttribute('aria-pressed', 'true')

    // Escape closes the overlay and releases the active state.
    await page.keyboard.press('Escape')
    await expect(page.locator('.board-overlay')).toBeHidden()
    await expect(boardNav).toHaveAttribute('aria-pressed', 'false')
  })
})
