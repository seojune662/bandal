import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

async function invoke<T>(
  page: Page,
  channel: string,
  request: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ channel, request }) => {
      const bridge = (
        window as unknown as {
          bandal: {
            invoke(channel: string, request: unknown): Promise<unknown>
          }
        }
      ).bandal
      return bridge.invoke(channel, request)
    },
    { channel, request },
  ) as Promise<T>
}

async function install(page: Page, name: string): Promise<void> {
  await invoke(page, 'plugins:installFromFolder', {
    path: resolve(__dirname, '../examples/plugins', name),
  })
  await invoke(page, 'plugins:approve', { id: `bandal.${name}` })
  const enabled = await invoke(page, 'plugins:setEnabled', {
    id: `bandal.${name}`,
    enabled: true,
  })
  expect(enabled).toMatchObject({ plugin: { state: 'active' } })
}

test.describe('plugin API v2', () => {
  test.describe.configure({ mode: 'serial' })
  let bandal: BandalApp
  test.beforeAll(async () => {
    bandal = await launchBandal({ keepProfileOnClose: true })
    await createCourse(bandal.page, '플러그인 v2')
  })
  test.afterAll(async () => {
    await bandal.close()
  })

  test('activates with settings access, edits the live selection and supports undo', async () => {
    const { page } = bandal
    await install(page, 'selection-tools')
    const courses = await invoke<Array<{ id: string }>>(
      page,
      'courses:list',
      {},
    )
    const note = await invoke<{ courseId: string; relPath: string }>(
      page,
      'notes:create',
      { courseId: courses[0]!.id, dirRelPath: '', title: '선택 편집' },
    )
    await invoke(page, 'notes:write', { ...note, markdown: 'Alpha Beta' })
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    await page.locator('.material-row', { hasText: '선택 편집' }).click()
    const editor = page.getByLabel('마크다운 필기 편집기')
    await expect(editor).toBeVisible()
    await editor.locator('[contenteditable="true"]').click()
    await page.keyboard.press('Meta+A')
    await invoke(page, 'plugins:runCommand', {
      pluginId: 'bandal.selection-tools',
      commandId: 'transform',
    })
    await expect(editor).toHaveText('ALPHA BETA')
    await page.keyboard.press('Meta+z')
    await expect(editor).toHaveText('Alpha Beta')
    // The following test starts from a settled disk revision, not an in-flight undo save.
    await expect.poll(async () => (await invoke<{ markdown: string }>(page, 'notes:read', note)).markdown.trim()).toBe('Alpha Beta')
    await expect(page.locator('.note-save-status')).toHaveAttribute('data-status', 'saved')
  })

  test('settings UI persists schema fields and changes subsequent commands', async () => {
    const { page } = bandal
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav [data-category="packs"]').click()
    await page
      .locator('.plugin-center-nav')
      .getByRole('button', { name: '설치됨', exact: true })
      .click()
    const card = page.locator('.settings-extension-card', {
      hasText: '선택 텍스트 도구',
    })
    await card.locator('summary', { hasText: '플러그인 설정' }).click()
    await card.getByLabel('변환 방식').selectOption('lowercase')
    await expect
      .poll(() =>
        invoke(page, 'plugins:getSettings', { id: 'bandal.selection-tools' }),
      )
      .toMatchObject({ values: { case: 'lowercase' } })
    await page.locator('.settings-nav [data-category="general"]').click()
    await page.locator('.settings-search input').fill('변환 방식')
    await page.locator('.settings-search-hit', { hasText: '변환 방식' }).click()
    await expect(
      page.locator('.settings-panel [data-search-match="true"]'),
    ).toContainText('변환 방식')
    await expect(page.getByLabel('변환 방식')).toBeVisible()
    await page.keyboard.press('Escape')
    const editor = page.getByLabel('마크다운 필기 편집기')
    await editor.getByText('Alpha Beta', { exact: true }).click({ clickCount: 3 })
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('Alpha Beta')
    await page
      .getByRole('button', { name: '더 많은 서식', exact: true })
      .click()
    await page
      .getByRole('menuitem', { name: /선택 텍스트 대소문자 변환/ })
      .click()
    await expect(editor).toHaveText('alpha beta')
    const courses = await invoke<Array<{ id: string }>>(
      page,
      'courses:list',
      {},
    )
    await expect
      .poll(async () =>
        (
          await invoke<{ markdown: string }>(page, 'notes:read', {
            courseId: courses[0]!.id,
            relPath: '선택 편집.md',
          })
        ).markdown.trim(),
      )
      .toBe('alpha beta')
  })

  test('material menu opens a panel, closes it through its API and restores its content', async () => {
    const { page, app } = bandal
    await install(page, 'material-summary')
    await page
      .locator('.material-row', { hasText: '선택 편집' })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: /자료 개요 열기/ }).click()
    const guest = page.locator(
      'webview[src="bandal-plugin://bandal.material-summary/ui/index.html"]',
    )
    await expect(guest).toBeAttached()
    const preview = () =>
      app.evaluate(async ({ webContents }) => {
        const panel = webContents
          .getAllWebContents()
          .find((contents) =>
            contents
              .getURL()
              .startsWith('bandal-plugin://bandal.material-summary/'),
          )
        return panel
          ? panel.executeJavaScript(
              "document.querySelector('#preview')?.textContent",
            )
          : null
      })
    await expect.poll(preview).toContain('alpha beta')
    await app.evaluate(async ({ webContents }) => {
      const panel = webContents
        .getAllWebContents()
        .find((contents) =>
          contents
            .getURL()
            .startsWith('bandal-plugin://bandal.material-summary/'),
        )
      await panel?.executeJavaScript(
        "document.querySelector('#close')?.click()",
      )
    })
    await expect(guest).not.toBeAttached()
    await invoke(page, 'plugins:reload', { id: 'bandal.material-summary' })
    await page.getByRole('button', { name: '새 탭 열기', exact: true }).click()
    await page.getByLabel('새 탭 검색').fill('자료 개요')
    await page
      .getByRole('option', { name: '자료 개요 자료 개요', exact: true })
      .click()
    await expect.poll(preview).toContain('alpha beta')
  })

  test('development folder refresh requires approval and stops cleanly', async () => {
    const { page, profileDir } = bandal
    const folder = resolve(profileDir, 'development-plugin')
    cpSync(resolve(__dirname, '../examples/plugins/selection-tools'), folder, {
      recursive: true,
    })
    const manifestPath = resolve(folder, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.id = 'test.development'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    await invoke(page, 'plugins:watchFolder', { path: folder })
    await invoke(page, 'plugins:approve', { id: manifest.id })
    await invoke(page, 'plugins:setEnabled', { id: manifest.id, enabled: true })
    manifest.version = '1.0.1'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    await expect
      .poll(async () =>
        (
          await invoke<{
            plugins: Array<{
              manifest: { id: string; version: string }
              state: string
            }>
          }>(page, 'plugins:list', {})
        ).plugins.find((plugin) => plugin.manifest.id === manifest.id),
      )
      .toMatchObject({
        manifest: { version: '1.0.1' },
        state: 'needs-approval',
      })
    await invoke(page, 'plugins:unwatchFolder', { id: manifest.id })
    expect(await invoke(page, 'plugins:devFolders', {})).toEqual({
      folders: [],
    })
    await invoke(page, 'plugins:uninstall', { id: manifest.id })
  })

  test('theme applies, falls back when disabled and restores after restart', async () => {
    const { page } = bandal
    await install(page, 'study-theme')
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav [data-category="appearance"]').click()
    await page
      .getByLabel('플러그인 테마', { exact: true })
      .selectOption('bandal.study-theme:study')
    await expect(page.locator('html')).toHaveAttribute(
      'data-plugin-theme',
      'bandal.study-theme:study',
    )
    await page.getByRole('radio', { name: /^다크 / }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-plugin-theme')
    await page
      .getByLabel('플러그인 테마', { exact: true })
      .selectOption('bandal.study-theme:study')
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--bg-app')
            .trim(),
        ),
      )
      .toBe('#101820')
    await invoke(page, 'plugins:setEnabled', {
      id: 'bandal.study-theme',
      enabled: false,
    })
    await expect(page.locator('html')).not.toHaveAttribute('data-plugin-theme')
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--bg-app'),
        ),
      )
      .toBe('')
    await invoke(page, 'plugins:setEnabled', {
      id: 'bandal.study-theme',
      enabled: true,
    })
    const profileDir = bandal.profileDir
    await bandal.close()
    bandal = await launchBandal({ reuseProfileDir: profileDir })
    await expect(bandal.page.locator('html')).toHaveAttribute(
      'data-plugin-theme',
      'bandal.study-theme:study',
    )
    expect(
      await invoke(bandal.page, 'plugins:getSettings', {
        id: 'bandal.selection-tools',
      }),
    ).toMatchObject({ values: { case: 'lowercase' } })
  })
})
