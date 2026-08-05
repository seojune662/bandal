/**
 * The 함께하기 section of the left rail.
 *
 * Three states, and the first one is the important one:
 *
 *  ① `phase === 'unconfigured'` → THIS COMPONENT RENDERS NOTHING. Not a
 *     disabled button, not a "coming soon" card — absent. A build without
 *     Supabase keys has no community feature, and advertising one that cannot
 *     work is worse than silence (docs/phase2-community.md §1.4-4).
 *  ② signed out → one login card, one button. The "그룹 만들기" affordance still
 *     appears under a course and routes here, because hiding it costs
 *     discoverability for everyone who has not signed in yet.
 *  ③ signed in → the group list with unread badges, "코드로 참여", and pending
 *     invites.
 *
 * ★ 1-CLICK GROUP CREATION (§5.1). Clicking 함께 on a course creates the group
 * immediately with the course's name and color, copies the invite code to the
 * clipboard and opens the tab. There is NO dialog: asking for a name and a
 * color is 2–3 extra steps to confirm a default that is right ~99% of the
 * time. The mistake guard is an undo action in the toast (0 steps), not a
 * confirmation prompt (1 step, every time, forever).
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  AuthSignInResult,
  AuthState
} from '../../../../shared/types/auth'
import type { GroupSummary } from '../../../../shared/types/group'
import { Icon } from '../../app/icons'
import { showToast, showToastWithAction } from '../../app/toast'
import { normalizeCourseColor } from '../courses/courseColors'
import { useAuthStore } from '../../stores/authStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { useGroupsStore } from '../../stores/groupsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { GroupIcon } from './groupIcons'
import { JoinCodeOverlay } from './JoinCodeOverlay'
import './group.css'

interface GroupRowProps {
  group: GroupSummary
  onOpen: (groupId: string) => void
}

function GroupRow({ group, onOpen }: GroupRowProps): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="group-row"
        onClick={() => onOpen(group.id)}
      >
        <span
          className="course-dot"
          data-course-color={normalizeCourseColor(group.color)}
        />
        <span className="group-row__name">{group.name}</span>
        {group.unread > 0 && (
          <span
            className="group-row__badge"
            aria-label={`읽지 않은 메시지 ${group.unread}개`}
          >
            {group.unread > 99 ? '99+' : group.unread}
          </span>
        )}
      </button>
    </li>
  )
}

/** Typed refusals from `auth:signIn` — never thrown, so never a try/catch. */
function signInRefusalMessage(
  reason: Extract<AuthSignInResult, { ok: false }>['reason']
): string {
  switch (reason) {
    case 'not-configured':
    case 'oauth-not-wired':
      return '아직 함께하기를 쓸 수 없어요.'
    case 'already-signed-in':
      return '이미 로그인돼 있어요.'
    case 'network':
      return '연결이 안 됐어요. 잠시 후 다시 시도해요.'
    default:
      return '로그인 창을 열지 못했어요. 다시 시도해요.'
  }
}

interface SignInCardProps {
  phase: AuthState['phase']
  errorCode: AuthState['errorCode']
  onSignIn: () => void
}

/** What the login card says while the system browser has the ball. */
function signInHint(
  phase: AuthState['phase'],
  errorCode: AuthState['errorCode']
): string {
  if (phase === 'signing-in') return '브라우저에서 로그인을 마치면 돌아와요'
  if (phase === 'error') {
    return errorCode === 'network'
      ? '연결이 안 됐어요. 잠시 후 다시 시도해요.'
      : '로그인을 마치지 못했어요. 다시 시도해요.'
  }
  if (errorCode === 'oauth-cancelled') return '로그인을 취소했어요'
  return '친구들과 같이 하려면 로그인해요'
}

function SignInCard({
  phase,
  errorCode,
  onSignIn
}: SignInCardProps): JSX.Element {
  // 'signing-in' keeps the button live on purpose: if the browser never opened
  // (or the tab was closed), pressing 로그인 again is the only way out, and a
  // disabled button would leave the section permanently stuck.
  const waiting = phase === 'signing-in'
  return (
    <div className="group-signin">
      <p className="group-signin__text" role={waiting ? 'status' : undefined}>
        {signInHint(phase, errorCode)}
      </p>
      <button type="button" className="button button--primary" onClick={onSignIn}>
        <GroupIcon name="logIn" />
        {waiting ? '다시 열기' : phase === 'error' ? '다시 시도' : '로그인'}
      </button>
    </div>
  )
}

