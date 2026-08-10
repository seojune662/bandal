import { expect, test } from '@playwright/test'
import { createCanvas } from 'canvas'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createCourse,
  launchBandal,
  type BandalApp
} from '../../../e2e/helpers/launch'

const IMAGE_NAME = 'image-tab-check.png'

function makeTestPng(): Buffer {
  const canvas = createCanvas(960, 540)
  const context = canvas.getContext('2d')

  context.fillStyle = '#182231'
  context.fillRect(0, 0, 960, 540)
  context.fillStyle = '#32c7d9'
  context.fillRect(60, 60, 840, 140)
  context.fillStyle = '#f3c95b'
  context.fillRect(60, 220, 400, 260)
  context.fillStyle = '#e46b8c'
  context.fillRect(480, 220, 420, 260)
  context.fillStyle = '#182231'
  context.font = 'bold 46px sans-serif'
  context.fillText('BANDAL IMAGE TAB', 230, 150)

  return canvas.toBuffer('image/png')
}

test('opens a PNG material in one tab and renders its pixels', async () => {
  let bandal: BandalApp | null = null
  try {
    bandal = await launchBandal()
    const { page } = bandal
    await createCourse(page, '이미지 과목')

    const courseFolder = readdirSync(bandal.dataRoot, { withFileTypes: true }).find(
      (entry) => entry.isDirectory()
    )
    expect(courseFolder).toBeDefined()
    writeFileSync(
      join(bandal.dataRoot, courseFolder!.name, IMAGE_NAME),
      makeTestPng()
    )

    const imageRow = page.locator('.material-row[data-kind="image"]', {
      hasText: IMAGE_NAME
    })
    await expect(async () => {
      if (!(await imageRow.isVisible())) {
        await page.getByRole('button', { name: '자료 새로고침' }).click()
      }
      await expect(imageRow).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })

    await imageRow.click()
    await imageRow.click()

    const imageTabs = page.locator('.workspace-tab__title', {
      hasText: IMAGE_NAME
    })
    await expect(imageTabs).toHaveCount(1)

    const image = page.locator('.image-viewer__image')
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const node = element as HTMLImageElement
          return node.complete ? [node.naturalWidth, node.naturalHeight] : [0, 0]
        })
      )
      .toEqual([960, 540])

    await page.getByRole('button', { name: '100% 원본' }).click()
    await expect(page.locator('.image-viewer__zoom')).toHaveText('100%')
    const renderedWidth = await image.evaluate((element) =>
      Math.round(element.getBoundingClientRect().width)
    )
    expect(renderedWidth).toBe(960)

    await page.getByRole('button', { name: '창에 맞추기' }).click()
    await expect(page.locator('.image-viewer__zoom')).toHaveText('창 맞춤')
    await expect(page.getByRole('button', { name: '축소' })).toBeVisible()
    await expect(page.getByRole('button', { name: '확대' })).toBeVisible()

    const screenshotDir = resolve(__dirname, '__screenshots__')
    mkdirSync(screenshotDir, { recursive: true })
    await page.screenshot({
      path: join(screenshotDir, 'image-tab.png'),
      animations: 'disabled'
    })
  } finally {
    await bandal?.close()
  }
})
