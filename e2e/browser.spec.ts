/**
 * Browser chrome behaviour. Playwright cannot see INSIDE a <webview>, so every
 * assertion here is on host DOM — which is exactly where the error page, the
 * find bar and the download UI live.
 */
import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'
import { startFileServer, type FileServer } from './helpers/fileServer'

async function openNewTabMenu(page: Page): Promise<void> {
  const headerButton = page.locator('.workspace-add-tab')
  if (await headerButton.isVisible()) {
    await headerButton.click()
  } else {
    await page
      .locator('.workspace-watermark')
      .getByRole('button', { name: '새 탭 열기' })
      .click()
  }
  await expect(page.getByRole('dialog', { name: '새 탭 열기' })).toBeVisible()
}

/**
 * Opens a browser tab at `url`. Each test gets its own so order never matters.
 * `url` must already be absolute — the omnibox echoes it back verbatim in the
 * option label, and the option's accessible name also carries its hint.
 */
async function openBrowserTab(page: Page, url: string): Promise<void> {
  await openNewTabMenu(page)
  await page.getByLabel('새 탭 검색').fill(url)
  await page.getByRole('option', { name: `${url} 열기` }).click()
  await expect(page.locator('.browser-toolbar').last()).toBeVisible({
    timeout: 15_000
  })
}

