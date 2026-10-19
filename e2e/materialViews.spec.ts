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
    await expect(page.locator('.material-tree [data-material-path="과제.pdf"]')).toBeVisible()
  } finally {
    await bandal.close()
  }
})
