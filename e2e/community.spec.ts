import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const rail = (page: Page) => page.getByRole('navigation', { name: '앱 메뉴' })
async function service(bandal: BandalApp, open = false): Promise<void> {
  await bandal.app.evaluate(({ ipcMain, BrowserWindow }, published) => {
    const userId = '11111111-1111-4111-8111-111111111111'
    const campaign = { id: 'study-tools-2026', title: '반달에 있었으면 하는 공부 도구 공모전', summary: '내가 쓰고 싶은 공부 도구를 제안해 주세요.', published, phase: published ? 'open' : 'draft', resultsPublished: false, closed: false, startsAt: published ? new Date(Date.now() - 86400_000).toISOString() : null, endsAt: published ? new Date(Date.now() + 86400_000).toISOString() : null, resultsAt: published ? new Date(Date.now() + 172800_000).toISOString() : null, rules: '실제 도움 40 · 구체성 30 · 구현 가능성 20 · 독창성 10' }
    const state = { campaign, posts: [] as any[], comments: [] as any[], requests: [] as any[], failSave: false }
    ;(globalThis as any).__community = state
    const auth = { phase: 'signed-in', profile: { id: userId, nickname: '공부하는 달', avatarColor: '#64748b', avatarEmoji: '🌙' }, email: null, avatarUrl: null, online: true, errorCode: null, localAccess: { allowed: true, requiresLogin: false, boundUserID: userId, profileID: '22222222-2222-4222-8222-222222222222' } }
    ipcMain.removeHandler('auth:getState'); ipcMain.handle('auth:getState', () => auth)
    ipcMain.removeHandler('community:request')
    ipcMain.handle('community:request', (_event, request) => {
      const { action, input } = request
      state.requests.push(request)
      if (action === 'context') return { configured: true, signedIn: true, operator: false, campaign: state.campaign }
      if (action === 'posts') return { posts: state.posts.filter(post => !input.category || post.category === input.category), nextCursor: null }
      if (action === 'post') return { post: state.posts.find(post => post.id === input.id), comments: state.comments }
      if (action === 'savePost') {
        if (state.failSave) throw new Error('연결이 끊겼어요. 다시 시도해 주세요.')
        const existing = state.posts.find(post => post.requestId === input.requestId)
        if (existing) return existing
        const post = { ...input, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', authorId: userId, authorName: '공부하는 달', campaignId: input.campaignId ?? null, answers: input.answers ?? null, pinned: false, hidden: false, reacted: false, reactionCount: 0, commentCount: 0, editable: true, award: null, developmentStatus: null, developmentNote: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        state.posts.unshift(post); return post
      }
      if (action === 'comment') {
        const comment = { id: 'comment-one', authorId: userId, authorName: '공부하는 달', body: input.body, hidden: false, createdAt: new Date().toISOString() }
        state.comments.push(comment); return comment
      }
      if (action === 'react') { const post = state.posts.find(post => post.id === input.postId); post.reacted = input.active; post.reactionCount = input.active ? 1 : 0; return { active: input.active, count: post.reactionCount } }
      return { ok: true }
    })
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.webContents.send('auth:changed', auth)
  }, open)
}

test('community replaces marketplace and preserves the live course editor while preparation stays quiet', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page } = bandal
    await service(bandal)
    await createCourse(page, '공부하는 방법')
    const course = await page.evaluate(async () => (await window.bandal.invoke('courses:list', {}))[0]!)
    writeFileSync(join(course.folderPath, '기록.md'), '# 오늘의 공부\n\n반달에서 공부해요.\n')
    await page.getByRole('button', { name: '자료 새로고침', exact: true }).click()
    await page.locator('[data-material-path="기록.md"]').click()
    const editor = page.locator('[aria-label="마크다운 필기 편집기"]')
    await expect(editor).toBeVisible()
    await editor.evaluate(element => { (window as any).__communityEditor = element })
    await expect(rail(page).getByRole('button', { name: '마켓플레이스', exact: true })).toHaveCount(0)
    await page.locator('[data-material-path="기록.md"]').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '자료 판매하기' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await rail(page).getByRole('button', { name: '커뮤니티', exact: true }).click()
    await expect(page.locator('.community h1')).toBeVisible()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-course-rail', 'closed')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-right-rail', 'closed')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '공모 참여하기', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('community-preparing.png') })
    await bandal.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))!.setSize(900, 700))
    expect(await page.locator('.community').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await rail(page).getByRole('button', { name: '홈', exact: true }).click()
    await expect(editor).toBeVisible()
    expect(await editor.evaluate(element => element === (window as any).__communityEditor)).toBe(true)
  } finally { await bandal.close() }
})

