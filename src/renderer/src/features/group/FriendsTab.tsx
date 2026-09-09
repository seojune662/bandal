import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { FriendEntry, PublishedCourse } from '../../../../shared/types/group'
import type { TabDescriptor } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useAuthStore } from '../../stores/authStore'
import { useFriendsStore } from '../../stores/friendsStore'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { ConnectionBanner } from './ConnectionBanner'
import { GroupAvatar } from './GroupAvatar'
import { GroupComposer } from './GroupComposer'
import { GroupMessageList } from './GroupMessageList'
import { useGroupChat } from './useGroupChat'
import './friends.css'
import './group.css'

function descriptorFrom(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) return null
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

function DirectConversation({
  friend,
  groupId,
  readOnly,
  onRemove,
  visible,
  onBack
}: {
  friend: FriendEntry
  groupId: string
  readOnly: boolean
  onRemove: () => void
  visible: boolean
  onBack: () => void
}): JSX.Element {
  const [atBottom, setAtBottom] = useState(true)
  const session = useGroupChat(groupId, visible && atBottom)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const olderHeightRef = useRef<number | null>(null)
  useEffect(() => {
    const node = scrollRef.current
    if (node === null) return
    if (olderHeightRef.current !== null && !session.isLoadingOlder) {
      node.scrollTop += node.scrollHeight - olderHeightRef.current
      olderHeightRef.current = null
    } else if (pinnedRef.current) node.scrollTop = node.scrollHeight
  }, [session.state.messages, session.state.pending, session.isLoadingOlder])

  const send = useCallback(() => {
    const body = draft.trim()
    if (body === '') return
    pinnedRef.current = true
    setAtBottom(true)
    setDraft('')
    session.send(body)
  }, [draft, session])

  return (
    <section className="friends-chat">
      <header className="friends-chat__head">
        <button type="button" className="friends-back" aria-label="대화 목록으로" onClick={onBack}><Icon name="chevronLeft" /></button>
        <GroupAvatar emoji={friend.avatarEmoji} color={friend.avatarColor} nickname={friend.nickname} />
        <div><h2>{friend.nickname}</h2><span>{readOnly ? '친구 관계가 끝나 읽기 전용이에요' : '친구와의 1:1 대화'}</span></div>
        <details className="friends-chat__menu"><summary aria-label="대화 메뉴">•••</summary><div>
        {!readOnly && <button type="button" onClick={() => {
          if (window.confirm(`${friend.nickname}님과 친구 관계를 끊을까요? 대화 기록은 남습니다.`)) onRemove()
        }}>친구 삭제</button>}
        <button type="button" onClick={() => {
          if (!window.confirm(`${friend.nickname}님을 차단할까요?`)) return
          void invoke('safety:block', { userId: friend.userId, blocked: true }).then(() => { showToast('차단했어요.'); onBack(); void useFriendsStore.getState().load() }).catch(() => showToast('차단하지 못했어요.', 'danger'))
        }}>차단</button>
        </div></details>
      </header>
      <ConnectionBanner state={session.state.connection} />
      <div ref={scrollRef} className="friends-chat__messages" onScroll={() => {
        const node = scrollRef.current
        if (node === null) return
        const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 64
        pinnedRef.current = bottom
        setAtBottom(bottom)
      }}>
        {session.hasMoreOlder && session.state.messages.length > 0 && <button className="friends-load-older" type="button" disabled={session.isLoadingOlder} onClick={() => {
          olderHeightRef.current = scrollRef.current?.scrollHeight ?? null
          pinnedRef.current = false
          session.loadOlder()
        }}>{session.isLoadingOlder ? '불러오는 중…' : '이전 메시지 보기'}</button>}
        {session.phase === 'loading' ? <p className="friends-placeholder">대화를 불러오는 중…</p> : session.phase === 'error' ? <button type="button" onClick={session.refresh}>다시 시도</button> : session.state.messages.length === 0 && session.state.pending.length === 0 ? <p className="friends-placeholder">첫 메시지를 보내보세요.</p> : (
          <GroupMessageList
            presentation="direct"
            messages={session.state.messages}
            pending={session.state.pending}
            members={session.state.members}
            courseId={null}
            myUserId={session.myUserId}
            blockedUserIds={new Set()}
            onRetry={session.retry}
            onDelete={session.deleteMessage}
            onReport={(messageId) => void invoke('safety:report', { targetType: 'message', targetId: messageId, reason: '사용자 신고' })}
          />
        )}
      </div>
      {!atBottom && <button type="button" className="friends-latest" onClick={() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      }}>최근 메시지로 ↓</button>}
      <GroupComposer value={draft} onChange={setDraft} onSend={send} connection={session.state.connection} cooldown={session.state.sendCooldown} disabled={readOnly || friend.status !== 'accepted'} />
      <p className="friends-composer-hint">Enter로 보내기 · Shift+Enter로 줄바꿈</p>
    </section>
  )
}

