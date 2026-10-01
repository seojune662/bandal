import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument } from 'pdf-lib'
import { createCourse, launchBandal } from './helpers/launch'

test('cold material scan yields to the main loop and persists an immediate snapshot', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { app, page } = bandal
    const course = await page.evaluate(() => window.bandal.invoke('courses:create', { name: '대용량 자료', color: 'blue' }))
    for (let d = 0; d < 100; d++) {
      const dir = join(course.folderPath, `folder-${d}`)
      mkdirSync(dir)
      for (let f = 0; f < 100; f++) writeFileSync(join(dir, `note-${f}.md`), '# Test\n')
    }
    await page.evaluate(id => window.bandal.invoke('materials:createFolder', { courseId: id, dirRelPath: '', name: 'invalidate' }), course.id)
    await app.evaluate(async () => {
      const { Session } = (process as any).getBuiltinModule('inspector')
      const session = new Session()
      session.connect()
      const post = (method: string): Promise<any> => new Promise((resolve, reject) => session.post(method, (error: Error | null, result: unknown) => error ? reject(error) : resolve(result)))
      await post('Profiler.enable')
      await post('Profiler.start')
      ;(globalThis as any).__courseCpu = { session, post }
      const sample = { last: performance.now(), max: 0, timer: undefined as ReturnType<typeof setInterval> | undefined }
      sample.timer = setInterval(() => { const now = performance.now(); sample.max = Math.max(sample.max, now - sample.last - 10); sample.last = now }, 10)
      ;(globalThis as any).__courseTiming = sample
    })
    const scan = await page.evaluate(async id => {
      const start = performance.now()
      const tree = await window.bandal.invoke('materials:tree', { courseId: id })
      return { ms: performance.now() - start, roots: tree.length }
    }, course.id)
    const mainDelayMs = await app.evaluate(() => {
      const sample = (globalThis as any).__courseTiming
      clearInterval(sample.timer)
      return sample.max as number
    })
    const profile = await app.evaluate(async () => {
      const { session, post } = (globalThis as any).__courseCpu
      const { profile } = await post('Profiler.stop')
      session.disconnect()
      delete (globalThis as any).__courseCpu
      return profile
    })
    await info.attach('main-process.cpuprofile', { body: JSON.stringify(profile), contentType: 'application/json' })
    const sampleTime = new Map<number, number>()
    for (let i = 0; i < profile.samples.length; i++) sampleTime.set(profile.samples[i], (sampleTime.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i])
    const hotFunctions = profile.nodes.map((node: any) => ({ name: node.callFrame.functionName, url: node.callFrame.url, line: node.callFrame.lineNumber, ms: (sampleTime.get(node.id) ?? 0) / 1000 })).sort((a: any, b: any) => b.ms - a.ms).slice(0, 15)
    console.log('Main CPU samples:', hotFunctions)
    const snapshot = await page.evaluate(async id => {
      const start = performance.now()
      const result = await window.bandal.invoke('materials:snapshot', { courseId: id })
      return { ms: performance.now() - start, roots: result.tree?.length }
    }, course.id)
    const mainWork = await app.evaluate(() => (globalThis as any).__bandalPerformance.work)
    await info.attach('cold-course-timing', { body: JSON.stringify({ scan, mainDelayMs, snapshot, mainWork }), contentType: 'application/json' })
    console.log('Cold course timing:', { scan, mainDelayMs, snapshot, mainWork })
    expect(scan.roots).toBe(101)
    expect(snapshot.roots).toBe(101)
    expect(mainDelayMs).toBeLessThan(200)
    expect(snapshot.ms).toBeLessThan(200)
  } finally { await bandal.close() }
})

