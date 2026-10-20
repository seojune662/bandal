// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CommunityCampaign, CommunityContext, CommunityPost, CommunityPostInput } from '../../src/shared/types/community'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import { clearDraft, draftKey, newDraft, readDraft, saveDraft, transferGuestDraft } from '../../src/renderer/src/features/community/drafts'

const mocks = vi.hoisted(() => ({ request: vi.fn(), openCommunity: vi.fn(), takeIntent: vi.fn() }))
vi.mock('../../src/renderer/src/features/community/api', () => ({ communityRequest: mocks.request, communityError: (error: Error) => error.message }))
vi.mock('../../src/renderer/src/app/communityNavigation', () => ({ openCommunity: mocks.openCommunity, takeCommunityIntent: mocks.takeIntent }))
import CommunityHome from '../../src/renderer/src/features/community/CommunityHome'
import { ComposeDialog } from '../../src/renderer/src/features/community/ComposeDialog'
import { CommunityPromotion } from '../../src/renderer/src/features/community/CommunityPromotion'
import { PostDialog } from '../../src/renderer/src/features/community/PostDialog'
import { OperatorPanel } from '../../src/renderer/src/features/community/OperatorPanel'

const campaign: CommunityCampaign = {
  id: 'test-campaign', title: '반달에 있었으면 하는 공부 도구', summary: '실제로 쓰고 싶은 공부 도구를 알려 주세요.',
  published: true, phase: 'open', resultsPublished: false, closed: false, startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', resultsAt: '2026-11-30T00:00:00Z', rules: '모든 반달 사용자 참여 가능'
}
const context: CommunityContext = { configured: true, signedIn: true, operator: false, campaign }
const post: CommunityPost = {
  id: 'post-one', authorId: 'student', authorName: '공부하는 학생', category: 'study', campaignId: null, title: '틀린 풀이 돌아보기', body: '실수한 이유를 묶고 비슷한 문제를 다시 풀어요.', answers: null, pinned: false, hidden: false, reactionCount: 0, reacted: false, commentCount: 0, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', editable: true, award: null, developmentStatus: null, developmentNote: ''
}
function signedIn(id = 'student'): void {
  useAuthStore.setState({ hydrated: true, auth: { phase: 'signed-in', profile: { id, nickname: '학생', avatarColor: '', avatarEmoji: '' }, email: null, avatarUrl: null, online: true, errorCode: null }, init: async () => {} })
}
function button(container: HTMLElement, label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label)
  if (!element) throw new Error(`No button: ${label}`)
  return element
}
async function click(element: HTMLElement): Promise<void> { await act(async () => element.click()) }
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('official community', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    for (const name of ['localStorage', 'sessionStorage']) {
      const values = new Map<string, string>()
      vi.stubGlobal(name, { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() })
    }
    vi.clearAllMocks()
    for (const user of ['student', 'another', null]) for (const category of ['study', 'feedback', 'contest'] as const) {
      clearDraft(draftKey(user, category)); clearDraft(draftKey(user, category, campaign.id))
    }
    signedIn()
    useUiStore.setState({ isSettingsOpen: false, settingsCategory: null, openSettings: vi.fn(category => useUiStore.setState({ isSettingsOpen: true, settingsCategory: category ?? null })) })
    mocks.takeIntent.mockReturnValue(null)
    mocks.request.mockImplementation(async (action: string) => {
      if (action === 'context') return context
      if (action === 'posts') return { posts: [], nextCursor: null }
      if (action === 'post') return { post, comments: [] }
      if (action === 'reports') return []
      return post
    })
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  test('unpublished campaigns do not advertise prizes or permit contest submission', async () => {
    mocks.request.mockImplementation(async (action: string) => action === 'context' ? { ...context, campaign: { ...campaign, published: false, phase: 'draft' } } : { posts: [], nextCursor: null })
    mocks.takeIntent.mockReturnValueOnce({ compose: true, campaignId: campaign.id })
    await act(async () => root.render(<CommunityHome />))
    expect(container.textContent).not.toContain('1등 10만 원')
    expect(container.textContent).toContain('지금은 공모를 접수하지 않아요.')
    expect(button(container, '응모하기').disabled).toBe(true)
    expect(mocks.request).not.toHaveBeenCalledWith('savePost', expect.anything())
  })

  test('keeps the live campaign banner after dismissing its one-time promotion', async () => {
    const id = `dismiss-${crypto.randomUUID()}`
    mocks.request.mockImplementation(async (action: string) => action === 'context' ? { ...context, campaign: { ...campaign, id } } : { posts: [], nextCursor: null })
    await act(async () => root.render(<CommunityPromotion />))
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await click(container.querySelector('[aria-label="닫기"]')!)
    expect(localStorage.getItem(`bandal:community:campaign-dismissed:${id}`)).toBe('1')
    await act(async () => root.render(<><CommunityHome /><CommunityPromotion /></>))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(button(container, '공모 참여하기')).toBeDefined()
  })

  test('promotion only appears while a published campaign is accepting entries', async () => {
    mocks.request.mockResolvedValue({ ...context, campaign: { ...campaign, id: crypto.randomUUID(), phase: 'upcoming' } })
    await act(async () => root.render(<CommunityPromotion />))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  test('promotion participation opens the matching contest composer', async () => {
    const id = crypto.randomUUID()
    mocks.request.mockResolvedValue({ ...context, campaign: { ...campaign, id } })
    await act(async () => root.render(<CommunityPromotion />))
    await click(button(container, '공모 참여하기'))
    expect(mocks.openCommunity).toHaveBeenCalledWith({ compose: true, campaignId: id })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  test('retains a failed draft and retries the exact request ID without double submission', async () => {
    const onSaved = vi.fn()
    const draft = { ...newDraft(), title: '내 공부법', body: '주말마다 복습해요.' }
    saveDraft(draftKey('student', 'study'), draft)
    let reject!: (error: Error) => void
    mocks.request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await act(async () => root.render(<ComposeDialog category="study" campaign={campaign} userId="student" signedIn editing={null} onClose={vi.fn()} onLogin={vi.fn()} onSaved={onSaved} />))
    await click(button(container, '게시하기'))
    expect(button(container, '게시 중…').disabled).toBe(true)
    await click(button(container, '게시 중…'))
    expect(mocks.request).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('응답을 받지 못했어요.')))
    expect(readDraft(draftKey('student', 'study'))?.body).toBe(draft.body)
    expect(container.textContent).toContain('응답을 받지 못했어요.')
    mocks.request.mockResolvedValueOnce(post)
    await click(button(container, '게시하기'))
    expect(mocks.request.mock.calls[0]?.[1]).toEqual(mocks.request.mock.calls[1]?.[1])
    expect(onSaved).toHaveBeenCalledWith(post)
    expect(readDraft(draftKey('student', 'study'))).toBeNull()
  })

  test('recovers a lost create response before applying changed draft text to that same post', async () => {
    const draft = { ...newDraft(), title: '처음 제목', body: '처음 내용' }
    const key = draftKey('student', 'study')
    saveDraft(key, draft)
    mocks.request.mockRejectedValueOnce(new Error('응답 유실'))
    await act(async () => root.render(<ComposeDialog category="study" campaign={campaign} userId="student" signedIn editing={null} onClose={vi.fn()} onLogin={vi.fn()} onSaved={vi.fn()} />))
    await click(button(container, '게시하기'))
    await input(container.querySelector('textarea')!, '수정한 내용')
    mocks.request.mockResolvedValue(post)
    await click(button(container, '게시하기'))
    const requests = mocks.request.mock.calls.map(call => call[1] as CommunityPostInput)
    expect(requests).toHaveLength(3)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[2]).toMatchObject({ id: post.id, body: '수정한 내용' })
    expect(requests[2]?.requestId).not.toBe(draft.requestId)
  })

  test('drafts survive leaving the composer and remain isolated by account, category and campaign', async () => {
    saveDraft(draftKey('student', 'study'), { ...newDraft(), title: '공부 초안', body: '내 공부 내용' })
    saveDraft(draftKey('another', 'study'), { ...newDraft(), title: '다른 계정', body: '다른 계정 내용' })
    saveDraft(draftKey('student', 'contest', 'old-campaign'), { ...newDraft(), title: '이전 공모', body: '' })
    await act(async () => root.render(<CommunityHome />))
    await click(button(container, '글쓰기'))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('공부 초안')
    await input(container.querySelector('textarea')!, '이어 쓴 초안')
    await click(button(container, '나중에 이어 쓰기'))
    await click(button(container, '글쓰기'))
    expect(container.querySelector('textarea')?.value).toBe('이어 쓴 초안')
    await click(button(container, '나중에 이어 쓰기'))
    await click(button(container, '공모 참여하기'))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
    await act(async () => signedIn('another'))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await click(button(container, '글쓰기'))
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('다른 계정')
  })

  test('returns to the anonymous draft after sign-in without transferring another account draft', async () => {
    useAuthStore.setState({ auth: { ...useAuthStore.getState().auth, phase: 'signed-out', profile: null } })
    mocks.request.mockImplementation(async (action: string) => action === 'context' ? { ...context, signedIn: useAuthStore.getState().auth.phase === 'signed-in' } : { posts: [], nextCursor: null })
    await act(async () => root.render(<CommunityHome />))
    await click(button(container, '글쓰기'))
    await input(container.querySelector('input')!, '로그인 전 제목')
    await input(container.querySelector('textarea')!, '로그인 전 내용')
    await click(button(container, '로그인하고 게시'))
    expect(useUiStore.getState().openSettings).toHaveBeenCalledWith('account')
    expect(useUiStore.getState().isSettingsOpen).toBe(true)
    expect(useUiStore.getState().settingsCategory).toBe('account')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => signedIn())
    expect(useUiStore.getState().isSettingsOpen).toBe(false)
    expect(container.querySelector('textarea')?.value).toBe('로그인 전 내용')
    expect(readDraft(draftKey('student', 'study'))?.title).toBe('로그인 전 제목')
    expect(readDraft(draftKey(null, 'study'))).toBeNull()
    saveDraft(draftKey('another', 'study'), { ...newDraft(), title: '개인 초안' })
    transferGuestDraft('student', 'study')
    expect(readDraft(draftKey('another', 'study'))?.title).toBe('개인 초안')
  })

  test('does not close settings on sign-in without a pending community composer', async () => {
    useAuthStore.setState({ auth: { ...useAuthStore.getState().auth, phase: 'signed-out', profile: null } })
    mocks.request.mockImplementation(async (action: string) => action === 'context' ? { ...context, signedIn: useAuthStore.getState().auth.phase === 'signed-in' } : { posts: [], nextCursor: null })
    await act(async () => root.render(<CommunityHome />))
    await click(button(container, '로그인'))
    expect(useUiStore.getState().isSettingsOpen).toBe(true)
    await act(async () => signedIn())
    expect(useUiStore.getState().isSettingsOpen).toBe(true)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  test('never displays the previous account operator response after sign-out', async () => {
    let resolve!: (context: CommunityContext) => void
    mocks.request.mockImplementationOnce(() => new Promise<CommunityContext>(done => { resolve = done }))
    await act(async () => root.render(<CommunityHome />))
    await act(async () => useAuthStore.setState({ auth: { ...useAuthStore.getState().auth, phase: 'signed-out', profile: null } }))
    await act(async () => resolve({ ...context, operator: true }))
    expect(Array.from(container.querySelectorAll('nav button')).some(item => item.textContent === '운영')).toBe(false)
  })

  test('honors the server edit lock on a closed contest entry', async () => {
    mocks.request.mockResolvedValue({ post: { ...post, category: 'contest', editable: false }, comments: [] })
    await act(async () => root.render(<PostDialog id={post.id} signedIn userId="student" operator={false} onClose={vi.fn()} onLogin={vi.fn()} onEdit={vi.fn()} onChanged={vi.fn()} />))
    expect(Array.from(container.querySelectorAll('button')).some(item => item.textContent === '수정')).toBe(false)
    expect(container.textContent).toContain('접수 마감 이후에는 응모 내용을 수정할 수 없어요.')
  })

  test('updates reactions from the server result and reports only the selected comment', async () => {
    mocks.request.mockImplementation(async (action: string) => action === 'post' ? { post, comments: [{ id: 'comment-one', authorId: 'someone', authorName: '다른 학생', body: '댓글 내용', hidden: false, createdAt: post.createdAt }] } : action === 'react' ? { count: 3, active: true } : { ok: true })
    await act(async () => root.render(<PostDialog id={post.id} signedIn userId="student" operator={false} onClose={vi.fn()} onLogin={vi.fn()} onEdit={vi.fn()} onChanged={vi.fn()} />))
    await click(button(container, '공감 0'))
    expect(button(container, '공감 3').getAttribute('aria-pressed')).toBe('true')
    await click(button(container, '댓글 신고'))
    await input(container.querySelector('[role="dialog"] [role="dialog"] textarea')!, '개인정보가 포함되어 있어요.')
    await click(button(container, '신고 보내기'))
    expect(mocks.request).toHaveBeenCalledWith('report', { postId: post.id, commentId: 'comment-one', reason: '개인정보가 포함되어 있어요.' })
  })

  test('preserves separate result-publication and closing flags when editing campaign settings', async () => {
    mocks.request.mockImplementation(async (action: string) => action === 'reports' ? [] : campaign)
    await act(async () => root.render(<OperatorPanel campaign={{ ...campaign, phase: 'closed', closed: true, resultsPublished: true }} onSaved={vi.fn()} onPost={vi.fn()} />))
    await click(button(container, '공모 설정 저장'))
    expect(mocks.request).toHaveBeenCalledWith('updateCampaign', expect.objectContaining({ closed: true, resultsPublished: true, startsAt: new Date(campaign.startsAt!).toISOString(), endsAt: new Date(campaign.endsAt!).toISOString() }))
  })

  test('recovers a comment retry without duplicating it when its draft text changed', async () => {
    clearDraft(`bandal:community:comment:student:${post.id}`)
    let attempts = 0
    mocks.request.mockImplementation(async (action: string) => {
      if (action === 'post') return { post, comments: [] }
      if (action === 'comment' && ++attempts === 1) throw new Error('응답 유실')
      return { id: 'comment-recovered', authorId: 'student', authorName: '학생', body: '처음 댓글', hidden: false, createdAt: post.createdAt }
    })
    await act(async () => root.render(<PostDialog id={post.id} signedIn userId="student" operator={false} onClose={vi.fn()} onLogin={vi.fn()} onEdit={vi.fn()} onChanged={vi.fn()} />))
    await input(container.querySelector('textarea')!, '처음 댓글')
    await click(button(container, '댓글 게시'))
    await input(container.querySelector('textarea')!, '수정한 댓글')
    await click(button(container, '댓글 게시'))
    const requests = mocks.request.mock.calls.filter(call => call[0] === 'comment')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.[1]).toEqual(requests[1]?.[1])
    expect(container.querySelectorAll('.community__comment')).toHaveLength(1)
    expect(container.querySelector('textarea')?.value).toBe('수정한 댓글')
    expect(container.textContent).toContain('이전 댓글의 게시를 확인했어요.')
  })
})