export default function FriendsTab(props: IDockviewPanelProps): JSX.Element {
  const auth = useAuthStore((state) => state.auth)
  const initAuth = useAuthStore((state) => state.init)
  const friends = useFriendsStore((state) => state.friends)
  const loading = useFriendsStore((state) => state.loading)
  const error = useFriendsStore((state) => state.error)
  const init = useFriendsStore((state) => state.init)
  const request = useFriendsStore((state) => state.request)
  const respond = useFriendsStore((state) => state.respond)
  const remove = useFriendsStore((state) => state.remove)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [visible, setVisible] = useState(props.api.isVisible)
  useEffect(() => {
    const subscription = props.api.onDidVisibilityChange((event) => setVisible(event.isVisible))
    return () => subscription.dispose()
  }, [props.api])
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const descriptor = descriptorFrom(props.params)
    return descriptor?.kind === 'friends' ? descriptor.payload.friendUserId ?? null : null
  })
  const [groupId, setGroupId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [openAttempt, setOpenAttempt] = useState(0)
  const [courses, setCourses] = useState<PublishedCourse[]>([])
  const [removedFriend, setRemovedFriend] = useState<FriendEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = friends.find((friend) => friend.userId === selectedId) ??
    (removedFriend?.userId === selectedId ? removedFriend : null)
  const selectedIsRemoved = removedFriend?.userId === selectedId &&
    !friends.some((friend) => friend.userId === selectedId)

  useEffect(() => { void initAuth(); if (auth.phase === 'signed-in') void init() }, [auth.phase, init, initAuth])
  useEffect(() => {
    if (selectedIsRemoved) return
    setGroupId(null); setOpenError(null); setCourses([])
    if (selected === null || selected.status !== 'accepted') { setGroupId(null); setCourses([]); return }
    let alive = true
    void Promise.all([
      invoke('directChat:open', { friendUserId: selected.userId }),
      invoke('friends:publishedCourses', { userId: selected.userId }).catch(() => [])
    ]).then(([direct, published]) => {
      if (alive) { setGroupId(direct.groupId); setCourses(published) }
    }).catch((loadError: unknown) => { if (alive) setOpenError(loadError instanceof Error ? loadError.message : '대화를 열지 못했어요.') })
    return () => { alive = false }
  }, [selected?.userId, selected?.status, selectedIsRemoved, openAttempt])

  if (auth.phase !== 'signed-in') return <div className="friends-gate">함께하기에 로그인하면 친구를 추가할 수 있어요.</div>

  return (
    <div className="friends-tab" data-conversation={selected !== null || undefined}>
      <aside className="friends-list">
        <header><div><h2>메시지</h2><span>친구 {friends.filter((friend) => friend.status === 'accepted').length}명</span></div><button type="button" aria-label="친구 추가" aria-expanded={adding} onClick={() => setAdding((v) => !v)}><Icon name="plus" /></button></header>
        <label className="friends-search"><Icon name="search" /><input aria-label="대화 검색" placeholder="대화 찾기" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        {adding && <form onSubmit={(event) => {
          event.preventDefault()
          if (query.trim() === '' || busy) return
          setBusy(true)
          void request(query).then(() => { setQuery(''); showToast('친구 요청을 보냈어요.') }).catch((requestError: unknown) => showToast(requestError instanceof Error ? requestError.message : '친구 요청을 보내지 못했어요.', 'danger')).finally(() => setBusy(false))
        }}>
          <Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="닉네임으로 친구 추가" aria-label="닉네임으로 친구 추가" /><button type="submit" disabled={query.trim() === '' || busy}><Icon name="plus" /></button>
        </form>}
        {loading && friends.length === 0 && <p className="friends-placeholder">불러오는 중…</p>}
        {error !== null && <p className="friends-error">{error}</p>}
        <ul>
          {friends.filter((friend) => friend.nickname.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || a.nickname.localeCompare(b.nickname)).map((friend) => (
            <li key={friend.userId} data-selected={friend.userId === selectedId || undefined}>
              <button type="button" className="friends-person" onClick={() => { setRemovedFriend(null); setSelectedId(friend.userId) }}>
                <GroupAvatar emoji={friend.avatarEmoji} color={friend.avatarColor} nickname={friend.nickname} />
                <span><strong>{friend.nickname}</strong><small>{friend.status === 'accepted' ? (friend.lastMessagePreview ?? '대화를 시작해 보세요') : friend.direction === 'incoming' ? '친구 요청' : '수락 대기 중'}</small></span>
                <span className="friends-person__status">{friend.lastMessageAt && <time dateTime={friend.lastMessageAt}>{new Date(friend.lastMessageAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</time>}{(friend.hasUnread ?? (friend.unread ?? 0) > 0) && <i className="friends-unread" aria-label="읽지 않은 대화" />}</span>
              </button>
              {friend.status === 'pending' && friend.direction === 'incoming' && <div className="friends-request-actions"><button type="button" onClick={() => void respond(friend.userId, true)}>수락</button><button type="button" onClick={() => void respond(friend.userId, false)}>거절</button></div>}
            </li>
          ))}
        </ul>
      </aside>
      {selected === null ? <main className="friends-empty"><span>👋</span><h2>친구를 선택해 주세요</h2><p>공개한 과목을 보고 1:1로 대화할 수 있어요.</p></main> : selected.status !== 'accepted' && !selectedIsRemoved ? <main className="friends-empty"><h2>{selected.nickname}</h2><p>친구 요청이 수락되면 대화를 시작할 수 있어요.</p></main> : (
        <main className="friends-main">
          {courses.length > 0 && <div className="friends-courses"><span>공개한 과목</span>{courses.map((course) => <strong key={course.id}>{course.displayName}</strong>)}</div>}
          {groupId === null ? <div className="friends-placeholder">{openError ? <><p role="alert">{openError}</p><button type="button" onClick={() => setOpenAttempt((value) => value + 1)}>다시 시도</button></> : '대화를 준비하는 중…'}</div> : <DirectConversation key={groupId} friend={selected} groupId={groupId} readOnly={selectedIsRemoved} visible={visible} onBack={() => setSelectedId(null)} onRemove={() => {
            setRemovedFriend(selected)
            void remove(selected.userId).catch((removeError: unknown) => {
              setRemovedFriend(null)
              showToast(removeError instanceof Error ? removeError.message : '친구를 삭제하지 못했어요.', 'danger')
            })
          }} />}
        </main>
      )}
    </div>
  )
}
