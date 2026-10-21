import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
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

async function dispatchNativeCycleKeys(app: BandalApp['app'], guestId: number, steps: Array<'modifier-down' | 't-down' | 't-up' | 'modifier-up'>): Promise<void> {
  await app.evaluate(async ({ BrowserWindow, webContents }, { guestId, steps }) => {
    const guest = webContents.fromId(guestId)!
    const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents
    const mac = process.platform === 'darwin'
    const modifiers: Array<'meta' | 'control'> = [mac ? 'meta' : 'control']
    const inputs = {
      'modifier-down': { type: 'keyDown', keyCode: mac ? 'Meta' : 'Control', modifiers },
      't-down': { type: 'keyDown', keyCode: 'T', modifiers },
      't-up': { type: 'keyUp', keyCode: 'T', modifiers },
      'modifier-up': { type: 'keyUp', keyCode: mac ? 'Meta' : 'Control' }
    } satisfies Record<string, Electron.KeyboardInputEvent>
    for (const step of steps) {
      const input = inputs[step]
      const target = webContents.getFocusedWebContents()
      if (target !== guest && target !== host) throw new Error(`Unexpected native keyboard target: ${target?.id ?? 'none'}`)
      ;(globalThis as any).__nativeTabCycleProbe.events.push({ at: Date.now(), phase: 'dispatch', id: target.id, type: input.type, code: input.keyCode, modifiers: 'modifiers' in input ? input.modifiers : [] })
      target.sendInputEvent(input)
      // Flush through the renderer before choosing the next focused native
      // target. There is no chooser-rendering wait or timing-based delay.
      await target.executeJavaScript('void 0')
      const focused = webContents.getFocusedWebContents()
      ;(globalThis as any).__nativeTabCycleProbe.events.push({ at: Date.now(), phase: 'renderer-barrier', id: target.id, focusedId: focused?.id ?? null, type: input.type, code: input.keyCode })
      if (step === 't-down' && target === guest && focused !== host) throw new Error('Guest new-tab shortcut did not transfer keyboard focus to its host')
    }
  }, { guestId, steps })
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

  test('starts from a native browser guest and finishes the cycle after focus moves to the host', async ({}, testInfo) => {
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
      await app.evaluate(({ BrowserWindow, webContents }, id) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents
        const guest = webContents.fromId(id)!
        const events: unknown[] = []
        const capture = (source: 'host' | 'guest', sourceId: number) => (_event: unknown, input: Electron.Input): void => {
          events.push({ at: Date.now(), phase: 'before-input', source, id: sourceId,
            focusedId: webContents.getFocusedWebContents()?.id ?? null,
            type: input.type, code: input.code, meta: input.meta, control: input.control,
            alt: input.alt, shift: input.shift, isAutoRepeat: input.isAutoRepeat })
        }
        const hostInput = capture('host', host.id), guestInput = capture('guest', guest.id)
        const captureInputEvent = (source: 'host' | 'guest', sourceId: number) => (_event: unknown, input: any): void => {
          events.push({ at: Date.now(), phase: 'input-event', source, id: sourceId,
            focusedId: webContents.getFocusedWebContents()?.id ?? null,
            type: input.type, code: input.code, modifiers: input.modifiers })
        }
        const hostEvent = captureInputEvent('host', host.id), guestEvent = captureInputEvent('guest', guest.id)
        host.prependListener('before-input-event', hostInput)
        guest.prependListener('before-input-event', guestInput)
        host.on('input-event', hostEvent)
        guest.on('input-event', guestEvent)
        ;(globalThis as any).__nativeTabCycleProbe = {
          events,
          restore: () => {
            host.removeListener('before-input-event', hostInput)
            guest.removeListener('before-input-event', guestInput)
            host.removeListener('input-event', hostEvent)
            guest.removeListener('input-event', guestEvent)
          }
        }
      }, guestId)
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
      await dispatchNativeCycleKeys(app, guestId, ['modifier-down', 't-down', 't-up'])
      await expectSelected(page, '브라우저')
      await expect(tabs(page)).toHaveCount(1)
      await dispatchNativeCycleKeys(app, guestId, ['t-down', 't-up'])
      await expectSelected(page, '마크다운')
      await expect(tabs(page)).toHaveCount(1)
      await dispatchNativeCycleKeys(app, guestId, ['modifier-up'])
      await expect(menu(page)).toBeHidden()
      await expect(tabs(page)).toHaveCount(2)
      await expect(page.locator('.note-tab:visible .ProseMirror')).toBeVisible()
      expect(await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), guestId)).toBe('native draft')

      // Do not wait for chooser rendering between key events. A renderer
      // roundtrip lets subsequent events follow the actual keyboard focus;
      // fire-and-forget input to a now-hidden guest can drop the final release.
      await page.getByRole('tab', { name: 'Native cycle fixture', exact: true }).click()
      await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
        const host = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!
        return host.contentView.children.some(view => 'webContents' in view &&
          (view as Electron.WebContentsView).webContents.id === id && view.getVisible())
      }, guestId)).toBe(true)
      await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.focus(), guestId)
      await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.isFocused(), guestId)).toBe(true)
      await dispatchNativeCycleKeys(app, guestId, ['modifier-down', 't-down', 't-up', 'modifier-up'])
      await expect(menu(page)).toBeHidden()
      await expect(tabs(page)).toHaveCount(3)
      await expect(page.locator('.browser-toolbar:visible')).toBeVisible()
      expect(await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('document.querySelector("#draft").value'), guestId)).toBe('native draft')
    } finally {
      const events = await bandal.app.evaluate(() => {
        const probe = (globalThis as any).__nativeTabCycleProbe
        if (!probe) return []
        probe.restore()
        delete (globalThis as any).__nativeTabCycleProbe
        return probe.events
      })
      const inputLog = testInfo.outputPath('native-tab-cycle-input.json')
      writeFileSync(inputLog, JSON.stringify(events, null, 2))
      await testInfo.attach('native-tab-cycle-input', { path: inputLog, contentType: 'application/json' })
      await server.close()
    }
  })
})
