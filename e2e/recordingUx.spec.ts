import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TAB_PREFERENCES } from '../src/shared/tabPreferences'
import { wavHeader } from '../src/main/features/recordings/recordingRepo'
import { createCourse, launchBandal } from './helpers/launch'

test('saved WAV opens its own tab; folding, scrolling and playback are independent', async () => {
  const bandal = await launchBandal({ keepProfileOnClose: true })
  let closed = false
  try {
    const { page } = bandal
    await createCourse(page, '녹음 UX 검증')
    const recordings = await page.evaluate(async () => {
      const course = (await window.bandal.invoke('courses:list', {}))[0]!
      return Promise.all(
        ['벡터의 외적', '두 번째 강의'].map((title) =>
          window.bandal.invoke('recordings:create', {
            courseId: course.id,
            title,
            modelId: 'whisper-large-v3-turbo'
          })
        )
      )
    })
    // Local-only deterministic fixture, not an STT/accuracy benchmark.
    const Database =
      require('better-sqlite3-node') as typeof import('better-sqlite3')
    const db = new Database(join(bandal.userDataDir, 'bandal.db'))
    const courseFolder = join(bandal.dataRoot, readdirSync(bandal.dataRoot)[0]!)
    try {
      db.transaction(() => {
        for (const recording of recordings) {
          const samples = 250 * 16000
          writeFileSync(
            join(courseFolder, recording.audioRelPath),
            Buffer.concat([wavHeader(samples), Buffer.alloc(samples * 2)])
          )
          db.prepare(
            'UPDATE recording_sessions SET payload = ? WHERE id = ?'
          ).run(
            JSON.stringify({
              ...recording,
              status: 'complete',
              samples,
              transcribedSamples: samples
            }),
            recording.id
          )
          const insert = db.prepare(
            'INSERT INTO recording_segments (session_id, start_sample, end_sample, text) VALUES (?, ?, ?, ?)'
          )
          for (let i = 0; i < 250; i++)
            insert.run(
              recording.id,
              i * 16000,
              (i + 1) * 16000,
              `${recording.title} — 복습할 문장 ${i + 1}. 자막과 원음을 함께 확인합니다.`
            )
        }
      })()
    } finally {
      db.close()
    }
    await page.reload()
    await expect(page.locator('[data-material-path="녹음"]')).toBeVisible()
    await page.locator('[data-material-path="녹음"]').click()
    const first = recordings[0]!
    const second = recordings[1]!
    await page
      .locator(`[data-material-path="${first.audioRelPath.slice(0, -10)}"]`)
      .click()
    await page.locator(`[data-material-path="${first.audioRelPath}"]`).click()
    const panel = page.locator('.recording:visible')
    await expect(
      panel.getByRole('heading', { name: first.title, exact: true })
    ).toBeVisible()
    await expect(panel.locator('.recording__segment')).toHaveCount(200)
    await expect(panel.locator('.recording__sidebar')).toBeVisible()
    await panel.locator('.recording__setup > summary').click()
    await expect(
      panel.getByRole('radio', { name: 'Whisper large-v3-turbo' })
    ).toBeHidden()
    await panel.locator('.recording__setup > summary').click()
    await expect(
      panel.getByRole('radio', { name: 'Whisper large-v3-turbo' })
    ).toBeVisible()
    await panel.getByRole('button', { name: '설정·자료 접기' }).click()
    await expect(panel.locator('.recording__sidebar')).toBeHidden()
    const main = panel.locator('.recording__main')
    await panel.locator('.recording__segment').first().hover()
    await page.mouse.wheel(0, 560)
    await expect
      .poll(() => main.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(200)
    expect(
      await panel
        .locator('.recording__transcript-scroll')
        .evaluate((element) => getComputedStyle(element).overflowY)
    ).toBe('visible')
    await main.evaluate((element) => {
      element.scrollTop = 0
    })
    const mutations = await panel.evaluate(async (element) => {
      const captions = element.querySelector('.recording__transcript')!
      let count = 0
      const observer = new MutationObserver((records) => {
        count += records.length
      })
      observer.observe(captions, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      })
      const audio = element.querySelector('audio')!
      for (let i = 1; i <= 12; i++) {
        audio.currentTime = i
        audio.dispatchEvent(new Event('timeupdate', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      observer.disconnect()
      return count
    })
    expect(mutations).toBe(0)
    await panel.getByRole('button', { name: '녹음 재생', exact: true }).click()
    await expect
      .poll(() =>
        panel
          .locator('audio')
          .evaluate((audio: HTMLAudioElement) => audio.paused)
      )
      .toBe(false)
    await panel.getByRole('button', { name: '재생 일시정지' }).click()
    await panel.getByRole('combobox', { name: '재생 속도' }).selectOption('1.5')
    expect(
      await panel
        .locator('audio')
        .evaluate((audio: HTMLAudioElement) => audio.playbackRate)
    ).toBe(1.5)
    await page.screenshot({ path: 'e2e/test-results/recording-ux-review.png' })
    await page
      .locator(`[data-material-path="${second.audioRelPath.slice(0, -10)}"]`)
      .click()
    await page.locator(`[data-material-path="${second.audioRelPath}"]`).click()
    await expect(
      page
        .locator('.recording:visible')
        .getByRole('heading', { name: second.title, exact: true })
    ).toBeVisible()
    await page.locator(`[data-material-path="${first.audioRelPath}"]`).click()
    await expect(
      page
        .locator('.recording:visible')
        .getByRole('heading', { name: first.title, exact: true })
    ).toBeVisible()
    await expect(
      page.locator('.dv-tab').filter({ hasText: first.title })
    ).toHaveCount(1)
    await bandal.close()
    closed = true
    const restored = await launchBandal({ reuseProfileDir: bandal.profileDir })
    try {
      await expect(
        restored.page
          .locator('.recording:visible')
          .getByRole('heading', { name: first.title, exact: true })
      ).toBeVisible()
      await expect(
        restored.page.locator('.recording:visible .recording__sidebar')
      ).toBeHidden()
    } finally {
      await restored.close()
    }
  } finally {
    if (!closed) await bandal.close()
  }
})

test('tab menu order, all shortcuts and tab defaults work together', async () => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await createCourse(page, '탭 설정 검증')
    await page.keyboard.press('Meta+t')
    const options = page.getByRole('option')
    expect(
      (await options.allTextContents())
        .slice(0, 6)
        .map((text) => text.replace(/\s+/g, ' '))
    ).toEqual([
      expect.stringContaining('새 마크다운'),
      expect.stringContaining('새 브라우저 탭'),
      expect.stringContaining('AI'),
      expect.stringContaining('녹음'),
      expect.stringContaining('새 화이트보드'),
      expect.stringContaining('학업 보드')
    ])
    for (let index = 0; index < 6; index++)
      await expect(options.nth(index)).toContainText('⌘')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+,')
    await page.locator('.settings-nav [data-category="tabs"]').click()
    const prefs = page.locator('.tab-settings')
    await prefs.getByRole('tab', { name: '녹음', exact: true }).click()
    await prefs
      .getByRole('combobox', { name: '기본 재생 속도' })
      .selectOption('1.5')
    await prefs
      .getByRole('switch', { name: '설정·자료 패널 열어 두기' })
      .click()
    await prefs.getByRole('radio', { name: 'Whisper large-v3-turbo' }).check()
    await page.screenshot({
      path: 'e2e/test-results/recording-tab-settings.png'
    })
    await prefs.getByRole('tab', { name: '마크다운', exact: true }).click()
    await prefs
      .getByRole('textbox', { name: '새 파일 제목 접두어' })
      .fill('강의 필기')
    await prefs.getByRole('button', { name: '저장', exact: true }).click()
    await prefs.getByRole('tab', { name: '화이트보드', exact: true }).click()
    await prefs
      .getByRole('combobox', { name: '기본 배경' })
      .selectOption('dots')
    await prefs.getByRole('tab', { name: '학업 보드', exact: true }).click()
    await prefs
      .getByRole('combobox', { name: '시작 화면' })
      .selectOption('board')
    await prefs.getByRole('switch', { name: '완료한 항목 숨기기' }).click()
    await prefs.getByRole('tab', { name: '브라우저', exact: true }).click()
    await expect(
      prefs.getByText('홈페이지', { exact: true }).first()
    ).toBeVisible()
    await prefs.getByRole('tab', { name: 'AI', exact: true }).click()
    await expect(
      prefs.getByText('Claude Code', { exact: true }).first()
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.bandal.invoke('settings:get', {})).tabs
        )
      )
      .toMatchObject({
        ...DEFAULT_TAB_PREFERENCES,
        recordingPlaybackRate: 1.5,
        recordingSidebarOpen: false,
        markdownTitlePrefix: '강의 필기',
        whiteboardBackground: 'dots',
        boardDefaultView: 'board',
        boardHideDone: true
      })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+Shift+m')
    await expect(
      page.locator('.dv-tab').filter({ hasText: '강의 필기' })
    ).toBeVisible()
    await page.keyboard.press('Meta+Shift+a')
    await expect(page.locator('.dv-tab.dv-active-tab')).toContainText('AI')
    await page.keyboard.press('Meta+Alt+r')
    await expect(page.locator('.recording:visible')).toBeVisible()
    await expect(
      page.locator('.recording:visible .recording__sidebar')
    ).toBeHidden()
    await page.keyboard.press('Meta+Alt+w')
    const boards = await page.evaluate(async () => {
      const course = (await window.bandal.invoke('courses:list', {}))[0]!
      return window.bandal.invoke('canvas:list', { courseId: course.id })
    })
    expect(boards[0]?.background).toBe('dots')
    await page.keyboard.press('Meta+Alt+d')
    await expect(page.locator('.dv-tab.dv-active-tab')).toContainText(
      '학업 보드'
    )
  } finally {
    await bandal.close()
  }
})
