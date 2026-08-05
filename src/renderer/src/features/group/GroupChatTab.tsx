/**
 * Group chat tab — a dockview panel keyed by `group-chat:${groupId}`, which
 * gives per-group singleton behaviour for free (tabIdentity §4.7).
 *
 * Layout mirrors `ChatTab`: gate states first, then banner → scroller →
 * composer. The two additions over the AI tutor tab are the member rail with
 * presence and the non-modal "link this group to a course" bar — non-modal
 * because a modal would make joining a 3-step flow and the user may not even
 * have created the course yet (§5.2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { TabDescriptor } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useGroupsStore } from '../../stores/groupsStore'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { ConnectionBanner } from './ConnectionBanner'
import { GroupComposer, type GroupComposerHandle } from './GroupComposer'
import { GroupIcon } from './groupIcons'
import { GroupMessageList } from './GroupMessageList'
import { InvitePalette } from './InvitePalette'
import { MemberList } from './MemberList'
import { useGroupChat } from './useGroupChat'
import './group.css'

const SCROLL_PIN_THRESHOLD_PX = 48
const LOAD_OLDER_THRESHOLD_PX = 120

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) return null
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

// -- empty states -------------------------------------------------------------

/** ① Brand-new group: nobody else has joined yet. */
function EmptyInviteState({ onInvite }: { onInvite: () => void }): JSX.Element {
  return (
    <div className="group-empty">
      <span className="group-empty__moon" aria-hidden="true" />
      <h2 className="group-empty__title">아직 나 혼자예요</h2>
      <p className="group-empty__desc">
        초대 코드를 카톡에 붙여넣으면 바로 들어와요.
      </p>
      <button type="button" className="button button--primary" onClick={onInvite}>
        <GroupIcon name="userPlus" />
        초대하기
      </button>
    </div>
  )
}

/** ② Members present, no messages yet. */
function EmptyConversationState(): JSX.Element {
  return (
    <div className="group-empty">
      <span className="group-empty__moon" aria-hidden="true" />
      <h2 className="group-empty__title">첫 메시지를 남겨보세요</h2>
      <p className="group-empty__desc">
        과제 일정이나 역할 나누기부터 시작하면 좋아요.
      </p>
    </div>
  )
}

/** ③ The tab outlived the membership (left the group, or signed out). */
function UnknownGroupState({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div className="group-empty">
      <span className="group-empty__moon" aria-hidden="true" />
      <h2 className="group-empty__title">더 이상 볼 수 없는 그룹이에요</h2>
      <p className="group-empty__desc">
        나갔거나, 그룹이 사라졌거나, 로그아웃 상태예요.
      </p>
      <button type="button" className="empty-state__alt" onClick={onClose}>
        탭 닫기
      </button>
    </div>
  )
}

// -- course link bar ----------------------------------------------------------

function CourseLinkBar({ groupId }: { groupId: string }): JSX.Element | null {
  const courses = useCoursesStore((state) => state.courses)
  const linkCourse = useGroupsStore((state) => state.linkCourse)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || courses.length === 0) return null

  return (
    <div className="group-linkbar" role="region" aria-label="과목 연결">
      <span>이 그룹을 과목에 연결할까요?</span>
      <label className="sr-only" htmlFor={`group-link-${groupId}`}>
        연결할 과목
      </label>
      <select
        id={`group-link-${groupId}`}
        defaultValue=""
        onChange={(event) => {
          const courseId = event.target.value
          if (courseId === '') return
          void linkCourse(groupId, courseId)
            .then(() => {
              setDismissed(true)
              showToast('과목에 연결했어요.')
            })
            .catch(() => {
              showToast('연결하지 못했어요.', 'danger')
            })
        }}
      >
        <option value="" disabled>
          과목 선택
        </option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setDismissed(true)}>
        나중에
      </button>
    </div>
  )
}

// -- surface ------------------------------------------------------------------

interface GroupChatSurfaceProps {
  groupId: string
  onCloseTab: () => void
  onTitle: (title: string) => void
}

