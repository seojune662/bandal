import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

// Same fixture also runs against the pre-redesign entry via BANDAL_E2E_ENTRY.
test('records startup, tab, sidebar and PDF interaction costs on fresh profiles', async ({}, info) => {
  const launches: number[] = []
  const reads: number[] = []
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now()
    const bandal = await launchBandal()
    try {
      launches.push(performance.now() - start)
      await expect(bandal.page.locator('.empty-state--courses')).toBeVisible()
      reads.push(
        await bandal.app.evaluate(
          () =>
            (globalThis as any).__bandalPerformance.ipc['settings:get']
              ?.count ?? 0
        )
      )
      if (sample < 4) continue
      const { page } = bandal
      await bandal.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900)
      )
      await createCourse(page, '성능 검사')
      const [course] = await page.evaluate(() =>
        window.bandal.invoke('courses:list', {})
      )
      const pdf = await PDFDocument.create()
      for (let i = 0; i < 100; i++)
        pdf.addPage([720, 540]).drawText(`Page ${i + 1}`)
      writeFileSync(join(course!.folderPath, 'pages.pdf'), await pdf.save())
      writeFileSync(
        join(course!.folderPath, 'note.md'),
        '# Performance fixture\n'
      )
      await page.getByRole('button', { name: '자료 새로고침' }).click()
      await page.locator('[data-material-path="note.md"]').click()
      await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()
      await page.locator('[data-material-path="pages.pdf"]').click()
      await expect(
        page.locator('.react-pdf__Page canvas').first()
      ).toBeVisible()
      const interaction = await page.evaluate(async () => {
        const measure = async (action: (i: number) => void, count: number) => {
          const values: number[] = []
          for (let i = 0; i < count; i++) {
            const start = performance.now()
            action(i)
            await new Promise(requestAnimationFrame)
            await new Promise(requestAnimationFrame)
            values.push(performance.now() - start)
          }
          values.sort((a, b) => a - b)
          return {
            p95: values[Math.ceil(values.length * 0.95) - 1],
            max: values.at(-1)
          }
        }
        const tabs = [
          ...document.querySelectorAll<HTMLElement>('.workspace-tab__title')
        ]
        const tab = await measure((i) => tabs[i % 2]!.click(), 30)
        const sidebar = await measure(
          () =>
            document
              .querySelector<HTMLButtonElement>(
                '[aria-label="과목 사이드바 접기"], [aria-label="과목 사이드바 펼치기"]'
              )!
              .click(),
          30
        )
        const scroller = document.querySelector<HTMLElement>('.pdf-scroller')!
        const scroll = await measure((i) => {
          scroller.scrollTop = i * 180
        }, 60)
        return { tab, sidebar, scroll }
      })
      await page.requestGC()
      const heapMB = await page.evaluate(
        () => (performance as any).memory.usedJSHeapSize / 1024 / 1024
      )
      const report = {
        launches,
        medianStartupMs: [...launches].sort((a, b) => a - b)[2],
        settingsReads: reads,
        ...interaction,
        heapMB
      }
      console.log('UI performance:', JSON.stringify(report))
      const file =
        process.env['BANDAL_UI_BENCHMARK'] ??
        info.outputPath('performance.json')
      writeFileSync(file, JSON.stringify(report, null, 2))
      await info.attach('performance', {
        path: file,
        contentType: 'application/json'
      })
      expect(interaction.tab.p95!).toBeLessThan(150)
      expect(interaction.sidebar.p95!).toBeLessThan(150)
      expect(interaction.scroll.p95!).toBeLessThan(150)
    } finally {
      await bandal.close()
    }
  }
})
