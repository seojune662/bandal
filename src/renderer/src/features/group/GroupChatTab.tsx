/**
 * Together tab — a dockview panel keyed by course. In-panel switchers choose
 * the chat/whiteboard view and the course group currently in focus.
 *
 * Layout mirrors `ChatTab`: gate states first, then banner → scroller →
 * composer. The two additions over the AI tutor tab are the member rail with
 * presence and the non-modal "link this group to a course" bar — non-modal
 * because a modal would make joining a 3-step flow and the user may not even
 * have created the course yet (§5.2).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type {
  GroupChatTabPayload,
  TabDescriptor
} from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import {
  selectGroupsForCourse,
  useGroupsStore
} from '../../stores/groupsStore'
import { GroupWhiteboardView } from '../whiteboard/WhiteboardTab'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { ConnectionBanner } from './ConnectionBanner'
import { GroupComposer, type GroupComposerHandle } from './GroupComposer'
import { GroupIcon } from './groupIcons'
import { GroupMessageList } from './GroupMessageList'
import { InvitePalette } from './InvitePalette'
import { MemberList } from './MemberList'
import { useGroupChat } from './useGroupChat'
import './group.css'
import './groupNavigation.css'
import { BandalMark } from '../../components/BandalMark'

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
      <BandalMark size={56} className="group-empty__moon" />
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
      <BandalMark size={56} className="group-empty__moon" />
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
      <BandalMark size={56} className="group-empty__moon" />
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
  showCourseLink: boolean
  onCloseTab: () => void
}

function GroupChatSurface({
  groupId,
  showCourseLink,
  onCloseTab
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
          <BandalMark size={56} className="group-loading__moon" />
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
          <BandalMark size={56} className="group-empty__moon" />
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

      {showCourseLink && <CourseLinkBar groupId={groupId} />}
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

interface CourseGroupPanelProps {
  requestPayload: GroupChatTabPayload
  api: IDockviewPanelProps['api']
}

function CourseGroupPanel({
  requestPayload,
  api
}: CourseGroupPanelProps): JSX.Element {
  const { courseId, groupId: initialGroupId } = requestPayload
  const initialView = requestPayload.view ?? 'chat'
  const allGroups = useGroupsStore((state) => state.groups)
  const initGroups = useGroupsStore((state) => state.init)
  const groups = useMemo(
    () => selectGroupsForCourse(allGroups, courseId),
    [allGroups, courseId]
  )
  const course = useCoursesStore((state) =>
    courseId === null
      ? undefined
      : state.courses.find((entry) => entry.id === courseId)
  )
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(() =>
    initialGroupId ?? groups[0]?.id ?? null
  )
  const [view, setView] = useState<'chat' | 'whiteboard'>(initialView)
  const [loadingGroups, setLoadingGroups] = useState(groups.length === 0)

  // The tab is keyed by course, so clicking a DIFFERENT group in the rail
  // reuses this panel — dockview hands the new groupId down through params
  // rather than remounting. Without this the click would only focus the tab
  // and keep showing the previously selected group.
  useEffect(() => {
    if (initialGroupId !== undefined) {
      setSelectedGroupId(initialGroupId)
    }
  }, [initialGroupId, requestPayload])

  // Reopening this course singleton with another entry-point updates params
  // instead of remounting the panel. Mirror the groupId synchronization so a
  // whiteboard affordance can focus an existing chat tab and change its view.
  useEffect(() => {
    setView(initialView)
  }, [initialView, requestPayload])

  useEffect(() => {
    let cancelled = false
    void initGroups().finally(() => {
      if (!cancelled) setLoadingGroups(false)
    })
    return () => {
      cancelled = true
    }
  }, [initGroups])

  const activeGroupId = groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : (groups[0]?.id ?? null)
  const activeUnread =
    groups.find((group) => group.id === activeGroupId)?.unread ?? 0

  useEffect(() => {
    if (groups.length > 0 && selectedGroupId !== activeGroupId) {
      setSelectedGroupId(activeGroupId)
    } else if (
      !loadingGroups &&
      groups.length === 0 &&
      selectedGroupId !== null
    ) {
      setSelectedGroupId(null)
    }
  }, [activeGroupId, groups.length, loadingGroups, selectedGroupId])

  useEffect(() => {
    api.setTitle(courseId === null ? '과목 미지정' : (course?.name ?? '함께하기'))
  }, [api, course?.name, courseId])

  const onCloseTab = useCallback(() => {
    api.close()
  }, [api])

  if (activeGroupId === null) {
    if (loadingGroups) {
      return (
        <div className="group-tab">
          <div className="group-loading" role="status" aria-label="그룹 불러오는 중">
            <BandalMark size={56} className="group-loading__moon" />
          </div>
        </div>
      )
    }

    return (
      <div className="group-tab">
        <div className="group-empty">
          <BandalMark size={56} className="group-empty__moon" />
          <h2 className="group-empty__title">이 과목에는 아직 그룹이 없어요</h2>
          <p className="group-empty__desc">
            {courseId === null
              ? '사이드바 아래에서 초대 코드로 그룹에 참여해 보세요.'
              : '사이드바에서 이 과목의 그룹을 만들거나 초대 코드로 참여해 보세요.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="group-course-panel">
      <div className="group-view-switcher" role="group" aria-label="함께하기 보기">
        <button
          type="button"
          className="group-view-switcher__item"
          aria-pressed={view === 'chat'}
          onClick={() => setView('chat')}
        >
          채팅
          {activeUnread > 0 && (
            <span
              className="group-view-switcher__badge"
              aria-label={`읽지 않은 메시지 ${activeUnread}개`}
            >
              {activeUnread > 99 ? '99+' : activeUnread}
            </span>
          )}
        </button>
        <button
          type="button"
          className="group-view-switcher__item"
          aria-pressed={view === 'whiteboard'}
          onClick={() => setView('whiteboard')}
        >
          화이트보드
        </button>
      </div>

      {groups.length > 1 && (
        <div className="group-switcher" role="group" aria-label="그룹 선택">
          {groups.map((group) => {
            const selected = group.id === activeGroupId
            return (
              <button
                key={group.id}
                type="button"
                className="group-switcher__item"
                aria-pressed={selected}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <span className="group-switcher__name">{group.name}</span>
                {group.unread > 0 && (
                  <span
                    className="group-switcher__badge"
                    aria-label={`읽지 않은 메시지 ${group.unread}개`}
                  >
                    {group.unread > 99 ? '99+' : group.unread}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Mount only the visible surface: each surface owns subscriptions or
          polling whose effect cleanup must run as soon as the user switches. */}
      {view === 'chat' ? (
        <GroupChatSurface
          key={activeGroupId}
          groupId={activeGroupId}
          showCourseLink={courseId === null}
          onCloseTab={onCloseTab}
        />
      ) : (
        <GroupWhiteboardView
          key={activeGroupId}
          groupId={activeGroupId}
          api={api}
        />
      )}
    </div>
  )
}

export default function GroupChatTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)

  if (descriptor === null || descriptor.kind !== 'group-chat') {
    return <div className="group-tab" data-kind="unknown" />
  }
  return (
    <CourseGroupPanel
      requestPayload={descriptor.payload}
      api={props.api}
    />
  )
}