function GroupChatSurface({
  groupId,
  onCloseTab,
  onTitle
}: GroupChatSurfaceProps): JSX.Element {
  const session = useGroupChat(groupId)
  const [draft, setDraft] = useState('')
  const [invitePaletteOpen, setInvitePaletteOpen] = useState(false)
  const [blockedUserIds, setBlockedUserIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const composerRef = useRef<GroupComposerHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true)

  const { state, phase, group, myUserId } = session

  // The panel title lives in the local cache, so it is only known once the
  // (network-free) open resolves — see tabIdentity's note on purity.
  useEffect(() => {
    if (group !== null) onTitle(group.name)
  }, [group, onTitle])

  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller !== null && isPinnedRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
  }, [state.messages, state.pending])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    const distance =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    isPinnedRef.current = distance < SCROLL_PIN_THRESHOLD_PX
    if (scroller.scrollTop < LOAD_OLDER_THRESHOLD_PX) session.loadOlder()
  }, [session])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (text === '') return
    setDraft('')
    isPinnedRef.current = true
    session.send(text)
  }, [draft, session])

  const handleBlock = useCallback((userId: string) => {
    setBlockedUserIds((current) => new Set([...current, userId]))
    void invoke('safety:block', { userId, blocked: true })
      .then(() => showToast('차단했어요. 상대는 알 수 없어요.'))
      .catch(() => showToast('차단하지 못했어요.', 'danger'))
  }, [])

  const handleKick = useCallback(
    (userId: string) => {
      void invoke('groups:kick', { groupId, userId })
        .then(() => showToast('내보냈어요.'))
        .catch(() => showToast('내보내지 못했어요.', 'danger'))
    },
    [groupId]
  )

  const handleReport = useCallback((messageId: string) => {
    void invoke('safety:report', {
      targetType: 'message',
      targetId: messageId,
      reason: '사용자 신고'
    })
      .then(() => showToast('신고를 접수했어요.'))
      .catch(() => showToast('신고하지 못했어요.', 'danger'))
  }, [])

  const canManage = useMemo(() => {
    const me = state.members.find((member) => member.userId === myUserId)
    return me?.role === 'owner' || me?.role === 'admin'
  }, [myUserId, state.members])

  const onlineCount = state.onlineUserIds.length

  if (phase === 'loading') {
    return (
      <div className="group-tab">
        <div className="group-loading" role="status" aria-label="불러오는 중">
          <span className="group-loading__moon" />
        </div>
      </div>
    )
  }

  if (phase === 'unknown-group') {
    return (
      <div className="group-tab">
        <UnknownGroupState onClose={onCloseTab} />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="group-tab">
        <div className="group-empty">
          <span className="group-empty__moon" aria-hidden="true" />
          <h2 className="group-empty__title">그룹 채팅을 열지 못했어요</h2>
          <p className="group-empty__desc">{session.openError}</p>
          <button
            type="button"
            className="empty-state__alt"
            onClick={session.refresh}
          >
            <Icon name="refresh" />
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  const isAlone = state.members.length <= 1
  const isEmpty = state.messages.length === 0 && state.pending.length === 0

  return (
    <div className="group-tab">
      <header className="group-head">
        <div className="group-head__title">
          <h2>{group?.name ?? '그룹 채팅'}</h2>
          {onlineCount > 0 && (
            <span className="group-head__presence">{onlineCount}명 접속 중</span>
          )}
        </div>
        <button
          type="button"
          className="group-head__action"
          onClick={() => setInvitePaletteOpen(true)}
        >
          <GroupIcon name="userPlus" />
          초대
        </button>
      </header>

      {group?.courseId == null && <CourseLinkBar groupId={groupId} />}
      <ConnectionBanner state={state.connection} />

      <div className="group-body">
        <div ref={scrollRef} className="group-scroll" onScroll={handleScroll}>
          {session.isLoadingOlder && (
            <p className="group-scroll__more" role="status">
              이전 메시지를 불러오는 중…
            </p>
          )}
          {isEmpty ? (
            isAlone ? (
              <EmptyInviteState onInvite={() => setInvitePaletteOpen(true)} />
            ) : (
              <EmptyConversationState />
            )
          ) : (
            <GroupMessageList
              messages={state.messages}
              pending={state.pending}
              members={state.members}
              myUserId={myUserId}
              blockedUserIds={blockedUserIds}
              onRetry={session.retry}
              onDelete={session.deleteMessage}
              onReport={handleReport}
            />
          )}
        </div>

        <MemberList
          members={state.members}
          onlineUserIds={state.onlineUserIds}
          myUserId={myUserId}
          canManage={canManage}
          onKick={handleKick}
          onBlock={handleBlock}
          onInvite={() => setInvitePaletteOpen(true)}
        />
      </div>

      <GroupComposer
        ref={composerRef}
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        connection={state.connection}
        cooldown={state.sendCooldown}
      />

      <InvitePalette
        open={invitePaletteOpen}
        groupId={groupId}
        onClose={() => setInvitePaletteOpen(false)}
        onInvited={(nickname, status) => {
          showToast(
            status === 'already_member'
              ? `${nickname}님은 이미 멤버예요.`
              : status === 'already_pending'
                ? `${nickname}님에게 이미 초대를 보냈어요.`
                : `${nickname}님을 초대했어요.`
          )
          session.refreshMembers()
        }}
      />
    </div>
  )
}

export default function GroupChatTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  const api = props.api

  const onTitle = useCallback(
    (title: string) => {
      api.setTitle(title)
    },
    [api]
  )
  const onCloseTab = useCallback(() => {
    api.close()
  }, [api])

  if (descriptor === null || descriptor.kind !== 'group-chat') {
    return <div className="group-tab" data-kind="unknown" />
  }
  return (
    <GroupChatSurface
      groupId={descriptor.payload.groupId}
      onCloseTab={onCloseTab}
      onTitle={onTitle}
    />
  )
}
