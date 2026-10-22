import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const WORD_COUNT_PLUGIN = resolve(
  __dirname,
  '..',
  'examples',
  'plugins',
  'word-count'
)

test.describe('third-party plugins', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '플러그인 과목')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('installs, activates, runs, and exchanges panel messages', async () => {
    const { app, page, userDataDir } = bandal
    const installed = await page.evaluate(async (path) => {
      const bridge = (window as unknown as {
        bandal: { invoke(channel: string, request: unknown): Promise<unknown> }
      }).bandal
      return bridge.invoke('plugins:installFromFolder', { path })
    }, WORD_COUNT_PLUGIN)
    expect(installed).toMatchObject({
      plugin: {
        manifest: { id: 'bandal.word-count' },
        enabled: false
      }
    })
    expect(
      existsSync(
        join(userDataDir, 'plugins', 'bandal.word-count', 'manifest.json')
      )
    ).toBe(true)

    const activation = await page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke(channel: string, request: unknown): Promise<unknown> }
      }).bandal
      await bridge.invoke('plugins:approve', { id: 'bandal.word-count' })
      const enabled = await bridge.invoke('plugins:setEnabled', {
        id: 'bandal.word-count',
        enabled: true
      })
      const logs = await bridge.invoke('plugins:logs', {
        id: null
      })
      return { enabled, logs }
    })
    expect(activation).toMatchObject({
      enabled: {
        plugin: { enabled: true, state: 'active', lastError: null }
      },
      logs: { entries: [] }
    })

    await page.evaluate(async () => {
      const bridge = (window as unknown as {
        bandal: { invoke(channel: string, request: unknown): Promise<unknown> }
      }).bandal
      const courses = (await bridge.invoke('courses:list', {})) as Array<{
        id: string
        name: string
      }>
      const course = courses.find((item) => item.name === '플러그인 과목')
      if (course === undefined) throw new Error('plugin test course is missing')
      const note = (await bridge.invoke('notes:create', {
        courseId: course.id,
        dirRelPath: '',
        title: '카운트 테스트'
      })) as { courseId: string; relPath: string }
      await bridge.invoke('notes:write', {
        ...note,
        markdown: '하나 둘 셋'
      })
    })

    // Extensions keep a dedicated launcher; installing one must not add a sixth creation type.
    await page.getByRole('button', { name: '새 탭 열기' }).click()
    const menu = page.getByRole('dialog', { name: '새 탭 열기' })
    await expect(menu.getByRole('option')).toHaveCount(5)
    await expect(menu.locator('.new-tab-menu__label')).toHaveText(['브라우저', '마크다운', '노트', 'AI', '녹음'])
    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: '앱 메뉴' }).getByRole('button', { name: '더보기', exact: true }).click()
    const launcher = page.getByRole('complementary', { name: '앱 더보기' })
    await expect(launcher).toBeVisible()
    await launcher.getByLabel('기능 검색').fill('단어 수')
    const command = launcher.locator('.launcher-feature[data-kind="plugin-command"]').filter({ hasText: '현재 과목 필기 단어 수' }).getByRole('button').first()
    const pluginPanel = launcher.locator('.launcher-feature[data-kind="plugin-panel"]').filter({ hasText: '단어 수' }).getByRole('button').first()
    await expect(command).toBeEnabled()
    await expect(pluginPanel).toBeEnabled()
    const notice = page.evaluate(
      () =>
        new Promise<unknown>((resolveNotice, rejectNotice) => {
          const bridge = (window as unknown as {
            bandal: {
              on(
                channel: string,
                listener: (payload: unknown) => void
              ): () => void
            }
          }).bandal
          const timer = window.setTimeout(() => {
            stop()
            rejectNotice(new Error('plugin notice was not received'))
          }, 10_000)
          const stop = bridge.on('plugins:notice', (payload) => {
            window.clearTimeout(timer)
            stop()
            resolveNotice(payload)
          })
        })
    )
    await command.click()
    await expect(notice).resolves.toMatchObject({
      pluginId: 'bandal.word-count',
      message: '플러그인 과목: 단어 3개 · 글자 6자'
    })

    await pluginPanel.click()

    await expect(
      page.locator('webview[src="bandal-plugin://bandal.word-count/ui/index.html"]')
    ).toBeAttached()
    await expect.poll(async () =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((contents) =>
            contents.getURL().startsWith('bandal-plugin://bandal.word-count/')
          )
      )
    ).toBe(true)

    await app.evaluate(async ({ webContents }) => {
      const panel = webContents
        .getAllWebContents()
        .find((contents) =>
          contents.getURL().startsWith('bandal-plugin://bandal.word-count/')
        )
      if (panel === undefined) throw new Error('plugin panel guest is missing')
      await panel.executeJavaScript(
        "document.querySelector('#refresh')?.click()"
      )
    })

    await expect.poll(async () =>
      app.evaluate(async ({ webContents }) => {
        const panel = webContents
          .getAllWebContents()
          .find((contents) =>
            contents.getURL().startsWith('bandal-plugin://bandal.word-count/')
          )
        if (panel === undefined) return null
        return panel.executeJavaScript(`({
          course: document.querySelector('#course-name')?.textContent,
          words: document.querySelector('#total-words')?.textContent,
          title: document.querySelector('#rows th')?.textContent
        })`) as Promise<{
          course?: string
          words?: string
          title?: string
        }>
      })
    ).toEqual({ course: '플러그인 과목', words: '3', title: '카운트 테스트' })
  })
})
