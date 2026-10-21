import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { launchBandal, createCourse } from './helpers/launch'

test('first login blocks workspace IPC while leaving full backup available', async () => {
  const bandal = await launchBandal({ authenticatedProfile: false })
  try {
    await expect(bandal.page.getByRole('heading', { name: '반달에 로그인' })).toBeVisible()
    if (process.env['BANDAL_E2E_EXECUTABLE']) {
      // Release installers must carry both login settings. Local development
      // can still exercise the backup gate without provider credentials.
      const phase = await bandal.page.evaluate(async () => (await window.bandal.invoke('auth:getState', {})).phase)
      expect(phase).not.toBe('unconfigured')
    }
    await expect(bandal.page.getByRole('button', { name: '로그인 전 자료 백업·내보내기' })).toBeVisible()
    await expect(bandal.page.locator('aside.app-rail--left')).toHaveCount(0)
    const error = await bandal.page.evaluate(async () => {
      try { await window.bandal.invoke('courses:list', {}); return null } catch (error) { return String(error) }
    })
    expect(error).toContain('login-required')
  } finally { await bandal.close() }
})

test('offline verified profile creates a ruled PDF note and edits its pages', async ({}, testInfo) => {
  const bandal = await launchBandal()
  // The test-runner trace does not include a separately launched Electron
  // context. Keep its real DOM/screenshots and bounded process output so an
  // unchanged page count distinguishes a missed click, rejected save and stale
  // viewer. This observes the production path without replacing its IPC.
  const diagnostics: Array<{ at: number; source: string; value: unknown }> = []
  const startedAt = Date.now()
  let outputBytes = 0
  const record = (source: string, value: unknown): void => {
    const size = Buffer.byteLength(JSON.stringify(value) ?? '')
    if (outputBytes + size > 2 * 1024 * 1024) return
    outputBytes += size
    diagnostics.push({ at: Date.now() - startedAt, source, value })
  }
  bandal.app.process().stdout?.on('data', chunk => record('stdout', String(chunk)))
  bandal.app.process().stderr?.on('data', chunk => record('stderr', String(chunk)))
  bandal.page.on('console', message => record(`console:${message.type()}`, message.text()))
  bandal.page.on('pageerror', error => record('pageerror', error.stack ?? error.message))
  await bandal.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
  let courseId: string | undefined
  let failed = false
  const capture = async (phase: string): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pending = bandal.page.evaluate(async ({ courseId, phase }) => {
        const node = document.querySelector('.pdf-pages')
        const state: Record<string, unknown> = {
          phase, header: node?.querySelector('.pdf-preview__header')?.textContent,
          busy: node?.getAttribute('data-busy'), error: node?.querySelector('.pdf-pages__error')?.textContent,
          renderedPages: [...document.querySelectorAll('.pdf-page[data-pdf-page]')].map(page => page.getAttribute('data-pdf-page')),
          uiEvents: (window as unknown as { notePageDiagnostics?: unknown[] }).notePageDiagnostics
        }
        if (courseId) {
          try { state.info = await window.bandal.invoke('pdfNotes:info', { courseId, relPath: '노트/공통 필기 노트.pdf' }) }
          catch (error) { state.infoError = String(error) }
        }
        return state
      }, { courseId, phase })
      const state = await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Diagnostic state capture exceeded 3 seconds')), 3000)
      })])
      record('state', state)
    } catch (error) { record('capture-error', String(error)) }
    finally { if (timer) clearTimeout(timer) }
  }
  try {
    const page = bandal.page
    await page.evaluate(() => {
      const diagnostics: unknown[] = []
      ;(window as unknown as { notePageDiagnostics: unknown[] }).notePageDiagnostics = diagnostics
      const record = (event: string, detail?: unknown) => {
        if (diagnostics.length >= 200) return
        const panel = document.querySelector('.pdf-pages')
        const button = panel?.querySelector('.pdf-pages__add')?.getBoundingClientRect()
        diagnostics.push({ at: performance.now(), event, detail, button: button?.toJSON(), busy: panel?.getAttribute('data-busy'),
          header: panel?.querySelector('.pdf-preview__header')?.textContent,
          error: panel?.querySelector('.pdf-pages__error')?.textContent })
      }
      for (const event of ['pointerdown', 'pointerup', 'click']) document.addEventListener(event, e => {
        if ((e.target as Element | null)?.closest('.pdf-pages__add')) record(event, {
          x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY,
          isTrusted: e.isTrusted, defaultPrevented: e.defaultPrevented, phase: 'capture'
        })
      }, true)
      document.addEventListener('click', event => {
        if ((event.target as Element | null)?.closest('.pdf-pages__add')) record('click', {
          x: event.clientX, y: event.clientY, isTrusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented, phase: 'bubble'
        })
      })
      new MutationObserver(mutations => {
        if (mutations.some(mutation => (mutation.target instanceof Element ? mutation.target : mutation.target.parentElement)?.closest('.pdf-pages'))) record('panel-mutation')
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-busy', 'disabled'] })
    })
    await createCourse(page, '노트 통합 검증')
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    const menu = page.getByRole('dialog', { name: '새 탭 열기' })
    await expect(menu).toBeVisible()
    await expect(menu.locator('.new-tab-menu__label')).toHaveText(['브라우저', '마크다운', '노트', 'AI', '녹음'])
    await menu.getByRole('option', { name: /^노트(?:\s|$)/ }).click()
    const sheet = page.getByRole('dialog', { name: '새 노트', exact: true })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('input[value="lines"]')).toBeChecked()
    await sheet.getByLabel('제목').fill('공통 필기 노트')
    await sheet.getByRole('button', { name: '만들기', exact: true }).click()
    await expect(page.locator('.pdf-page[data-pdf-page="1"]')).toBeVisible({ timeout: 30000 })
    courseId = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!.id)
    const info = await page.evaluate(async id => window.bandal.invoke('pdfNotes:info', { courseId: id, relPath: '노트/공통 필기 노트.pdf' }), courseId)
    expect(info).toMatchObject({ paper: 'lines', orientation: 'portrait', surface: 'light' })
    record('initial-note-info', info)
    const toggle = page.getByRole('button', { name: /미리보기|페이지 목록|페이지 패널/ }).first()
    await toggle.click()
    await page.getByRole('button', { name: '+ 페이지 추가', exact: true }).click()
    await expect(page.locator('.pdf-preview__header')).toContainText('2쪽')
    await page.getByRole('button', { name: '2쪽 메뉴', exact: true }).click()
    await page.getByRole('menuitem', { name: '복제', exact: true }).click()
    await expect(page.locator('.pdf-preview__header')).toContainText('3쪽')
    await page.screenshot({ path: testInfo.outputPath('notes-pages.png') })
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="tabs"]').click()
    await expect(page.getByRole('tablist', { name: '탭 종류', exact: true }).getByRole('tab')).toHaveText(['브라우저', '마크다운', '노트', 'AI', '녹음'])
  } catch (error) {
    failed = true
    throw error
  } finally {
    // Read only this disposable test profile. Exact file bytes distinguish a
    // completed restructure from the old viewer, even if renderer IPC rejects.
    await capture(failed ? 'failure' : 'complete')
    let performanceTimer: ReturnType<typeof setTimeout> | undefined
    try {
      record('completed-ipc', await Promise.race([
        bandal.app.evaluate(() => {
          const metrics = (globalThis as typeof globalThis & { __bandalPerformance?: { ipc: Record<string, unknown> } }).__bandalPerformance?.ipc ?? {}
          return Object.fromEntries(Object.entries(metrics).filter(([channel]) => /^(pdf:|pdfNotes:|annotations:|drawings:)/.test(channel)))
        }),
        new Promise<never>((_, reject) => { performanceTimer = setTimeout(() => reject(new Error('Diagnostic main-process capture exceeded 3 seconds')), 3000) })
      ]))
    } catch (error) { record('main-capture-error', String(error)) }
    finally { if (performanceTimer) clearTimeout(performanceTimer) }
    try {
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name)
          if (entry.isDirectory()) await visit(path)
          else if (entry.name.normalize('NFC') === '공통 필기 노트.pdf') {
            const bytes = await readFile(path)
            record('pdf-file', { path: relative(bandal.dataRoot, path), byteCount: bytes.length,
              revision: createHash('sha256').update(bytes).digest('hex'), pages: (await PDFDocument.load(bytes)).getPageCount() })
          }
        }
      }
      await visit(bandal.dataRoot)
    } catch (error) { record('file-capture-error', String(error)) }
    await bandal.app.context().tracing.stop({ path: testInfo.outputPath('electron-trace.zip') }).catch(error => record('trace-error', String(error)))
    const diagnosticsPath = testInfo.outputPath('note-page-diagnostics.json')
    await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2))
    await testInfo.attach('note-page-diagnostics', { path: diagnosticsPath, contentType: 'application/json' })
    await bandal.close()
  }
})

