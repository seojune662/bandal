import { expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal } from './helpers/launch'

// Real Electron surfaces with synthetic documents; never opens personal data.
test('neutral appearance preserves document geometry, navigation and settings', async ({}, info) => {
  const start = Date.now()
  const bandal = await launchBandal()
  const { page } = bandal
  const artifactDir =
    process.env.BANDAL_UI_ARTIFACTS ?? info.outputPath('screens')
  mkdirSync(artifactDir, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    console.log('UI startup to interactive (ms):', Date.now() - start)
    // Render the real chat UI with a local response fixture; no account or model call.
    await bandal.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('chat:open')
      ipcMain.handle('chat:open', (_event, req) => ({
        availability: { installed: true, loggedIn: true },
        sessionInfo: {
          id: req.sessionId,
          courseId: req.courseId,
          provider: 'claude-code',
          model: null,
          status: 'idle',
          cliSessionId: null,
          title: null,
          surface: 'app',
          lastUsedAt: null
        },
        history: [
          { role: 'user', text: '오늘 배운 운동 방정식을 정리해줘.' },
          {
            role: 'assistant',
            text: '운동 방정식은 물체에 작용하는 힘과 가속도의 관계를 설명해요.\n\n1. 물체에 작용하는 힘을 찾습니다.\n2. 좌표축을 정하고 각 방향의 힘을 더합니다.\n3. 뉴턴의 제2법칙 **F = ma**를 적용합니다.\n\n강의 자료의 예제를 함께 풀어볼까요?'
          }
        ].map((entry, i) => ({
          id: `fixture-${i}`,
          courseId: req.courseId,
          sessionId: req.sessionId,
          role: entry.role,
          turnSeq: 1,
          createdAt: new Date().toISOString(),
          blocks: [
            {
              id: `block-${i}`,
              messageId: `fixture-${i}`,
              ord: 0,
              kind: 'text',
              payload: { text: entry.text }
            }
          ]
        }))
      }))
      ipcMain.removeHandler('appleCalendar:state')
      ipcMain.handle('appleCalendar:state', () => ({
        supported: false,
        authorization: 'not-determined',
        connected: false,
        calendars: [],
        selectedCalendarIds: [],
        destinationCalendarId: null
      }))
      ipcMain.removeHandler('agent:models')
      ipcMain.handle('agent:models', () => ({ models: [] }))
    })
    await createCourse(page, '운동체역학')
    const [course] = await page.evaluate(() =>
      window.bandal.invoke('courses:list', {})
    )
    copyFileSync(
      join(__dirname, '../web-demo/public/sample.pdf'),
      join(course!.folderPath, 'Lecture.pdf')
    )
    writeFileSync(
      join(course!.folderPath, '강의 정리.md'),
      '# 강의 정리\n\n오늘의 학습 목표\n\n- 운동 방정식 이해하기\n- 예제의 좌표계 정하기\n- 풀이 과정 기록하기\n'
    )
    await page.getByRole('button', { name: '자료 새로고침' }).click()
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(
        (theme) => window.bandal.invoke('settings:set', { theme }),
        theme
      )
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const width of [1440, 1024]) {
        await bandal.app.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(
              width,
              width === 1440 ? 900 : 640
            ),
          width
        )
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await page.locator('[data-material-path="Lecture.pdf"]').click()
        await expect(
          page.locator('.react-pdf__Page canvas').first()
        ).toBeVisible()
        await page.screenshot({
          path: join(artifactDir, `pdf-${theme}-${width}.png`),
          animations: 'disabled'
        })
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
        const before = await page
          .getByRole('button', { name: '과목 사이드바 접기' })
          .boundingBox()
        await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
        const after = await page
          .getByRole('button', { name: '과목 사이드바 펼치기' })
          .boundingBox()
        expect(after!.x).toBe(before!.x)
        expect(after!.y).toBe(before!.y)
        await expect(
          page.getByRole('button', { name: '과목 사이드바 펼치기' })
        ).toHaveCount(1)
        await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
        await page.locator('[data-material-path="강의 정리.md"]').click()
        await expect(
          page.locator('.milkdown .ProseMirror:visible')
        ).toContainText('오늘의 학습 목표')
        await page.screenshot({
          path: join(artifactDir, `note-${theme}-${width}.png`),
          animations: 'disabled'
        })
        await page.keyboard.press('ControlOrMeta+w')
        await page.keyboard.press('ControlOrMeta+Shift+a')
        await expect(
          page.getByRole('textbox', { name: '메시지 입력' })
        ).toBeVisible()
        await expect(page.locator('.chat-thread:visible')).toContainText(
          '뉴턴의 제2법칙'
        )
        await page.screenshot({
          path: join(artifactDir, `chat-${theme}-${width}.png`),
          animations: 'disabled'
        })
        await page.keyboard.press('ControlOrMeta+w')
        await page
          .getByRole('button', { name: '학업 보드 열기', exact: true })
          .click()
        await expect(page.locator('.board')).toBeVisible()
        await page.screenshot({
          path: join(artifactDir, `board-${theme}-${width}.png`),
          animations: 'disabled'
        })
        await page.locator('.board-overlay__close').click()
      }
      await page.getByRole('button', { name: '설정', exact: true }).click()
      await page
        .locator('.settings-nav__item[data-category="appearance"]')
        .click()
      await expect(
        page.getByRole('radiogroup', { name: '테마 선택' })
      ).toBeVisible()
      await page.screenshot({
        path: join(artifactDir, `settings-${theme}.png`),
        animations: 'disabled'
      })
      await page.keyboard.press('Escape')
    }
    const timing = await page.evaluate(async () => {
      const samples: number[] = []
      for (let i = 0; i < 30; i++) {
        const start = performance.now()
        document
          .querySelector<HTMLButtonElement>(
            '[aria-label="과목 사이드바 접기"], [aria-label="과목 사이드바 펼치기"]'
          )!
          .click()
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        samples.push(performance.now() - start)
      }
      samples.sort((a, b) => a - b)
      return { p95: samples[28], max: samples[29] }
    })
    console.log('Sidebar interaction (ms):', timing)
    expect(timing.p95!).toBeLessThan(150)
    expect(errors).toEqual([])
  } finally {
    await bandal.close()
  }
})

