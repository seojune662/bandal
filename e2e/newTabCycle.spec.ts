import { expect, test, type Page } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { startFileServer } from './helpers/fileServer'

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control'
const TAB_LABELS = ['브라우저', '마크다운', '노트', 'AI', '녹음']

const menu = (page: Page) => page.getByRole('dialog', { name: '새 탭 열기' })
const tabs = (page: Page) => page.locator('.workspace-course:not([hidden]) .dv-tab')

async function expectSelected(page: Page, label: string): Promise<void> {
  await expect(menu(page).getByRole('option', { selected: true }).locator('.new-tab-menu__label')).toHaveText(label)
}

async function chooseWithKeyboard(page: Page, presses: number): Promise<void> {
  await page.keyboard.down(MODIFIER)
  for (let index = 0; index < presses; index++) await page.keyboard.press('KeyT')
  await page.keyboard.up(MODIFIER)
}

test.describe('new tab keyboard cycle', () => {
  let bandal: BandalApp

  test.beforeEach(async () => {
    bandal = await launchBandal()
    await bandal.page.evaluate(() => window.bandal.invoke('settings:set', { browser: { homePage: 'https://example.invalid' } }))
    await createCourse(bandal.page, '키보드로 새 탭')
  })

  test.afterEach(async () => {
    await bandal.close()
  })

  test('cycles in menu order, wraps, and creates only the selected tab on modifier release', async () => {
    const { page } = bandal
    await page.keyboard.down(MODIFIER)
    for (const label of [...TAB_LABELS, '브라우저', '마크다운']) {
      await page.keyboard.press('KeyT')
      await expect(menu(page).locator('.new-tab-menu__label')).toHaveText(TAB_LABELS)
      await expectSelected(page, label)
      await expect(tabs(page)).toHaveCount(0)
      await expect(page.getByRole('dialog', { name: '새 노트', exact: true })).toBeHidden()
    }
    await page.keyboard.up(MODIFIER)
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
  })

  test('a quick single press opens a browser and each new chord starts at the first type', async () => {
    const { page } = bandal
    await page.keyboard.press(`${MODIFIER}+KeyT`)
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.browser-toolbar:visible')).toBeVisible()
    await page.locator('.browser-address input:visible').click()
    await page.keyboard.press(`${MODIFIER}+KeyT`)
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(2)
    await expect(page.locator('.browser-toolbar:visible')).toBeVisible()
    await expect(page.locator('.note-tab:visible')).toHaveCount(0)
  })

  test('the third type creates a note immediately with the configured paper defaults', async () => {
    const { page } = bandal
    await page.evaluate(() => window.bandal.invoke('settings:set', { tabs: { notePaper: 'grid', noteOrientation: 'landscape' } }))
    await chooseWithKeyboard(page, 3)
    await expect(menu(page)).toBeHidden()
    await expect(page.getByRole('dialog', { name: '새 노트', exact: true })).toBeHidden()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.pdf-page[data-pdf-page="1"]:visible')).toBeVisible({ timeout: 30_000 })
    const title = await page.locator('.workspace-tab__title').innerText()
    const info = await page.evaluate(async title => {
      const courseId = (await window.bandal.invoke('courses:list', {}))[0]!.id
      return window.bandal.invoke('pdfNotes:info', { courseId, relPath: `노트/${title}` })
    }, title)
    expect(info).toMatchObject({ paper: 'grid', orientation: 'landscape' })
    await page.locator('.workspace-add-tab').click()
    await menu(page).getByRole('option', { name: /^노트(?:\s|$)/ }).click()
    const sheet = page.getByRole('dialog', { name: '새 노트', exact: true })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('radio', { name: '모눈', exact: true })).toBeChecked()
    await expect(sheet.getByRole('radio', { name: '가로', exact: true })).toBeChecked()
    await sheet.getByRole('button', { name: '취소', exact: true }).click()
    await expect(tabs(page)).toHaveCount(1)
  })

  test('the fourth and fifth types open AI and recording without starting a recording', async () => {
    const { page } = bandal
    await chooseWithKeyboard(page, 4)
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.dv-tab.dv-active-tab')).toContainText('AI')
    await page.locator('.dv-tab.dv-active-tab').focus()
    await chooseWithKeyboard(page, 5)
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(2)
    await expect(page.locator('.recording:visible')).toBeVisible()
    await expect(page.locator('.recording-indicator')).toHaveCount(0)
  })

  test('ignores held-key repeats, cancels with Escape, and leaves the plus menu open on modifier release', async () => {
    const { page } = bandal
    await page.keyboard.down(MODIFIER)
    await page.keyboard.down('KeyT')
    await expectSelected(page, '브라우저')
    // Playwright marks a second down without an up as an auto-repeat.
    await page.keyboard.down('KeyT')
    await page.keyboard.down('KeyT')
    await expectSelected(page, '브라우저')
    await page.keyboard.up('KeyT')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await page.keyboard.up(MODIFIER)
    await expect(tabs(page)).toHaveCount(0)

    await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
    await expect(menu(page).locator('.new-tab-menu__label')).toHaveText(TAB_LABELS)
    await page.keyboard.down(MODIFIER)
    await page.keyboard.up(MODIFIER)
    await expect(menu(page)).toBeVisible()
    await expect(tabs(page)).toHaveCount(0)
    await menu(page).getByRole('option', { name: /^마크다운(?:\s|$)/ }).click()
    await expect(menu(page)).toBeHidden()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
  })

  test('starts from a native browser guest and finishes the cycle after focus moves to the host', async () => {
    const server = await startFileServer({
      '/cycle': {
        fileName: 'cycle.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><head><title>Native cycle fixture</title></head><body><input id="draft" value="native draft"></body></html>'
      }
    })
    try {
      const { page, app } = bandal
      const url = `${server.origin}/cycle`
      await page.locator('.workspace-watermark').getByRole('button', { name: '새 탭 열기' }).click()
      await page.getByLabel('새 탭 검색').fill(url)
      await menu(page).getByRole('option', { name: `브라우저 ${url}`, exact: true }).click()
      await expect(tabs(page)).toContainText('Native cycle fixture')
      const guestId = await app.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.id, url)
      await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        return host.contentView.children.some(view => 'webContents' in view &&
          (view as Electron.WebContentsView).webContents.id === id && view.getVisible())
      }, guestId)).toBe(true)
      await app.evaluate(({ app, BrowserWindow, webContents }, id) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        host.show()
        if (process.platform === 'darwin') app.focus({ steal: true })
        host.focus()
        webContents.fromId(id)!.focus()
      }, guestId)
      await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), guestId)).toBe(true)
      await app.evaluate(({ webContents }, id) => {
        const guest = webContents.fromId(id)!
        const modifiers: Array<'meta' | 'control'> = [process.platform === 'darwin' ? 'meta' : 'control']
        guest.sendInputEvent({ type: 'keyDown', keyCode: process.platform === 'darwin' ? 'Meta' : 'Control', modifiers })
        guest.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers })
        guest.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers })
      }, guestId)
      await expectSelected(page, '브라우저')
      await expect(tabs(page)).toHaveCount(1)
      await app.evaluate(({ BrowserWindow }) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        const modifiers: Array<'meta' | 'control'> = [process.platform === 'darwin' ? 'meta' : 'control']
        host.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers })
        host.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers })
      })
      await expectSelected(page, '마크다운')
      await expect(tabs(page)).toHaveCount(1)
      await app.evaluate(({ BrowserWindow }) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        host.webContents.sendInputEvent({ type: 'keyUp', keyCode: process.platform === 'darwin' ? 'Meta' : 'Control' })
      })
      await expect(menu(page)).toBeHidden()
      await expect(tabs(page)).toHaveCount(2)
      await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
      expect(await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), guestId)).toBe('native draft')

      // Release can arrive in the guest before React mounts the chooser.
      // A complete chord in one native dispatch must still create one browser.
      await page.getByRole('tab', { name: 'Native cycle fixture', exact: true }).click()
      await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        return host.contentView.children.some(view => 'webContents' in view &&
          (view as Electron.WebContentsView).webContents.id === id && view.getVisible())
      }, guestId)).toBe(true)
      await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.focus(), guestId)
      await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), guestId)).toBe(true)
      await app.evaluate(({ webContents }, id) => {
        const guest = webContents.fromId(id)!
        const modifiers: Array<'meta' | 'control'> = [process.platform === 'darwin' ? 'meta' : 'control']
        guest.sendInputEvent({ type: 'keyDown', keyCode: process.platform === 'darwin' ? 'Meta' : 'Control', modifiers })
        guest.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers })
        guest.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers })
        guest.sendInputEvent({ type: 'keyUp', keyCode: process.platform === 'darwin' ? 'Meta' : 'Control' })
      }, guestId)
      await expect(menu(page)).toBeHidden()
      await expect(tabs(page)).toHaveCount(3)
      await expect(page.locator('.browser-toolbar:visible')).toBeVisible()
      expect(await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), guestId)).toBe('native draft')
    } finally {
      await server.close()
    }
  })
})