test('an open old PDF revision retains late ink and recovers it without sync consent', async ({}, testInfo) => {
  const bandal = await launchBandal()
  try {
    const page = bandal.page
    await createCourse(page, '페이지 충돌 검증')
    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await page.getByRole('dialog', { name: '새 탭 열기' }).getByRole('option', { name: /^노트(?:\s|$)/ }).click()
    const sheet = page.getByRole('dialog', { name: '새 노트', exact: true })
    await sheet.getByLabel('제목').fill('페이지 보존')
    await sheet.getByRole('button', { name: '만들기', exact: true }).click()
    await expect(page.locator('.pdf-page[data-pdf-page="1"]')).toBeVisible({ timeout: 30000 })
    const original = await page.evaluate(async () => {
      const courseId = (await window.bandal.invoke('courses:list', {}))[0]!.id
      const relPath = '노트/페이지 보존.pdf'
      const info = await window.bandal.invoke('pdfNotes:info', { courseId, relPath })
      await window.bandal.invoke('drawings:create', { courseId, relPath, documentRevision: info.documentRevision, page: 1,
        kind: 'ink', data: { points: [{ x: .1, y: .2, p: .5 }, { x: .5, y: .4, p: .5 }] },
        style: { color: 'blue', width: .004, opacity: 1 } })
      await window.bandal.invoke('pdf:restructure', { courseId, relPath, expectedRevision: info.documentRevision,
        pages: [{ source: null }, { source: 1 }] })
      return { courseId, relPath, documentRevision: info.documentRevision }
    })
    await expect(page.getByRole('button', { name: '변경된 페이지 열기', exact: true })).toBeVisible()
    const retained = await page.evaluate(async original => {
      let readError = '', writeError = ''
      try { await window.bandal.invoke('drawings:listForFile', original) } catch (error) { readError = String(error) }
      try {
        await window.bandal.invoke('drawings:create', { ...original, page: 1, kind: 'ink',
          data: { points: [{ x: .2, y: .1, p: .5 }, { x: .7, y: .4, p: .5 }] },
          style: { color: 'red', width: .004, opacity: 1 } })
      } catch (error) { writeError = String(error) }
      const current = await window.bandal.invoke('drawings:listForFile', { courseId: original.courseId, relPath: original.relPath })
      const sync = await window.bandal.invoke('runtime:syncState', {})
      return { readError, writeError, current, sync }
    }, original)
    expect(retained.readError).not.toBe('')
    expect(retained.writeError).toContain('복구함에 보관했습니다')
    expect(retained.current).toHaveLength(1)
    expect(retained.current[0]?.page).toBe(2)
    expect(retained.sync).toMatchObject({ enabled: false, conflicts: 1 })
    const pending = await page.evaluate(() => window.bandal.invoke('runtime:syncConflicts', {}))
    expect(pending).toHaveLength(1)
    await page.getByRole('button', { name: '변경된 페이지 열기', exact: true }).click()
    await expect(page.getByRole('button', { name: '변경된 페이지 열기', exact: true })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+,')
    await page.locator('.settings-nav [data-category="account"]').click()
    await expect(page.getByText('페이지 변경 전 필기 보관됨', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('offline-recovery.png') })
    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: '이전 필기로 복구 노트 만들기', exact: true }).click()
    await expect(page.getByText('페이지 변경 전 필기 보관됨', { exact: true })).toHaveCount(0)
    const result = await page.evaluate(async original => {
      const current = await window.bandal.invoke('drawings:listForFile', { courseId: original.courseId, relPath: original.relPath })
      const tree = await window.bandal.invoke('materials:tree', { courseId: original.courseId })
      return { current, tree, conflicts: await window.bandal.invoke('runtime:syncConflicts', {}) }
    }, original)
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.page).toBe(2)
    expect(JSON.stringify(result.tree)).toContain('필기 복구')
    expect(result.conflicts).toHaveLength(0)
  } finally { await bandal.close() }
})
