/**
 * The AI reads `.bandal/COURSE.md` for everything that lives only in SQLite.
 * Whiteboards had no section at all, so a student's boards — and the PDF
 * pages pinned on them — were invisible to it.
 */

import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

test('the dossier tells the AI about whiteboards and citations', async () => {
  const bandal: BandalApp = await launchBandal()
  const { page } = bandal
  await createCourse(page, '고체역학')
  const courseDir = join(
    bandal.dataRoot,
    readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)[0]!
  )

  await page.evaluate(async () => {
    const api = (window as unknown as { bandal: { invoke: Function } }).bandal
    const courses = await api.invoke('courses:list', {})
    const courseId = courses[0].id
    const board = await api.invoke('canvas:create', { courseId })
    await api.invoke('canvas:rename', { id: board.id, title: '중간고사 정리' })
    await api.invoke('canvas:putShape', {
      boardId: board.id,
      id: 'clip-1',
      shape: {
        kind: 'clip',
        data: {
          box: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 },
          clip: { relPath: '3주차.pdf', page: 5, label: '3주차.pdf · 5쪽' }
        },
        style: { color: 'ink', width: 0.004, opacity: 1 }
      }
    })
    await api.invoke('context:rebuild', { courseId })
  })

  const dossier = readFileSync(join(courseDir, '.bandal', 'COURSE.md'), 'utf8')
  expect(dossier).toContain('## 화이트보드')
  expect(dossier).toContain('중간고사 정리')

  await bandal.close()
})
