import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const selected = (page: Page, name: string): Locator => page.locator('.course-row[data-selected="true"]').filter({ hasText: name })
const folder = (page: Page, name: string): Locator => page.locator('.course-row').filter({ has: page.locator('.course-row__name', { hasText: new RegExp(`^${name}$`) }) })
const visibleTab = (page: Page, title: string): Locator => page.locator('.workspace-course:not([hidden]) .dv-tab').filter({ has: page.locator('.workspace-tab__title', { hasText: new RegExp(`^${title}$`) }) })

async function dragOverFolder(page: Page, tab: Locator, courseName: string): Promise<void> {
  await page.evaluate(() => {
    const trace: unknown[] = []; (window as any).__courseMoveTrace = trace
    for (const type of ['dragstart', 'dragend', 'dragover', 'drop', 'blur', 'mouseup']) window.addEventListener(type, event => {
      const target = event.target as Element
      if (type === 'dragover' && trace.filter((entry: any) => entry.type === 'dragover').length >= 15) return
      trace.push({ type, target: target.className, types: [...((event as DragEvent).dataTransfer?.types ?? [])], dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging'), ...(type === 'drop' ? { payload: (event as DragEvent).dataTransfer?.getData('application/x-bandal-tab') } : {}) })
      if (trace.length > 40) trace.shift()
      if (type === 'dragstart') queueMicrotask(() => trace.push({ type: 'dragstart-complete', prevented: event.defaultPrevented, types: [...((event as DragEvent).dataTransfer?.types ?? [])], dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging') }))
    }, true)
  })
  const source = (await tab.boundingBox())!, destination = (await folder(page, courseName).boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 4 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.mouse.move(destination.x + Math.min(80, destination.width / 2), destination.y + destination.height / 2, { steps: 14 })
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.mouse.move(destination.x + Math.min(80, destination.width / 2) + i % 2, destination.y + destination.height / 2)
  }
  try { await expect(selected(page, courseName)).toBeVisible() }
  catch (error) { throw new Error(`${String(error)}\n${JSON.stringify(await page.evaluate(({ x, y }) => ({ trace: (window as any).__courseMoveTrace, dragging: document.querySelector('.workspace-host')?.getAttribute('data-tab-dragging'), hit: document.elementFromPoint(x, y)?.outerHTML, rows: [...document.querySelectorAll('.course-row')].map(row => ({ name: row.textContent, hovered: row.getAttribute('data-tab-hover'), selected: row.getAttribute('data-selected') })) }), { x: destination.x + 81, y: destination.y + destination.height / 2 }))}`) }
  try { await expect(page.locator('.workspace-host')).toHaveAttribute('data-tab-dragging', 'true', { timeout: 1000 }) }
  catch (error) { throw new Error(`${String(error)}\n${JSON.stringify(await page.evaluate(() => (window as any).__courseMoveTrace))}`) }
}

async function dropInCanvas(page: Page, edge = false): Promise<void> {
  const bounds = (await page.locator('.workspace-course:not([hidden])').boundingBox())!
  await page.mouse.move(edge ? bounds.x + bounds.width - 8 : bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 16 })
  await page.mouse.move(edge ? bounds.x + bounds.width - 7 : bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2)
  await expect(page.locator('.course-tab-move-preview')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.workspace-host')).not.toHaveAttribute('data-tab-dragging')
}

async function courses(page: Page) {
  return page.evaluate(() => window.bandal.invoke('courses:list', {}))
}

async function persistedPanels(page: Page, sourceId: string, targetId: string) {
  return page.evaluate(async ({ sourceId, targetId }) => {
    const [source, target] = await Promise.all([window.bandal.invoke('layout:get', { courseId: sourceId }), window.bandal.invoke('layout:get', { courseId: targetId })])
    return [(source.layout as any)?.panels ?? {}, (target.layout as any)?.panels ?? {}]
  }, { sourceId, targetId })
}

test('real folder drag moves a live browser into an empty course without replacing its native page, then restores placement', async () => {
  const url = 'https://gemini.google.com/app/moving'
  let bandal = await launchBandal({ keepProfileOnClose: true })
  const installSite = async () => bandal.app.evaluate(({ session }) => {
    session.fromPartition('persist:browsing').protocol.handle('https', request => {
      if (new URL(request.url).hostname !== 'gemini.google.com') return new Response('Blocked fixture request', { status: 404 })
      return new Response('<title>Move browser fixture</title><input id="draft" value="initial"><a href="/app/next">Next</a>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    })
  })
  try {
    await installSite()
    let page = bandal.page
    await createCourse(page, '브라우저 출발'); await createCourse(page, '브라우저 도착')
    const all = await courses(page), source = all.find(course => course.name === '브라우저 출발')!, target = all.find(course => course.name === '브라우저 도착')!
    await folder(page, source.name).locator('.course-row__select').click()
    await bandal.app.evaluate(({ BrowserWindow }, input) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', input) }, { url, courseId: source.id })
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url && !contents.isLoading())?.id ?? null, url)).not.toBeNull()
    const nativeId = await bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.id, url)
    await bandal.app.evaluate(async ({ webContents }, id) => { await webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value = "unsaved browser conversation"') }, nativeId)
    await expect(visibleTab(page, 'Move browser fixture')).toBeVisible()
    const content = page.locator('.workspace-panel-content:visible').filter({ has: page.locator('.browser-panel') })
    const instanceId = await content.getAttribute('data-panel-instance')
    await page.evaluate(() => { (window as any).__movingBrowserDom = document.querySelector('.browser-panel') })
    await expect.poll(async () => Object.keys((await persistedPanels(page, source.id, target.id))[0]).length).toBe(1)
    await dragOverFolder(page, visibleTab(page, 'Move browser fixture'), target.name)
    const beforeMove = await persistedPanels(page, source.id, target.id)
    await bandal.app.evaluate(({ ipcMain }, { sourceId, targetId }) => {
      const original = (ipcMain as any)._invokeHandlers.get('layout:saveMany')
      const probe = { attempts: 0, release: null as (() => void) | null }
      ;(globalThis as any).__courseMoveSave = probe
      ipcMain.removeHandler('layout:saveMany')
      ipcMain.handle('layout:saveMany', async (event, input) => {
        if (input.layouts.some((entry: any) => entry.courseId === sourceId) && input.layouts.some((entry: any) => entry.courseId === targetId)) {
          probe.attempts += 1
          if (probe.attempts === 1) throw new Error('Injected atomic course move save failure')
          if (probe.attempts === 2) await new Promise<void>(resolve => { probe.release = resolve })
        }
        return original(event, input)
      })
    }, { sourceId: source.id, targetId: target.id })
    await dropInCanvas(page)
    await expect(visibleTab(page, 'Move browser fixture')).toBeVisible()
    expect(await page.locator('.workspace-panel-content:visible').getAttribute('data-panel-instance')).toBe(instanceId)
    expect(await page.evaluate(() => (window as any).__movingBrowserDom === document.querySelector('.browser-panel'))).toBe(true)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), nativeId)).toBe('unsaved browser conversation')
    await page.getByRole('region', { name: 'AI 웹 바로가기' }).getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(1)
    expect(await bandal.app.evaluate(async ({ webContents }, id) => ({ id: webContents.fromId(id)!.id, url: webContents.fromId(id)!.getURL(), draft: await webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value') }), nativeId)).toEqual({ id: nativeId, url, draft: 'unsaved browser conversation' })
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__courseMoveSave.attempts)).toBe(2)
    expect(await persistedPanels(page, source.id, target.id)).toEqual(beforeMove)
    await bandal.app.evaluate(() => (globalThis as any).__courseMoveSave.release())
    await expect.poll(() => page.evaluate(async ({ sourceId, targetId }) => {
      const [source, target] = await Promise.all([window.bandal.invoke('layout:get', { courseId: sourceId }), window.bandal.invoke('layout:get', { courseId: targetId })])
      return [Object.keys((source.layout as any)?.panels ?? {}).length, Object.keys((target.layout as any)?.panels ?? {}).length]
    }, { sourceId: source.id, targetId: target.id })).toEqual([0, 1])
    // Restore only the harmless start page eagerly; Gemini stays lazy until the
    // HTTPS fixture is reinstalled in the next process (including packaged runs).
    await visibleTab(page, 'Move browser fixture').click()
    await page.keyboard.press('ControlOrMeta+t')
    await page.getByRole('option', { name: '새 브라우저 탭', exact: false }).click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(2)
    await expect.poll(async () => Object.keys((await persistedPanels(page, source.id, target.id))[1]).length).toBe(2)
    const profileDir = bandal.profileDir
    await bandal.close(); bandal = await launchBandal({ reuseProfileDir: profileDir }); page = bandal.page
    await installSite()
    await expect(selected(page, target.name)).toBeVisible()
    await expect(visibleTab(page, 'Move browser fixture')).toBeVisible()
    await page.getByRole('region', { name: 'AI 웹 바로가기' }).getByRole('button', { name: 'Gemini', exact: true }).click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(2)
    await expect.poll(() => bandal.app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url && !contents.isLoading())?.getTitle(), url)).toBe('Move browser fixture')
    await folder(page, source.name).locator('.course-row__select').click()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(0)
  } finally {
    await bandal.app.evaluate(() => (globalThis as any).__courseMoveSave?.release?.()).catch(() => {})
    await bandal.close()
  }
})

test('note movement keeps its editor and resource binding through split placement, cancellation and another course hop', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    for (const name of ['필기 출발', '필기 도착', '필기 경유', '필기 다음']) await createCourse(page, name)
    const all = await courses(page), source = all.find(course => course.name === '필기 출발')!, target = all.find(course => course.name === '필기 도착')!
    writeFileSync(join(source.folderPath, 'moving.md'), '# moving\n\n원래 필기\n')
    writeFileSync(join(target.folderPath, 'target.md'), '# target\n\n도착 과목 필기\n')
    await folder(page, target.name).locator('.course-row__select').click()
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="target.md"]').click()
    await folder(page, source.name).locator('.course-row__select').click()
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="moving.md"]').click()
    await bandal.app.evaluate(({ ipcMain }, sourceId) => {
      const original = (ipcMain as any)._invokeHandlers.get('notes:write')
      const probe = { started: false, release: null as (() => void) | null }
      ;(globalThis as any).__courseMoveNoteSave = probe
      ipcMain.removeHandler('notes:write')
      ipcMain.handle('notes:write', async (event, input) => {
        if (!probe.started && input.courseId === sourceId && input.relPath === 'moving.md') {
          probe.started = true
          await new Promise<void>(resolve => { probe.release = resolve })
        }
        return original(event, input)
      })
    }, source.id)
    const editor = page.locator('.note-tab:visible .ProseMirror')
    await editor.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End'); await page.keyboard.type(' 이동 중에 쓴 초안')
    await expect.poll(() => bandal.app.evaluate(() => (globalThis as any).__courseMoveNoteSave.started)).toBe(true)
    await page.evaluate(() => { (window as any).__movingNoteDom = document.querySelector('.workspace-panel-content:not([hidden]) .note-tab .ProseMirror') })
    const instanceId = await page.locator('.workspace-panel-content:visible').getAttribute('data-panel-instance')
    await dragOverFolder(page, visibleTab(page, 'moving'), '필기 경유')
    await dragOverActiveToNextFolder(page, '필기 다음')
    await dragOverActiveToNextFolder(page, target.name)
    await dropInCanvas(page, true)
    await expect(page.locator('.workspace-course:not([hidden]) .dv-groupview')).toHaveCount(2)
    await expect(page.locator('.note-tab:visible .ProseMirror').filter({ hasText: '이동 중에 쓴 초안' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__movingNoteDom === [...document.querySelectorAll('.note-tab .ProseMirror')].find(editor => editor.textContent?.includes('이동 중에 쓴 초안')))).toBe(true)
    await expect(page.locator(`[data-panel-instance="${instanceId}"]`)).toHaveAttribute('data-content-course', target.id)
    await bandal.app.evaluate(() => (globalThis as any).__courseMoveNoteSave.release())
    await expect.poll(() => readFileSync(join(source.folderPath, 'moving.md'), 'utf8')).toContain('이동 중에 쓴 초안')
    const movedEditor = page.locator(`[data-panel-instance="${instanceId}"] .ProseMirror`)
    await movedEditor.click(); await page.keyboard.press('ControlOrMeta+z')
    await expect(movedEditor).not.toContainText('이동 중에 쓴 초안')
    await expect(movedEditor).toContainText('원래 필기')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(movedEditor).toContainText('이동 중에 쓴 초안')
    expect(await page.evaluate(() => (window as any).__movingNoteDom?.isConnected)).toBe(true)
    await expect.poll(() => page.evaluate(async courseId => {
      const { layout } = await window.bandal.invoke('layout:get', { courseId })
      return Object.values((layout as any)?.panels ?? {}).map((panel: any) => panel.params.descriptor).find((descriptor: any) => descriptor.payload?.relPath === 'moving.md')?.payload.courseId
    }, target.id)).toBe(source.id)
    await dragOverFolder(page, visibleTab(page, 'moving'), source.name)
    await page.keyboard.press('Escape'); await page.mouse.up()
    await folder(page, target.name).locator('.course-row__select').click()
    await expect(visibleTab(page, 'moving')).toBeVisible()
    expect(await page.evaluate(() => (window as any).__movingNoteDom?.isConnected)).toBe(true)
    await folder(page, source.name).locator('.course-row__select').click()
    await page.locator('[data-material-path="moving.md"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '이름 변경', exact: true }).click()
    const rename = page.getByRole('textbox', { name: 'moving.md 이름 변경', exact: true })
    await rename.fill('renamed.md'); await rename.press('Enter')
    await expect(page.locator('[data-material-path="renamed.md"]')).toBeVisible()
    await expect(page.locator('.workspace-course:not([hidden]) .dv-tab')).toHaveCount(0)
    await expect.poll(async () => Object.values((await persistedPanels(page, source.id, target.id))[1]).map((panel: any) => panel.params.descriptor).find((descriptor: any) => descriptor.payload?.relPath === 'renamed.md')?.payload.courseId).toBe(source.id)
    await folder(page, target.name).locator('.course-row__select').click()
    await expect(visibleTab(page, 'renamed')).toBeVisible()
    await expect(page.locator('.note-tab:visible .ProseMirror').filter({ hasText: '이동 중에 쓴 초안' })).toBeVisible()
  } finally {
    await bandal.app.evaluate(() => (globalThis as any).__courseMoveNoteSave?.release?.()).catch(() => {})
    await bandal.close()
  }
})

test('an identical persisted panel in the destination rejects a real drag and preserves the source editor', async () => {
  let bandal = await launchBandal({ keepProfileOnClose: true })
  try {
    let page = bandal.page
    await createCourse(page, '충돌 출발'); await createCourse(page, '충돌 도착')
    const all = await courses(page), source = all.find(course => course.name === '충돌 출발')!, target = all.find(course => course.name === '충돌 도착')!
    writeFileSync(join(source.folderPath, 'shared.md'), '# shared\n\n충돌해도 보존할 필기\n')
    await folder(page, source.name).locator('.course-row__select').click()
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('[data-material-path="shared.md"]').click()
    await expect.poll(async () => Object.keys((await persistedPanels(page, source.id, target.id))[0]).length).toBe(1)
    await page.evaluate(async ({ sourceId, targetId }) => {
      const { layout } = await window.bandal.invoke('layout:get', { courseId: sourceId })
      await window.bandal.invoke('layout:saveMany', { layouts: [{ courseId: sourceId, layout }, { courseId: targetId, layout }] })
    }, { sourceId: source.id, targetId: target.id })
    const profileDir = bandal.profileDir
    await bandal.close(); bandal = await launchBandal({ reuseProfileDir: profileDir }); page = bandal.page
    await expect(selected(page, source.name)).toBeVisible()
    await expect(visibleTab(page, 'shared')).toBeVisible()
    await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
    await page.evaluate(() => { (window as any).__collisionSourceEditor = document.querySelector('.workspace-panel-content:not([hidden]) .ProseMirror') })
    const beforeMove = await persistedPanels(page, source.id, target.id)
    await dragOverFolder(page, visibleTab(page, 'shared'), target.name)
    await dropInCanvas(page)
    await expect(page.getByText('이 과목에 같은 창이 이미 열려 있어요. 창을 닫은 후 다시 옮겨 주세요.', { exact: true })).toBeVisible()
    expect(await persistedPanels(page, source.id, target.id)).toEqual(beforeMove)
    expect(await page.evaluate(() => (window as any).__collisionSourceEditor?.isConnected)).toBe(true)
    await folder(page, source.name).locator('.course-row__select').click()
    await expect(visibleTab(page, 'shared')).toBeVisible()
    expect(await page.evaluate(() => (window as any).__collisionSourceEditor === document.querySelector('.workspace-panel-content:not([hidden]) .ProseMirror'))).toBe(true)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toContainText('충돌해도 보존할 필기')
  } finally { await bandal.close() }
})

async function dragOverActiveToNextFolder(page: Page, name: string): Promise<void> {
  const destination = (await folder(page, name).boundingBox())!
  await page.mouse.move(destination.x + 80, destination.y + destination.height / 2, { steps: 10 })
  await page.mouse.move(destination.x + 81, destination.y + destination.height / 2)
  await expect(selected(page, name)).toBeVisible()
}

test('whiteboard movement keeps the same canvas instance and committed text', async () => {
  const bandal: BandalApp = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '판 출발'); await createCourse(page, '판 도착')
    await folder(page, '판 출발').locator('.course-row__select').click()
    await page.locator('.whiteboards-group').getByRole('button', { name: '새 화이트보드 만들기' }).click()
    const ink = page.locator('.ink-layer:visible'); await expect(ink).toBeVisible()
    await page.getByRole('button', { name: /텍스트/ }).first().click()
    const bounds = (await ink.boundingBox())!
    await page.mouse.click(bounds.x + 160, bounds.y + 130)
    await page.keyboard.type('옮겨도 남아 있는 판')
    await page.mouse.click(bounds.x + Math.min(420, bounds.width - 30), bounds.y + Math.min(320, bounds.height - 30))
    await page.keyboard.press('Escape')
    await expect(page.locator('.ink-layer__textbox', { hasText: '옮겨도 남아 있는 판' })).toBeVisible()
    await page.evaluate(() => { (window as any).__movingInkDom = document.querySelector('.ink-layer') })
    const title = await page.locator('.workspace-course:not([hidden]) .workspace-tab__title').innerText()
    await dragOverFolder(page, visibleTab(page, title), '판 도착')
    await dropInCanvas(page)
    expect(await page.evaluate(() => (window as any).__movingInkDom === document.querySelector('.ink-layer'))).toBe(true)
    await expect(page.locator('.ink-layer__textbox', { hasText: '옮겨도 남아 있는 판' })).toBeVisible()
  } finally { await bandal.close() }
})