test('open contest promotion is dismissible once and submission retry preserves one entry with comments, reactions and native deep links', async ({}, info) => {
  const bandal = await launchBandal()
  try {
    const { page, app } = bandal
    await service(bandal, true)
    await page.reload()
    const promotion = page.getByRole('dialog', { name: '반달에 있었으면 하는 공부 도구 공모전' })
    await expect(promotion).toBeVisible()
    await promotion.getByRole('button', { name: '닫기', exact: true }).click()
    await page.reload()
    await expect(promotion).toHaveCount(0)
    await rail(page).getByRole('button', { name: '커뮤니티', exact: true }).click()
    await page.getByRole('button', { name: '공모 참여하기', exact: true }).click()
    const compose = page.getByRole('dialog', { name: '공모 참여', exact: true })
    await compose.getByLabel('제목', { exact: true }).fill('설명하면서 찾는 개념의 빈틈')
    const answers = compose.locator('textarea')
    for (const [index, value] of ['전공 개념을 설명하기 어려운 학생', '읽기만 하면 아는 줄 착각해요.', '한 개념을 말로 설명하고 빠진 연결을 질문받아요.', '수요와 공급을 설명한 뒤 가격 변화의 이유를 다시 말해요.'].entries()) await answers.nth(index).fill(value)
    await app.evaluate(() => { (globalThis as any).__community.failSave = true })
    await compose.getByRole('button', { name: '응모하기', exact: true }).click()
    await expect(compose.getByRole('alert')).toContainText('다시')
    await expect(compose.getByLabel('제목', { exact: true })).toHaveValue('설명하면서 찾는 개념의 빈틈')
    await compose.getByRole('button', { name: '나중에 이어 쓰기' }).click()
    await page.getByRole('button', { name: '공모 참여하기', exact: true }).click()
    await expect(compose.getByLabel('제목', { exact: true })).toHaveValue('설명하면서 찾는 개념의 빈틈')
    await app.evaluate(() => { (globalThis as any).__community.failSave = false })
    await compose.getByRole('button', { name: '응모하기', exact: true }).click()
    const detail = page.getByRole('dialog', { name: '커뮤니티 게시글' })
    await expect(detail).toContainText('설명하면서 찾는 개념의 빈틈')
    const saved = await app.evaluate(() => (globalThis as any).__community)
    const submissions = saved.requests.filter((request: any) => request.action === 'savePost')
    expect(submissions).toHaveLength(2)
    expect(submissions[0].input.requestId).toBe(submissions[1].input.requestId)
    expect(saved.posts).toHaveLength(1)
    await detail.getByRole('button', { name: '공감 0', exact: true }).click()
    await expect(detail.getByRole('button', { name: '공감 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await detail.getByLabel('댓글 쓰기', { exact: true }).fill('시험 전에 설명을 녹음해 보는 흐름도 좋겠어요.')
    await detail.getByRole('button', { name: '댓글 게시', exact: true }).click()
    await expect(detail).toContainText('시험 전에 설명을 녹음해 보는 흐름도 좋겠어요.')
    await page.screenshot({ path: info.outputPath('community-entry.png') })
    await detail.getByRole('button', { name: '닫기', exact: true }).click()
    await rail(page).getByRole('button', { name: '홈', exact: true }).click()
    await expect(page.locator('.community h1')).not.toBeVisible()

    // Exercise the registered OS-event handler, real IPC intent buffer and
    // preload push subscription; only the community service is mocked.
    const delivered = await app.evaluate(({ app }, url) => {
      let prevented = false
      const handled = app.emit('open-url', { preventDefault() { prevented = true } } as Electron.Event, url)
      return { handled, prevented }
    }, 'bandal://community/contest/study-tools-2026')
    expect(delivered).toEqual({ handled: true, prevented: true })
    await expect(page.locator('.community h1')).toBeVisible()
    await expect(compose).toBeVisible()
    await expect(compose.getByLabel('제목', { exact: true })).toHaveValue('')
    await expect(compose.getByRole('button', { name: '응모하기', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => window.bandal.invoke('community:takeIntent', {}))).toBeNull()
    expect(await app.evaluate(() => (globalThis as any).__community.posts.length)).toBe(1)
    await page.screenshot({ path: info.outputPath('community-native-deep-link.png') })
  } finally { await bandal.close() }
})
