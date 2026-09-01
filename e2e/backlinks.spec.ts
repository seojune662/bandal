/**
 * "이 자료를 인용한 곳" — the reverse of a note's `bandal://material?…` link.
 *
 * Those hrefs live in markdown text, not in a table, so the reverse direction
 * never existed. This walks the whole path a student takes: highlight a PDF,
 * send it to a note, and expect the PDF to know it is cited.
 */

import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test.describe('backlinks', () => {
  let bandal: BandalApp
  let courseId: string

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '고체역학')
    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const courseDir = join(bandal.dataRoot, folders[0]!)

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage([595, 842]).drawText('Stress', { x: 64, y: 720, size: 28, font })
    // Korean name on purpose: NFC/NFD mismatches have broken path matching here before.
    writeFileSync(join(courseDir, '3주차 강의.pdf'), await pdf.save())

    courseId = await bandal.page.evaluate(async () => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      const courses = await api.invoke('courses:list', {})
      return courses[0].id
    })
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('a note that quotes a page shows up on that PDF', async () => {
    const { page } = bandal

    // Send a highlight to a note through the real service, then ask for backlinks.
    const result = await page.evaluate(async (id: string) => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      const annotation = await api.invoke('annotations:create', {
        courseId: id,
        relPath: '3주차 강의.pdf',
        page: 2,
        color: 'yellow',
        rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }],
        anchor: { quote: '수직응력은', prefix: '', suffix: '' }
      })
      await api.invoke('link:sendHighlightToNote', {
        courseId: id,
        relPath: '3주차 강의.pdf',
        page: 2,
        quote: '수직응력은',
        comment: null,
        annotationId: annotation.id
      })
      return api.invoke('links:forMaterial', {
        courseId: id,
        relPath: '3주차 강의.pdf'
      })
    }, courseId)

    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].page).toBe(2)
    // The label has to be readable — this is what the student clicks.
    expect(result.notes[0].label).toContain('학습노트')
  })

  test('a whiteboard clip counts as a citation too', async () => {
    const { page } = bandal
    const result = await page.evaluate(async (id: string) => {
      const api = (window as unknown as { bandal: { invoke: Function } }).bandal
      const board = await api.invoke('canvas:create', { courseId: id })
      await api.invoke('canvas:putShape', {
        boardId: board.id,
        id: 'clip-1',
        shape: {
          kind: 'clip',
          data: {
            box: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 },
            clip: { relPath: '3주차 강의.pdf', page: 5, label: '3주차 강의.pdf · 5쪽' }
          },
          style: { color: 'ink', width: 0.004, opacity: 1 }
        }
      })
      return api.invoke('links:forMaterial', {
        courseId: id,
        relPath: '3주차 강의.pdf'
      })
    }, courseId)

    expect(result.boards).toHaveLength(1)
    expect(result.boards[0].page).toBe(5)
  })

  test('the connections chip shows the citations to the student', async () => {
    const { page } = bandal
    await page.locator('.material-row', { hasText: '3주차 강의' }).click()
    await expect(page.locator('.pdf-page').first()).toBeVisible({ timeout: 30_000 })

    // 연결/인용 UI 는 탭 상단 공통 연결 칩(MaterialSequenceWrapper)으로
    // 이동했다 — 어떤 자료 종류를 열어도 같은 자리에서 보인다.
    const chip = page.locator('.sequence-nav__chip')
    await expect(chip).toBeVisible({ timeout: 15_000 })
    await chip.click()

    const panel = page.locator('.sequence-connections-panel')
    await expect(panel).toBeVisible()
    await expect(
      panel.getByText('이 자료를 인용한 곳', { exact: false })
    ).toBeVisible({ timeout: 15_000 })
    // Both citation kinds, with the page they point at — a label-less icon row
    // would be unfindable, which this app has already been burned by.
    await expect(
      panel.getByRole('button', { name: '고체역학 학습노트.md 2쪽' })
    ).toBeVisible()
    await expect(
      panel.getByRole('button', { name: '화이트보드 1 5쪽' })
    ).toBeVisible()
  })
})
