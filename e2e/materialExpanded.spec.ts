import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'
import { startFileServer } from './helpers/fileServer'

test('expanded materials retain native pages and rail width, contain keyboard focus and close on window navigation', async ({}, info) => {
  test.setTimeout(150_000)
  const site = await startFileServer({ '/draft': {
    fileName: 'draft.html', attachment: false, contentType: 'text/html; charset=utf-8',
    body: '<html><head><title>Retained materials browser fixture</title></head><body style="margin:0;min-height:3000px;background:#dde8f4"><input id="draft" value="original"><h1>Live page</h1><script>window.instanceToken=Math.random()</script></body></html>'
  } })
  const bandal = await launchBandal({ extraSettings: { theme: 'light' } })
  try {
    const { page, app } = bandal
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1440, 900))
    await createCourse(page, '자료 확대 회귀')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, '참고.md'), '# Preserved material\n\nA readable source.\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await expect(page.locator('[data-material-path="참고.md"]')).toBeVisible()
    await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('browser:open-url', { url }), `${site.origin}/draft`)
    const nativePages = () => app.evaluate(({ BrowserWindow }, origin) => {
      const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
      return host.contentView.children.flatMap((view: any) => view.webContents?.getURL().startsWith(origin)
        ? [{ id: view.webContents.id as number, visible: view.getVisible() as boolean }] : [])
    }, site.origin)
    await expect.poll(async () => (await nativePages()).length).toBe(1)
    const nativeId = (await nativePages())[0]!.id
    await expect.poll(() => app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.readyState === "complete" && !!document.querySelector("#draft")'), nativeId)).toBe(true)
    const savedPage = await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value="unsaved materials draft";scrollTo(0,320);({token:window.instanceToken,draft:document.querySelector("#draft").value,scrollY})'), nativeId)
    const resizer = page.getByRole('separator', { name: '자료 사이드바 폭 조절', exact: true })
    await resizer.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowLeft')
    await expect(resizer).toHaveAttribute('aria-valuenow', '236')
    await page.mouse.move(2, 2)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect.poll(async () => (await nativePages())[0]?.visible).toBe(true)
    // Keyboard resizing updates the stored rail width immediately, while the
    // shell grid still animates from its old width. Capture the settled layout.
    await expect.poll(() => page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.app-shell')!
      const columns = getComputedStyle(shell).gridTemplateColumns.split(' ')
      return !shell.getAnimations().some(animation => animation.playState === 'running') &&
        Math.abs(parseFloat(columns.at(-1)!) - 236) < 0.01
    })).toBe(true)
    const workspaceBefore = await page.locator('.workspace-host').boundingBox()
    const railBefore = await page.locator('.right-sidebar').boundingBox()
    const tabsBefore = await page.locator('.workspace-course:not([hidden]) .dv-tab').count()
    await page.locator('.workspace-host').evaluate(element => element.setAttribute('data-retained-materials-fixture', 'unchanged'))

    const expanded = page.getByRole('dialog', { name: '자료 넓게 보기', exact: true })
    await page.getByRole('button', { name: '자료 넓게 보기', exact: true }).click()
    await expect(expanded).toBeVisible()
    await expect(page.locator('.app-workspace')).toHaveAttribute('inert', '')
    await expect(page.locator('.global-navigation')).toHaveAttribute('inert', '')
    expect(await page.locator('.workspace-host').boundingBox()).toEqual(workspaceBefore)
    await expect(expanded).toHaveCSS('width', '980px')
    await expect.poll(async () => (await nativePages())[0]?.visible).toBe(false)
    expect((await nativePages())[0]?.id).toBe(nativeId)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bandal:rail-widths:v1')!).right)).toBe(236)

    await expanded.getByRole('button', { name: '자료 보기 방식', exact: true }).focus()
    await page.keyboard.press('ControlOrMeta+f')
    await expect(page.locator('#material-search')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+t')
    await expect(page.getByRole('dialog', { name: '새 탭 열기', exact: true })).toHaveCount(0)
    expect(await page.locator('.workspace-course:not([hidden]) .dv-tab').count()).toBe(tabsBefore)
    await page.keyboard.press('ControlOrMeta+w')
    await expect(expanded).toHaveCount(0)
    expect(await page.locator('.workspace-course:not([hidden]) .dv-tab').count()).toBe(tabsBefore)
    await page.mouse.move(2, 2)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect.poll(async () => (await nativePages())[0]?.visible).toBe(true)
    const restoredPage = await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('({token:window.instanceToken,draft:document.querySelector("#draft").value,scrollY})'), nativeId)
    expect(restoredPage).toEqual(savedPage)
    expect(await page.locator('.right-sidebar').boundingBox()).toEqual(railBefore)

    await page.getByRole('button', { name: '자료 넓게 보기', exact: true }).click()
    await expanded.getByRole('button', { name: '생성하기', exact: true }).click()
    await expect(page.getByRole('menu', { name: '자료 생성', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: '자료 생성', exact: true })).toHaveCount(0)
    await expect(expanded).toBeVisible()
    await expanded.getByRole('button', { name: '생성하기', exact: true }).click()
    await page.getByRole('menuitem', { name: '새 노트', exact: true }).click()
    const noteDialog = page.getByRole('dialog', { name: '새 노트', exact: true })
    await expect(noteDialog).toBeVisible()
    const noteTitle = noteDialog.getByRole('textbox', { name: '제목', exact: true })
    await expect(noteTitle).toBeFocused()
    for (const chord of ['ControlOrMeta+f', 'ControlOrMeta+w', 'ControlOrMeta+t']) {
      await page.keyboard.press(chord)
      await expect(noteTitle).toBeFocused()
      await expect(noteDialog).toBeVisible()
      await expect(expanded).toBeVisible()
      expect(await page.locator('.workspace-course:not([hidden]) .dv-tab').count()).toBe(tabsBefore)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '새 노트', exact: true })).toHaveCount(0)
    await expect(expanded).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setContentSize(1024, 640))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1024)
    await expect(expanded).toHaveCSS('width', '952px')
    await expect(page.locator('.workspace-host')).toHaveAttribute('data-retained-materials-fixture', 'unchanged')
    await page.screenshot({ path: info.outputPath('materials-expanded-narrow.png') })

    await page.getByRole('button', { name: '윈도우 관리', exact: true }).click()
    await expect(expanded).toHaveCount(0)
    await expect(page.locator('.workspace-windows-overview')).toBeVisible()
    await page.getByRole('button', { name: '윈도우 추가', exact: true }).click()
    await expect(page.locator('.workspace-windows-overview')).toHaveCount(0)
    await page.getByRole('button', { name: '자료 넓게 보기', exact: true }).click()
    await expect(expanded).toBeVisible()
    await expanded.getByRole('tab', { name: 'AI', exact: true }).click()
    await expect(expanded).toHaveCount(0)
    await expect(page.locator('.right-sidebar')).toHaveCSS('width', '236px')
    await page.getByRole('tab', { name: '자료', exact: true }).click()
    await expect(page.locator('[data-material-path="참고.md"]')).toBeVisible()
    expect((await nativePages()).map(entry => entry.id)).toEqual([nativeId])
  } finally { await bandal.close(); await site.close() }
})
