import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

async function chooseView(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '자료 보기 방식', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}

test('material views preview documents, navigate folders and persist the chosen layout', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '자료 보기 과목')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    mkdirSync(join(course.folderPath, '강의'), { recursive: true })
    writeFileSync(join(course.folderPath, '강의', '요약.md'), '# Folder preview\n\nStudy material.\n')
    copyFileSync(resolve(__dirname, '..', 'resources', 'icon.png'), join(course.folderPath, '참고.png'))
    const pdf = await PDFDocument.create()
    pdf.addPage([300, 400]).drawText('Material view preview', { x: 24, y: 340, size: 18 })
    writeFileSync(join(course.folderPath, '과제.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await expect(page.locator('[data-material-path="과제.pdf"]')).toBeVisible()

    await chooseView(page, '아이콘')
    const icons = page.locator('.materials-browser[data-view="icons"]')
    await expect(icons).toBeVisible()
    await expect(icons.locator('[data-material-path="과제.pdf"]')).toHaveAttribute('draggable', 'true')
    await expect(icons.locator('[data-material-path="과제.pdf"] img')).toBeVisible({ timeout: 30_000 })
    await icons.locator('[data-material-path="강의"]').click()
    await expect(icons.locator('[data-material-path="강의/요약.md"]')).toBeVisible()
    await page.getByRole('button', { name: '전체 자료', exact: true }).click()
    await info.attach('material-icons', { body: await page.screenshot({ path: info.outputPath('material-icons.png') }), contentType: 'image/png' })

    await chooseView(page, '열')
    const columns = page.locator('.materials-browser[data-view="columns"]')
    await columns.locator('[data-material-path="강의"]').click()
    await expect(columns.locator('[data-material-path="강의/요약.md"]')).toBeVisible()
    await expect(columns.locator('[data-material-path="강의"]')).toBeVisible()

    await chooseView(page, '갤러리')
    await page.getByRole('button', { name: '전체 자료', exact: true }).click()
    const gallery = page.locator('.materials-browser[data-view="gallery"]')
    await gallery.locator('[data-material-path="과제.pdf"]').click()
    await expect(gallery.locator('.materials-gallery-preview img')).toBeVisible({ timeout: 30_000 })
    await gallery.getByRole('button', { name: '자료 열기', exact: true }).click()
    await expect(page.locator('.pdf-page').first()).toBeVisible({ timeout: 30_000 })
    await info.attach('material-gallery', { body: await page.screenshot({ path: info.outputPath('material-gallery.png') }), contentType: 'image/png' })

    await page.reload()
    await expect(page.locator('.materials-browser[data-view="gallery"]')).toBeVisible()
    await chooseView(page, '목록')
    await expect(page.locator('.materials-items--list [data-material-path="과제.pdf"]')).toBeVisible()
  } finally {
    await bandal.close()
  }
})

