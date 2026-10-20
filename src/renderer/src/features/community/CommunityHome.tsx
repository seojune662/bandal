import { useEffect, useRef, useState } from 'react'
import type { CommunityCategory, CommunityContext, CommunityPost } from '../../../../shared/types/community'
import { COMMUNITY_CATEGORY_LABELS, COMMUNITY_DEVELOPMENT_LABELS } from '../../../../shared/types/community'
import { takeCommunityIntent } from '../../app/communityNavigation'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { communityError, communityRequest } from './api'
import { CampaignBanner, CampaignDetails, campaignAcceptsEntries } from './CampaignNotice'
import { ComposeDialog } from './ComposeDialog'
import { transferGuestDraft } from './drafts'
import { OperatorPanel } from './OperatorPanel'
import { PostDialog } from './PostDialog'
import { CommunityError, formatCommunityDate } from './primitives'
import './community.css'

type Tab = CommunityCategory | 'all' | 'operator'
const PENDING_COMPOSE_KEY = 'bandal:community:pending-compose'
interface PendingCompose { category: CommunityCategory; campaignId?: string; anonymous: boolean }
function pendingCompose(): PendingCompose | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_COMPOSE_KEY) ?? 'null') as PendingCompose | null
    return value && ['contest', 'study', 'feedback'].includes(value.category) ? value : null
  } catch { return null }
}
function rememberCompose(value: PendingCompose | null): void {
  try { if (value) sessionStorage.setItem(PENDING_COMPOSE_KEY, JSON.stringify(value)); else sessionStorage.removeItem(PENDING_COMPOSE_KEY) } catch { /* The mounted view also retains the intent. */ }
}