test.describe('browser restart', () => {
  test('a tab comes back where it was, not where it was opened', async () => {
    // `initialUrl` is excluded from the layout's structural key, so this also
    // proves the parked snapshot really carries the URL to disk on quit.
    const server: FileServer = await startFileServer({
      '/start': {
        fileName: 's.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><body><a id="go" href="/deep">deep</a></body></html>'
      },
      '/deep': {
        fileName: 'd.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><head><title>깊은 페이지</title></head><body>deep</body></html>'
      }
    })
    const first = await launchBandal({ keepProfileOnClose: true })
    try {
      await createCourse(first.page, '자료구조')
      await openBrowserTab(first.page, `${server.origin}/start`)
      // Navigate away from the URL the tab was opened with.
      await first.page.keyboard.press('Meta+KeyL')
      await first.page
        .locator('.browser-address input')
        .last()
        .fill(`${server.origin}/deep`)
      await first.page.keyboard.press('Enter')
      await expect(
        first.page.locator('.workspace-tab__title', { hasText: '깊은 페이지' })
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await first.close()
    }

    const second = await launchBandal({ reuseProfileDir: first.profileDir })
    try {
      await expect(
        second.page.locator('.browser-address input').last()
      ).toHaveValue(`${server.origin}/deep`, { timeout: 20_000 })
    } finally {
      await second.close()
      await server.close()
    }
  })
})

test.describe('browser', () => {
  let bandal: BandalApp

  test.beforeAll(async () => {
    bandal = await launchBandal()
    await createCourse(bandal.page, '자료구조')
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('says why a page did not load instead of showing a blank pane', async () => {
    const { page } = bandal
    // RFC 2606 .invalid never resolves, so this is a real DNS failure with no
    // network traffic — the same path a dead school portal takes.
    await openBrowserTab(page, 'https://example.invalid')

    const errorPage = page.locator('.browser-error')
    await expect(errorPage).toBeVisible({ timeout: 20_000 })
    await expect(errorPage.locator('.browser-error__title')).toHaveText(
      '주소를 찾지 못했습니다.'
    )
    await expect(errorPage.locator('.browser-error__detail')).toContainText(
      'example.invalid'
    )

    // A DNS failure is worth retrying; it is not a trust decision, so no
    // handoff to the system browser is offered.
    await expect(
      errorPage.getByRole('button', { name: '다시 시도' })
    ).toBeVisible()
    await expect(
      errorPage.getByRole('button', { name: '기본 브라우저에서 열기' })
    ).toHaveCount(0)

    // The chrome stays usable on top of the failure.
    await expect(page.locator('.browser-toolbar').first()).toBeVisible()
  })

  test('⌘+ zooms the page and ⌘0 puts it back', async () => {
    const { page } = bandal
    await openBrowserTab(page, 'https://example.invalid')
    const pill = page.locator('.browser-zoom-pill')

    // Quiet by default: nothing is shown at 100%.
    await expect(pill).toHaveCount(0)

    await page.keyboard.press('Meta+Equal')
    await expect(pill).toHaveText('110%')
    await page.keyboard.press('Meta+Equal')
    await expect(pill).toHaveText('125%')
    await page.keyboard.press('Meta+Minus')
    await expect(pill).toHaveText('110%')

    await page.keyboard.press('Meta+Digit0')
    await expect(pill).toHaveCount(0)
  })

  test('⌘L moves focus to the address bar', async () => {
    const { page } = bandal
    await openBrowserTab(page, 'https://example.invalid')
    await page.keyboard.press('Meta+KeyL')
    await expect(page.locator('.browser-address input').last()).toBeFocused()
  })

  test('⌘F opens a find bar that counts real matches', async () => {
    const server: FileServer = await startFileServer({
      '/page': {
        fileName: 'page.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><body><p>해시 충돌 해시 테이블 해시</p></body></html>'
      }
    })
    try {
      const { page } = bandal
      await openBrowserTab(page, `${server.origin}/page`)

      const bar = page.locator('.browser-find')
      await expect(bar).toHaveCount(0)
      await page.keyboard.press('Meta+KeyF')
      await expect(bar).toBeVisible()
      await expect(bar.locator('.browser-find__input')).toBeFocused()

      await bar.locator('.browser-find__input').fill('해시')
      // Three occurrences in the page above.
      await expect(bar.locator('.browser-find__count')).toHaveText('1/3', {
        timeout: 15_000
      })

      await bar.locator('.browser-find__input').press('Escape')
      await expect(bar).toHaveCount(0)
    } finally {
      await server.close()
    }
  })

  test('the omnibox suggests a page the student has already visited', async () => {
    const server: FileServer = await startFileServer({
      '/etl': {
        fileName: 'etl.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><head><title>자료구조 강의실</title></head><body>etl</body></html>'
      }
    })
    try {
      const { page } = bandal
      await openBrowserTab(page, `${server.origin}/etl`)
      // Wait for the title, which is what history stores it under.
      await expect(
        page.locator('.workspace-tab__title', { hasText: '자료구조 강의실' })
      ).toBeVisible({ timeout: 15_000 })

      // Type a fragment of the TITLE — a plain URL match would prove nothing.
      await page.keyboard.press('Meta+KeyL')
      await page.locator('.browser-address input').last().fill('강의실')

      const suggestion = page
        .locator('.browser-suggestion', { hasText: '자료구조 강의실' })
        .first()
      await expect(suggestion).toBeVisible({ timeout: 10_000 })
      await expect(suggestion).toContainText(`${server.origin}/etl`)
    } finally {
      await server.close()
    }
  })

  test('⌘D stars the page and it shows up in the bookmarks bar', async () => {
    const server: FileServer = await startFileServer({
      '/lms': {
        fileName: 'l.html',
        contentType: 'text/html; charset=utf-8',
        attachment: false,
        body: '<html><head><title>학사정보시스템</title></head><body>lms</body></html>'
      }
    })
    try {
      const { page } = bandal
      await openBrowserTab(page, `${server.origin}/lms`)
      await expect(
        page.locator('.workspace-tab__title', { hasText: '학사정보시스템' })
      ).toBeVisible({ timeout: 15_000 })

      // The bar renders nothing until the course has a browser favorite.
      await expect(page.locator('.browser-bookmarks')).toHaveCount(0)
      await page.keyboard.press('Meta+KeyD')

      const bookmark = page.locator('.browser-bookmark', {
        hasText: '학사정보시스템'
      })
      await expect(bookmark).toBeVisible({ timeout: 10_000 })

      // Pressing it again takes the page back out.
      await page.keyboard.press('Meta+KeyD')
      await expect(bookmark).toHaveCount(0)
    } finally {
      await server.close()
    }
  })

  test('a downloaded file lands in the course folder, not ~/Downloads', async () => {
    // The whole reason the embedded browser exists: getting a lecture handout
    // next to the rest of the course without a manual move.
    const server: FileServer = await startFileServer({
      '/handout': {
        fileName: '3주차 강의자료.pdf',
        body: '%PDF-1.4 lecture bytes'
      }
    })
    try {
      const { page } = bandal
      await openBrowserTab(page, `${server.origin}/handout`)

      await expect(page.locator('.toast')).toContainText('자료에 저장했어요', {
        timeout: 20_000
      })

      // And it is really on disk, under the course, with its Korean name.
      const courseDir = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
      const saved = join(courseDir, '3주차 강의자료.pdf')
      expect(existsSync(saved)).toBe(true)
      expect(readFileSync(saved, 'utf8')).toBe('%PDF-1.4 lecture bytes')
    } finally {
      await server.close()
    }
  })
})