test('global menus, course drag, resizing and enlarged text remain reachable', async () => {
  const bandal = await launchBandal()
  const { page } = bandal
  try {
    for (const name of [
      '첫 번째 과목',
      '두 번째 과목 — 아주 긴 이름의 강의와 실습 자료'
    ])
      await createCourse(page, name)
    await bandal.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 640)
    )
    // Preserve the actual course drag contract while rearranging the navigation.
    const rows = page.locator('.course-row')
    const names = await rows.locator('.course-row__name').allTextContents()
    await rows.last().evaluate((source, targetName) => {
      const target = [
        ...document.querySelectorAll<HTMLElement>('.course-row')
      ].find((row) => row.textContent?.includes(targetName))!
      const transfer = new DataTransfer()
      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer })
      )
      const rect = target.getBoundingClientRect()
      for (const type of ['dragover', 'drop'])
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: rect.x + 20,
            clientY: rect.y + 2
          })
        )
      source.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer: transfer })
      )
    }, names[0]!)
    await expect(rows.first().locator('.course-row__name')).toHaveText(
      names[1]!
    )
    const rail = page.locator('.app-rail--left')
    const before = (await rail.boundingBox())!.width
    const handle = page.getByRole('separator', {
      name: '과목 사이드바 폭 조절'
    })
    const rect = (await handle.boundingBox())!
    await page.mouse.move(rect.x + rect.width / 2, 300)
    await page.mouse.down()
    await page.mouse.move(rect.x + rect.width / 2 + 48, 300)
    await page.mouse.up()
    await expect
      .poll(async () => (await rail.boundingBox())!.width)
      .toBe(before + 48)
    await handle.dblclick({ position: { x: 3, y: 300 } })
    await expect.poll(async () => (await rail.boundingBox())!.width).toBe(240)
    await page.getByRole('button', { name: '과목 사이드바 접기' }).click()
    await expect(page.locator('.global-navigation')).toBeHidden()
    await page.getByRole('button', { name: '과목 사이드바 펼치기' }).click()
    await page.getByRole('button', { name: '더 보기', exact: true }).click()
    await expect(
      page.getByRole('menuitem', { name: '연결 그래프', exact: true })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '함께하기', exact: true })).toHaveCount(0)
    await page.evaluate(() =>
      window.bandal.invoke('settings:set', { fontScale: 1.2 })
    )
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.locator('[data-category="appearance"]').click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await expect(
      page.getByRole('radiogroup', { name: '테마 선택' }).getByRole('radio')
    ).toHaveCount(3)
  } finally {
    await bandal.close()
  }
})