test('100 course switches retain the visible PDF and evict only older workspaces', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '물리학')
    const [course] = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 100; i++) pdf.addPage([720, 540]).drawText(`Page ${i + 1}`)
    writeFileSync(join(course!.folderPath, 'pages.pdf'), await pdf.save())
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="pages.pdf"]').click()
    const canvas = page.locator('.react-pdf__Page canvas').first()
    await expect(canvas).toBeVisible()
    await canvas.evaluate(el => el.setAttribute('data-retained-proof', 'original'))
    await createCourse(page, '수학')
    await page.locator('.course-row__name', { hasText: /^물리학$/ }).click()
    await expect(page.locator('[data-retained-proof="original"]')).toBeVisible()
    await page.requestGC()
    const beforeHeap = await page.evaluate(() => (performance as any).memory.usedJSHeapSize as number)
    const timings = await page.evaluate(async () => {
      const samples: number[] = []
      const original = document.querySelector('[data-retained-proof]')
      const viewer = original?.closest('.pdf-tab')
      const missing: unknown[] = []
      for (let i = 0; i < 100; i++) {
        const name = i % 2 ? '물리학' : '수학'
        const row = [...document.querySelectorAll<HTMLElement>('.course-row__name')].find(node => node.textContent === name)!
        const start = performance.now()
        row.click()
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        samples.push(performance.now() - start)
        if (i % 2 && !original?.isConnected && missing.length < 3) missing.push({ i, viewerConnected: viewer?.isConnected, scroll: viewer?.querySelector('.pdf-scroller')?.scrollTop, pages: [...(viewer?.querySelectorAll('.react-pdf__Page') ?? [])].map(el => el.getAttribute('data-page-number')) })
      }
      samples.sort((a, b) => a - b)
      return { p95: samples[95], max: samples.at(-1), missing }
    })
    await page.requestGC()
    const afterHeap = await page.evaluate(() => (performance as any).memory.usedJSHeapSize as number)
    expect(afterHeap - beforeHeap).toBeLessThan(32 * 1024 * 1024)
    await info.attach('warm-course-memory', { body: JSON.stringify({ beforeHeap, afterHeap }), contentType: 'application/json' })
    await info.attach('warm-course-timing', { body: JSON.stringify(timings), contentType: 'application/json' })
    console.log('Warm course timing:', { ...timings, beforeHeap, afterHeap, heapGrowthMB: (afterHeap - beforeHeap) / 1024 / 1024 })
    expect(timings.p95).toBeLessThan(150)
    expect(timings.missing).toEqual([])
    await expect(page.locator('[data-retained-proof="original"]')).toBeVisible()
    await expect(page.locator('[data-workspace-course]')).toHaveCount(2)
    await createCourse(page, '화학')
    await createCourse(page, '생물학')
    await expect(page.locator('[data-workspace-course]')).toHaveCount(3)
    await expect(page.locator('[data-retained-proof="original"]')).toHaveCount(1)
    await page.locator('.course-row__name', { hasText: /^물리학$/ }).click()
    await expect(page.locator('[data-retained-proof="original"]')).toBeVisible()
  } finally { await bandal.close() }
})

test('restoring 50 tabs reads only the selected note', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '복원 검사')
    const [course] = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    for (let i = 0; i < 50; i++) writeFileSync(join(course!.folderPath, `note-${i}.md`), `# note-${i}\n\n내용 ${i}\n`)
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="note-0.md"]').click()
    await expect(page.locator('.milkdown .ProseMirror')).toBeVisible()
    for (let i = 1; i < 50; i++) await page.locator(`[data-material-path="note-${i}.md"]`).click()
    await expect(page.locator('.milkdown .ProseMirror:visible')).toContainText('내용 49')
    await expect.poll(async () => {
      const { layout } = await page.evaluate(id => window.bandal.invoke('layout:get', { courseId: id }), course!.id)
      return Object.keys((layout as any)?.panels ?? {}).length
    }).toBe(50)
    const readsBefore = await bandal.app.evaluate(() => (globalThis as any).__bandalPerformance.ipc['notes:read']?.count ?? 0)
    await page.reload()
    await expect(page.locator('.workspace-tab__title')).toHaveCount(50)
    await expect(page.locator('.milkdown .ProseMirror')).toContainText('내용 49')
    const readsAfter = await bandal.app.evaluate(() => (globalThis as any).__bandalPerformance.ipc['notes:read']?.count ?? 0)
    expect(readsAfter - readsBefore).toBe(1)
  } finally { await bandal.close() }
})

test('a flat folder renders a bounded list and keyboard navigation reaches the last file', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '긴 자료 목록')
    const [course] = await page.evaluate(() => window.bandal.invoke('courses:list', {}))
    for (let i = 0; i < 1200; i++) writeFileSync(join(course!.folderPath, `note-${String(i).padStart(4, '0')}.md`), '# note\n')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    const first = page.locator('[data-material-path="note-0000.md"]')
    await expect(first).toBeVisible()
    expect(await page.locator('[data-material-row]').count()).toBeLessThan(100)
    await expect(page.locator('.material-tree')).toHaveAttribute('data-total-rows', '1200')
    await first.focus()
    await page.keyboard.press('End')
    await expect(page.locator('[data-material-path="note-1199.md"]')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
  } finally { await bandal.close() }
})

test('PDF search uses the background cache without writing the user database', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    const course = await page.evaluate(() => window.bandal.invoke('courses:create', { name: '검색 캐시', color: 'blue' }))
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText('Isolated cache')
    writeFileSync(join(course.folderPath, 'search.pdf'), await pdf.save())
    await page.evaluate(id => window.bandal.invoke('search:indexPdfPages', {
      courseId: id, relPath: 'search.pdf', pages: [{ page: 1, text: '백그라운드검색검증' }]
    }), course.id)
    const result = await page.evaluate(id => window.bandal.invoke('search:query', { courseId: id, query: '검색검증' }), course.id)
    expect(result.hits).toEqual(expect.arrayContaining([expect.objectContaining({ relPath: 'search.pdf', page: 1 })]))
    const Sqlite = createRequire(__filename)('better-sqlite3-node') as typeof import('better-sqlite3')
    const db = new Sqlite(join(bandal.userDataDir, 'bandal.db'), { readonly: true })
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'course_content_fts'").get()).toBeUndefined()
    } finally { db.close() }
  } finally { await bandal.close() }
})
