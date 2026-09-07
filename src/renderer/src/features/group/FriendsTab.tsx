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

function descriptorFrom(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) return null
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

function DirectConversation({
  friend,
  groupId,
  readOnly,
  onRemove
}: {
  friend: FriendEntry
  groupId: string
  readOnly: boolean
  onRemove: () => void
}): JSX.Element {
  const session = useGroupChat(groupId)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = scrollRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [session.state.messages, session.state.pending])

  const send = useCallback(() => {
    const body = draft.trim()
    if (body === '') return
    setDraft('')
    session.send(body)
  }, [draft, session])

  return (
    <section className="friends-chat">
      <header className="friends-chat__head">
        <GroupAvatar emoji={friend.avatarEmoji} color={friend.avatarColor} nickname={friend.nickname} />
        <div><h2>{friend.nickname}</h2><span>{readOnly ? '친구 관계가 끝나 읽기 전용이에요' : '친구와의 1:1 대화'}</span></div>
        {!readOnly && <button type="button" onClick={() => {
          if (window.confirm(`${friend.nickname}님과 친구 관계를 끊을까요? 대화 기록은 남습니다.`)) onRemove()
        }}>친구 삭제</button>}
        <button type="button" onClick={() => void invoke('safety:block', { userId: friend.userId, blocked: true }).then(() => showToast('차단했어요.'))}>차단</button>
      </header>
      <ConnectionBanner state={session.state.connection} />
      <div ref={scrollRef} className="friends-chat__messages">
        {session.phase === 'loading' ? <p className="friends-placeholder">대화를 불러오는 중…</p> : session.phase === 'error' ? <button type="button" onClick={session.refresh}>다시 시도</button> : session.state.messages.length === 0 && session.state.pending.length === 0 ? <p className="friends-placeholder">첫 메시지를 보내보세요.</p> : (
          <GroupMessageList
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
      <GroupComposer value={draft} onChange={setDraft} onSend={send} connection={session.state.connection} cooldown={session.state.sendCooldown} disabled={readOnly || friend.status !== 'accepted'} />
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
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const descriptor = descriptorFrom(props.params)
    return descriptor?.kind === 'friends' ? descriptor.payload.friendUserId ?? null : null
  })
  const [groupId, setGroupId] = useState<string | null>(null)
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
    if (selected === null || selected.status !== 'accepted') { setGroupId(null); setCourses([]); return }
    let alive = true
    void Promise.all([
      invoke('directChat:open', { friendUserId: selected.userId }),
      invoke('friends:publishedCourses', { userId: selected.userId })
    ]).then(([direct, published]) => {
      if (alive) { setGroupId(direct.groupId); setCourses(published) }
    }).catch((loadError: unknown) => showToast(loadError instanceof Error ? loadError.message : '대화를 열지 못했어요.', 'danger'))
    return () => { alive = false }
  }, [selected?.userId, selected?.status, selectedIsRemoved])

  if (auth.phase !== 'signed-in') return <div className="friends-gate">함께하기에 로그인하면 친구를 추가할 수 있어요.</div>

  return (
    <div className="friends-tab">
      <aside className="friends-list">
        <header><h2>친구</h2><span>{friends.filter((friend) => friend.status === 'accepted').length}</span></header>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (query.trim() === '' || busy) return
          setBusy(true)
          void request(query).then(() => { setQuery(''); showToast('친구 요청을 보냈어요.') }).catch((requestError: unknown) => showToast(requestError instanceof Error ? requestError.message : '친구 요청을 보내지 못했어요.', 'danger')).finally(() => setBusy(false))
        }}>
          <Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="닉네임으로 친구 추가" aria-label="닉네임으로 친구 추가" /><button type="submit" disabled={query.trim() === '' || busy}><Icon name="plus" /></button>
        </form>
        {loading && friends.length === 0 && <p className="friends-placeholder">불러오는 중…</p>}
        {error !== null && <p className="friends-error">{error}</p>}
        <ul>
          {friends.map((friend) => (
            <li key={friend.userId} data-selected={friend.userId === selectedId || undefined}>
              <button type="button" className="friends-person" onClick={() => { setRemovedFriend(null); setSelectedId(friend.userId) }}>
                <GroupAvatar emoji={friend.avatarEmoji} color={friend.avatarColor} nickname={friend.nickname} />
                <span><strong>{friend.nickname}{(friend.unread ?? 0) > 0 ? ` · ${friend.unread}` : ''}</strong><small>{friend.status === 'accepted' ? '친구' : friend.direction === 'incoming' ? '친구 요청' : '수락 대기 중'}</small></span>
              </button>
              {friend.status === 'pending' && friend.direction === 'incoming' && <div className="friends-request-actions"><button type="button" onClick={() => void respond(friend.userId, true)}>수락</button><button type="button" onClick={() => void respond(friend.userId, false)}>거절</button></div>}
            </li>
          ))}
        </ul>
      </aside>
      {selected === null ? <main className="friends-empty"><span>👋</span><h2>친구를 선택해 주세요</h2><p>공개한 과목을 보고 1:1로 대화할 수 있어요.</p></main> : selected.status !== 'accepted' && !selectedIsRemoved ? <main className="friends-empty"><h2>{selected.nickname}</h2><p>친구 요청이 수락되면 대화를 시작할 수 있어요.</p></main> : (
        <main className="friends-main">
          {courses.length > 0 && <div className="friends-courses"><span>공개한 과목</span>{courses.map((course) => <strong key={course.id}>{course.displayName}</strong>)}</div>}
          {groupId === null ? <p className="friends-placeholder">대화를 준비하는 중…</p> : <DirectConversation friend={selected} groupId={groupId} readOnly={selectedIsRemoved} onRemove={() => {
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