test('library surfaces keep course colors quiet and document actions reachable', async ({}, info) => {
  const bandal = await launchBandal({ extraSettings: { theme: 'light', university: { universityId: 'snu', customUniversity: null, hiddenServiceIds: [], customServices: [], openExternallyOverrides: {}, serviceOrder: [], secondaryOverrides: {} } } })
  const { page, app } = bandal
  try {
    const courses = await page.evaluate(async () => {
      const group = await window.bandal.invoke('courseGroups:create', { name: '2026년 2학기' })
      const courses = []
      for (const [name, color] of [['개인 프로젝트', 'violet'], ['대학 글쓰기', 'pink'], ['선형대수학', 'blue'], ['운동체역학', 'orange'], ['항공역학', 'green']]) {
        const course = await window.bandal.invoke('courses:create', { name: name!, color: color! })
        if (courses.length) await window.bandal.invoke('courses:organize', { courseId: course.id, groupId: group.id, beforeCourseId: null })
        courses.push(course)
      }
      return courses
    })
    const course = courses.at(-1)!
    for (const name of ['01. 유체의 성질.pdf', '02. 연속 방정식.pdf', '03. 운동량 방정식.pdf']) copyFileSync(join(__dirname, '../web-demo/public/sample.pdf'), join(course.folderPath, name))
    writeFileSync(join(course.folderPath, '수업 노트.md'), '# 항공역학\n\n유체의 움직임을 기록합니다.\n')
    writeFileSync(join(course.folderPath, '날개 단면.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC3sAAAAASUVORK5CYII=', 'base64'))
    mkdirSync(join(course.folderPath, '참고 자료'))
    await page.reload()
    await page.locator('.university-section__heading[aria-expanded="true"]').click()
    await page.locator('.course-row__select').filter({ hasText: '항공역학' }).click()
    for (const other of courses.slice(0, -1)) {
      const toggle = page.getByRole('button', { name: `${other.name} 접기`, exact: true })
      if (await toggle.count()) await toggle.click()
    }
    await expect(page.locator('.material-row')).toHaveCount(6)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(theme => window.bandal.invoke('settings:set', { theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      for (const width of [1440, 1024]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, width === 1440 ? 900 : 640), width)
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
        await page.mouse.move(500, 10)
        await page.screenshot({ path: info.outputPath(`library-${theme}-${width}.png`), animations: 'disabled' })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const lastAction = page.locator('.workspace-watermark__cta:visible')
        await expect(lastAction).toBeInViewport()
        await lastAction.focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('.new-tab-menu')).toBeVisible()
        await page.keyboard.press('Escape')
      }
      const colors = await page.locator('.material-row:not([data-kind="dir"]) .material-row__type').evaluateAll(icons => icons.map(icon => getComputedStyle(icon).color))
      expect(new Set(colors).size).toBe(1)
    }
    const search = page.locator('aside.app-rail--right input[type="search"]')
    await search.fill('수업')
    await expect(page.locator('.material-result')).toHaveCount(1)
    await page.locator('.material-result').click()
    await expect(page.locator('.milkdown .ProseMirror:visible')).toContainText('유체의 움직임')
    await expect(page.locator('.course-row[data-selected="true"] .course-mark')).toHaveAttribute('data-course-color', 'green')
    expect((await page.evaluate(() => window.bandal.invoke('courses:list', {}))).find(entry => entry.id === course.id)?.color).toBe('green')
  } finally { await bandal.close() }
})