test('readable library preserves folder and search while expanded and opens an unvisited PDF content match', async ({}, info) => {
  test.setTimeout(150_000)
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '넓게 보는 자료')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    mkdirSync(join(course.folderPath, 'Lectures', 'Empty'), { recursive: true })
    const pdf = await PDFDocument.create()
    for (let index = 1; index <= 205; index++) pdf.addPage([300, 400]).drawText(index === 205 ? 'quantum beyond two hundred pages' : `Lecture page ${index}`, { x: 24, y: 340, size: 12 })
    writeFileSync(join(course.folderPath, 'Lectures', 'lecture.pdf'), await pdf.save())
    writeFileSync(join(course.folderPath, 'outside.md'), '# Outside\n\nquantum outside the current folder\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="Lectures"]').click()
    await expect(page.locator('[data-material-path="Lectures/lecture.pdf"] .material-card-preview img')).toBeVisible({ timeout: 30_000 })
    await info.attach('readable-materials-sidebar', { body: await page.screenshot({ path: info.outputPath('readable-materials-sidebar.png') }), contentType: 'image/png' })
    await page.getByRole('button', { name: '자료 넓게 보기', exact: true }).click()
    const expanded = page.getByRole('dialog', { name: '자료 넓게 보기', exact: true })
    await expect(expanded).toBeVisible()
    const bounds = await expanded.boundingBox()
    expect(bounds!.width).toBeGreaterThan(700)
    expect(bounds!.width).toBeLessThanOrEqual(980)
    await info.attach('readable-materials-list', { body: await page.screenshot({ path: info.outputPath('readable-materials-list.png') }), contentType: 'image/png' })
    await page.getByRole('combobox', { name: '자료 정렬' }).selectOption('modified')
    await page.getByRole('searchbox', { name: '파일 검색' }).fill('quantum')
    const content = page.getByRole('region', { name: '본문 검색 결과' })
    await expect(content.locator('.materials-content-hit')).toHaveCount(1, { timeout: 60_000 })
    await expect(content).toContainText('205페이지')
    await expect(content).not.toContainText('outside.md')
    await page.getByRole('button', { name: '전체 자료에서 검색', exact: true }).click()
    await expect(content.locator('.materials-content-hit')).toHaveCount(2)
    await page.getByRole('button', { name: '현재 폴더', exact: true }).click()
    await expect(content.locator('.materials-content-hit')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(expanded).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: '파일 검색' })).toHaveValue('quantum')
    await expect(page.getByRole('combobox', { name: '자료 정렬' })).toHaveValue('modified')
    await page.getByRole('button', { name: '자료 넓게 보기', exact: true }).click()
    await info.attach('readable-materials-expanded', { body: await page.screenshot({ path: info.outputPath('readable-materials-expanded.png') }), contentType: 'image/png' })
    await content.locator('.materials-content-hit').click()
    await expect(expanded).toHaveCount(0)
    await expect(page.locator('.pdf-page[data-pdf-page="205"]')).toBeInViewport({ timeout: 30_000 })
    await page.getByRole('button', { name: '검색어 지우기' }).click()
    await expect(page.locator('[data-material-path="Lectures/lecture.pdf"]')).toBeVisible()
    await page.locator('[data-material-path="Lectures/Empty"]').click()
    await page.keyboard.press('Delete')
    await expect(page.locator('.material-delete-dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '생성하기', exact: true }).click()
    await page.getByRole('menuitem', { name: '새 마크다운', exact: true }).click()
    await expect(page.locator('[data-material-path^="Lectures/Empty/"]')).toBeVisible()
  } finally { await bandal.close() }
})

test('renaming a nested search result enters its folder and view changes never select an invisible folder for deletion', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '검색 결과 정리')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    mkdirSync(join(course.folderPath, 'Folder'), { recursive: true })
    writeFileSync(join(course.folderPath, 'Folder', 'rename-me.md'), '# Rename me\n\nBody\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.getByRole('searchbox', { name: '파일 검색' }).fill('rename-me')
    await page.locator('[data-material-path="Folder/rename-me.md"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'rename-me.md 이름 변경' })
    await expect(editor).toBeVisible()
    await editor.fill('renamed.md')
    await editor.press('Enter')
    await expect(page.locator('[data-material-path="Folder/renamed.md"]')).toBeVisible()
    await page.getByRole('button', { name: '상위 폴더로', exact: true }).click()
    await chooseView(page, '간단히')
    await page.locator('[data-material-path="Folder"]').click()
    await chooseView(page, '목록')
    await expect(page.locator('[data-material-path="Folder/renamed.md"]')).toBeVisible()
    await page.keyboard.press('Delete')
    await expect(page.locator('.material-delete-dialog')).toHaveCount(0)
    expect(await page.evaluate(async id => (await window.bandal.invoke('materials:tree', { courseId: id })).some(node => node.relPath === 'Folder'), course.id)).toBe(true)
  } finally { await bandal.close() }
})