export default function CommunityHome(): JSX.Element {
  const auth = useAuthStore(state => state.auth)
  const signedIn = auth.phase === 'signed-in'
  const userId = signedIn ? auth.profile?.id ?? null : null
  const [context, setContext] = useState<CommunityContext | null>(null)
  const [contextAccount, setContextAccount] = useState<string | null | undefined>(undefined)
  const [contextError, setContextError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<Tab>('all')
  const [posts, setPosts] = useState<CommunityPost[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)
  const listSequence = useRef(0)
  const [postId, setPostId] = useState<string | null>(null)
  const [compose, setCompose] = useState<CommunityCategory | null>(null)
  const [editing, setEditing] = useState<CommunityPost | null>(null)
  const [details, setDetails] = useState(false)
  const [pending, setPending] = useState<PendingCompose | null>(pendingCompose)
  const [incoming, setIncoming] = useState<ReturnType<typeof takeCommunityIntent>>(null)
  const previousUser = useRef(userId)
  const liveUser = useRef(userId)
  liveUser.current = userId
  const currentContext = contextAccount === userId ? context : null
  const campaign = currentContext?.campaign ?? null
  const canRead = signedIn && currentContext?.signedIn === true && currentContext.configured
  const operator = canRead && currentContext.operator
  const refresh = (): void => setRevision(value => value + 1)
  const login = (): void => useUiStore.getState().openSettings('account')
  const startCompose = (category: CommunityCategory): void => { setIntentError(null); setEditing(null); setCompose(category); setDetails(false) }

  useEffect(() => { void useAuthStore.getState().init() }, [])
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      setCompose(null); setEditing(null); setPostId(null); setPending(null); rememberCompose(null); setTab('all')
    }
    previousUser.current = userId
  }, [userId])
  useEffect(() => {
    let active = true
    let sequence = 0
    const load = (): void => {
      const current = ++sequence
      void communityRequest('context', {}).then(data => {
        if (active && current === sequence) { setContext(data); setContextAccount(userId); setContextError(null) }
      }).catch(failure => { if (active && current === sequence) setContextError(communityError(failure)) })
    }
    load()
    const interval = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', load) }
  }, [userId, signedIn, revision])
  useEffect(() => {
    const current = ++listSequence.current
    setPosts([]); setCursor(null); setListError(null)
    if (!canRead || tab === 'operator') { setLoading(false); return }
    setLoading(true)
    void communityRequest('posts', tab === 'all' ? {} : { category: tab }).then(data => {
      if (current === listSequence.current) { setPosts(data.posts); setCursor(data.nextCursor) }
    }).catch(failure => { if (current === listSequence.current) setListError(communityError(failure)) }).finally(() => { if (current === listSequence.current) setLoading(false) })
    return () => { listSequence.current += 1 }
  }, [canRead, tab, revision, userId])
  useEffect(() => {
    const handle = (): void => { const intent = takeCommunityIntent(); if (intent) setIncoming(intent) }
    handle(); window.addEventListener('bandal:community-open', handle)
    return () => window.removeEventListener('bandal:community-open', handle)
  }, [])
  useEffect(() => {
    if (!incoming || !currentContext) return
    if (incoming.postId) setPostId(incoming.postId)
    if (incoming.compose) {
      setTab('contest')
      if (incoming.campaignId && campaign?.id !== incoming.campaignId) setIntentError('해당 공모의 접수가 종료되었거나 현재 공모가 바뀌었어요.')
      else { setEditing(null); setCompose('contest') }
    }
    setIncoming(null)
  }, [incoming, currentContext, campaign?.id])
  useEffect(() => {
    if (!pending || !userId || !canRead) return
    if (pending.category === 'contest' && pending.campaignId && pending.campaignId !== campaign?.id) {
      setTab('contest'); setIntentError('작성하던 공모가 현재 공모와 달라요. 이전 초안은 이 기기에 보관되어 있어요.')
      setPending(null); rememberCompose(null); return
    }
    if (pending.anonymous) transferGuestDraft(userId, pending.category, pending.campaignId)
    useUiStore.getState().closeSettings()
    setCompose(pending.category); setEditing(null); setPending(null); rememberCompose(null)
  }, [pending, userId, canRead, campaign?.id])

  const more = async (): Promise<void> => {
    if (loading || !cursor || tab === 'operator') return
    const sequence = listSequence.current
    setLoading(true); setListError(null)
    try {
      const data = await communityRequest('posts', { ...(tab === 'all' ? {} : { category: tab }), cursor })
      if (sequence === listSequence.current) { setPosts(current => [...current, ...data.posts.filter(post => !current.some(item => item.id === post.id))]); setCursor(data.nextCursor) }
    } catch (failure) { if (sequence === listSequence.current) setListError(communityError(failure)) }
    finally { if (sequence === listSequence.current) setLoading(false) }
  }
  const composeLogin = (): void => {
    if (!compose) return
    const value: PendingCompose = { category: compose, ...(compose === 'contest' && campaign ? { campaignId: campaign.id } : {}), anonymous: !userId }
    setPending(value); rememberCompose(value); setCompose(null); login()
  }
  return <main className="community" aria-label="반달 커뮤니티"><div className="community__content">
    <header className="community__header"><div><span className="community__eyebrow">반달 공식 커뮤니티</span><h1>함께 만드는 공부</h1><p>나의 공부 경험이 누군가의 다음 공부를 바꿉니다.</p></div><button type="button" className="button button--primary" disabled={!currentContext?.configured} onClick={() => startCompose(tab === 'feedback' ? 'feedback' : tab === 'contest' && campaignAcceptsEntries(campaign) ? 'contest' : 'study')}>글쓰기</button></header>
    <CommunityError message={contextError} retry={refresh} />
    <CommunityError message={intentError} />
    <CampaignBanner campaign={campaign} onCompose={() => startCompose('contest')} onDetails={() => setDetails(true)} />
    <nav className="community__tabs" aria-label="커뮤니티 메뉴">{([['all', '전체'], ...Object.entries(COMMUNITY_CATEGORY_LABELS)] as [Tab, string][]).map(([value, label]) => <button key={value} type="button" aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}{operator && <button type="button" aria-current={tab === 'operator' ? 'page' : undefined} onClick={() => setTab('operator')}>운영</button>}</nav>
    {!currentContext ? !contextError && <p className="community__empty" role="status">커뮤니티를 불러오고 있어요…</p> : !currentContext.configured ? <div className="community__empty"><h3>커뮤니티 연결을 준비하고 있어요</h3><p>준비가 끝나면 이곳에서 함께 공부 이야기를 나눌 수 있어요.</p><button type="button" className="button button--secondary" onClick={refresh}>다시 확인</button></div> : !canRead ? <div className="community__empty"><h3>반달 사용자들과 공부 이야기를 나눠 보세요</h3><p>기존 반달 계정으로 로그인하면 게시글과 댓글을 볼 수 있어요.</p><button type="button" className="button button--primary" onClick={login}>로그인</button></div> : tab === 'operator' ? operator && <OperatorPanel key={userId} campaign={campaign} onSaved={refresh} onPost={setPostId} /> : <>
      <div className="community__section-title"><p className="community__hint">{tab === 'contest' ? '실제로 쓰고 싶은 공부 도구를 네 가지 질문에 담아 주세요.' : tab === 'feedback' ? '궁금한 점을 묻고, 더 나은 공부 경험을 함께 찾아요.' : tab === 'study' ? '나에게 도움이 된 공부 방법을 나눠 주세요.' : '공모 아이디어부터 작은 공부 습관까지, 함께 나누는 공간.'}</p><button type="button" className="community__text-button" onClick={refresh}>새로고침</button></div>
      <CommunityError message={listError} retry={refresh} />
      {loading && posts.length === 0 ? <p className="community__empty" role="status">이야기를 불러오고 있어요…</p> : posts.length === 0 && !listError ? <div className="community__empty"><span className="community__empty-moon" aria-hidden="true">◐</span><h3>{tab === 'contest' ? '어떤 도구가 공부를 바꿀 수 있을까요?' : '첫 공부 이야기를 기다리고 있어요'}</h3><p>{tab === 'contest' && !campaignAcceptsEntries(campaign) ? '접수 일정이 확정되면 참여할 수 있어요. 공부법 공유와 질문은 지금도 환영해요.' : '좋았던 경험도, 막혔던 순간도 좋은 이야기의 시작이에요.'}</p></div> : <div className="community__post-list">{posts.map(post => <button type="button" className="community__post-row" key={post.id} onClick={() => setPostId(post.id)}>
        <span className="community__post-meta"><span>{COMMUNITY_CATEGORY_LABELS[post.category]}</span>{post.pinned && <span className="community__badge">공지</span>}{post.hidden && <span className="community__badge">숨김</span>}{post.award && <span className="community__badge">{post.award}등 수상</span>}{post.developmentStatus && <span className="community__badge">{COMMUNITY_DEVELOPMENT_LABELS[post.developmentStatus]}</span>}</span>
        <strong>{post.title}</strong><span className="community__excerpt">{post.answers?.problem ?? post.body}</span><span className="community__row-bottom"><span>{post.authorName} · {new Date(post.createdAt).toLocaleDateString('ko-KR')}</span><span>공감 {post.reactionCount} · 댓글 {post.commentCount}</span></span>
      </button>)}</div>}
      {cursor && <button type="button" className="button button--secondary community__more" disabled={loading} onClick={() => void more()}>{loading ? '불러오는 중…' : '더 보기'}</button>}
    </>}
    <footer className="community__footer">서로의 공부를 존중해 주세요. 학교·관심사별 커뮤니티는 차근차근 준비할게요.{campaign?.published && <span>공모 발표 · {formatCommunityDate(campaign.resultsAt)}</span>}</footer>
  </div>
    {details && campaign?.published && <CampaignDetails campaign={campaign} onClose={() => setDetails(false)} onCompose={() => startCompose('contest')} />}
    {compose && currentContext?.configured && <ComposeDialog key={`${userId}:${compose}:${editing?.id ?? 'new'}`} category={compose} campaign={campaign} userId={userId} signedIn={canRead} editing={editing} onClose={() => { setCompose(null); setEditing(null) }} onLogin={composeLogin} onSaved={post => { if (liveUser.current !== userId) return; setCompose(null); setEditing(null); setPostId(post.id); setTab(post.category); refresh() }} />}
    {postId && canRead && <PostDialog key={`${userId}:${postId}`} id={postId} userId={userId} signedIn={canRead} operator={operator} onClose={() => setPostId(null)} onLogin={login} onEdit={post => { setPostId(null); setEditing(post); setCompose(post.category) }} onChanged={refresh} />}
  </main>
}