export function TogetherSection(): JSX.Element | null {
  const auth = useAuthStore((state) => state.auth)
  const initAuth = useAuthStore((state) => state.init)
  const signIn = useAuthStore((state) => state.signIn)

  const groups = useGroupsStore((state) => state.groups)
  const pendingInvites = useGroupsStore((state) => state.pendingInvites)
  const initGroups = useGroupsStore((state) => state.init)
  const createGroup = useGroupsStore((state) => state.createGroup)
  const joinWithCode = useGroupsStore((state) => state.joinWithCode)
  const leaveGroup = useGroupsStore((state) => state.leaveGroup)
  const respondInvite = useGroupsStore((state) => state.respondInvite)

  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const courses = useCoursesStore((state) => state.courses)
  const openTab = useWorkspaceStore((state) => state.openTab)

  const [joinOpen, setJoinOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void initAuth()
  }, [initAuth])

  const signedIn = auth.phase === 'signed-in'

  useEffect(() => {
    if (signedIn) void initGroups()
  }, [initGroups, signedIn])

  const openGroup = useCallback(
    (groupId: string) => {
      openTab(descriptorFor('group-chat', { groupId }))
    },
    [openTab]
  )

  /** §5.1 — one click, no dialog, code already on the clipboard. */
  const createForSelectedCourse = useCallback(async () => {
    const course = courses.find((entry) => entry.id === selectedCourseId)
    if (course === undefined || creating) return
    setCreating(true)
    try {
      const result = await createGroup({
        name: course.name,
        color: course.color,
        courseId: course.id
      })
      await navigator.clipboard.writeText(result.invite.code).catch(() => {
        // Clipboard may be denied; the code is still shown in the toast.
      })
      openGroup(result.group.id)
      // Undo lives in the toast rather than a confirm dialog: it costs zero
      // steps on the happy path and is the only guard a 1-step flow can
      // afford. Leaving a group you are alone in soft-deletes it server-side.
      showToastWithAction(
        `코드 ${result.invite.code} 복사됐어요 · 카톡에 붙여넣으면 돼요`,
        {
          label: '되돌리기',
          run: () => {
            void leaveGroup(result.group.id)
              .then(() => showToast('그룹을 되돌렸어요.'))
              .catch(() => showToast('되돌리지 못했어요.', 'danger'))
          }
        }
      )
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '그룹을 만들지 못했어요.',
        'danger'
      )
    } finally {
      setCreating(false)
    }
  }, [courses, createGroup, creating, leaveGroup, openGroup, selectedCourseId])

  // ① Unconfigured build → the section does not exist at all.
  if (auth.phase === 'unconfigured') return null

  return (
    <section className="rail-section" aria-label="함께하기">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">TOGETHER</p>
          <h2>함께하기</h2>
        </div>
        {signedIn && (
          <button
            type="button"
            className="bare-icon-button"
            aria-label="코드로 참여"
            title="코드로 참여"
            onClick={() => setJoinOpen(true)}
          >
            <GroupIcon name="ticket" />
          </button>
        )}
      </div>

      {!signedIn ? (
        <SignInCard
          phase={auth.phase}
          errorCode={auth.errorCode}
          onSignIn={() => {
            void signIn('google').then((result) => {
              // `ok: true` only means the browser opened — the session lands
              // later, over `auth:changed`, when the deep link comes back.
              if (result.ok) return
              showToast(signInRefusalMessage(result.reason))
            })
          }}
        />
      ) : (
        <>
          {pendingInvites.length > 0 && (
            <ul className="group-invites">
              {pendingInvites.map((invite) => (
                <li key={invite.inviteId} className="group-invites__row">
                  <span>
                    <strong>{invite.inviterNickname}</strong>님이{' '}
                    {invite.groupName}에 초대했어요
                  </span>
                  <span className="group-invites__actions">
                    <button
                      type="button"
                      onClick={() => void respondInvite(invite.inviteId, true)}
                    >
                      수락
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondInvite(invite.inviteId, false)}
                    >
                      거절
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {groups.length === 0 ? (
            <div className="group-empty-rail">
              <p>아직 함께하는 그룹이 없어요</p>
              <button
                type="button"
                className="empty-state__alt"
                onClick={() => setJoinOpen(true)}
              >
                코드로 참여
              </button>
            </div>
          ) : (
            <ul className="group-list">
              {groups.map((group) => (
                <GroupRow key={group.id} group={group} onOpen={openGroup} />
              ))}
            </ul>
          )}

          {selectedCourseId !== null && (
            <button
              type="button"
              className="group-create"
              disabled={creating}
              onClick={() => void createForSelectedCourse()}
            >
              <Icon name="plus" />이 과목으로 그룹 만들기
            </button>
          )}
        </>
      )}

      <JoinCodeOverlay
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoin={joinWithCode}
        onJoined={(groupId, alreadyMember) => {
          setJoinOpen(false)
          openGroup(groupId)
          showToast(alreadyMember ? '이미 들어가 있는 그룹이에요.' : '참여했어요!')
        }}
      />
    </section>
  )
}

/** Exposed so a course context menu can leave a group without opening its tab. */
export async function leaveGroupWithToast(groupId: string): Promise<void> {
  try {
    await useGroupsStore.getState().leaveGroup(groupId)
    showToast('그룹에서 나왔어요.')
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : '나가지 못했어요.',
      'danger'
    )
  }
}
