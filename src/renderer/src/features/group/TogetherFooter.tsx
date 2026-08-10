import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AuthSignInResult,
  AuthState
} from '../../../../shared/types/auth'
import { showToast } from '../../app/toast'
import { useAuthStore } from '../../stores/authStore'
import {
  selectGroupsForCourse,
  useGroupsStore
} from '../../stores/groupsStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { GroupIcon } from './groupIcons'
import { GroupListRow } from './GroupListRow'
import { JoinCodeOverlay } from './JoinCodeOverlay'
import './group.css'
import './groupNavigation.css'

/** Typed refusals from `auth:signIn` — never thrown. */
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

interface SignInCardProps {
  phase: AuthState['phase']
  errorCode: AuthState['errorCode']
  onSignIn: () => void
}

interface TogetherEntryCardProps {
  restoring: boolean
  onOpen: () => void
}

function TogetherEntryCard({
  restoring,
  onOpen
}: TogetherEntryCardProps): JSX.Element {
  return (
    <div className="group-signin">
      <p className="group-signin__text" role={restoring ? 'status' : undefined}>
        {restoring
          ? '함께하기를 불러오고 있어요'
          : '친구들과 공부하는 공간을 열어 보세요'}
      </p>
      <button
        type="button"
        className="button button--primary"
        disabled={restoring}
        onClick={onOpen}
      >
        <GroupIcon name="userPlus" />
        {restoring ? '여는 중…' : '함께하기 시작하기'}
      </button>
    </div>
  )
}

function SignInCard({
  phase,
  errorCode,
  onSignIn
}: SignInCardProps): JSX.Element {
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

/** Global Together controls plus the course-unassigned group bucket. */
export function TogetherFooter(): JSX.Element | null {
  const auth = useAuthStore((state) => state.auth)
  const hydrated = useAuthStore((state) => state.hydrated)
  const initializing = useAuthStore((state) => state.initializing)
  const initAuth = useAuthStore((state) => state.init)
  const signIn = useAuthStore((state) => state.signIn)
  const allGroups = useGroupsStore((state) => state.groups)
  const pendingInvites = useGroupsStore((state) => state.pendingInvites)
  const initGroups = useGroupsStore((state) => state.init)
  const joinWithCode = useGroupsStore((state) => state.joinWithCode)
  const respondInvite = useGroupsStore((state) => state.respondInvite)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const [joinOpen, setJoinOpen] = useState(false)
  const signedIn = auth.phase === 'signed-in'
  const unassignedGroups = useMemo(
    () => selectGroupsForCourse(allGroups, null),
    [allGroups]
  )

  useEffect(() => {
    if (signedIn) void initGroups()
  }, [initGroups, signedIn])

  const openGroup = useCallback(
    (groupId: string) => {
      openTab(
        descriptorFor('group-chat', {
          courseId: null,
          groupId,
          view: 'chat'
        })
      )
    },
    [openTab]
  )

  const openWhiteboard = useCallback(
    (groupId: string) => {
      openTab(
        descriptorFor('group-chat', {
          courseId: null,
          groupId,
          view: 'whiteboard'
        })
      )
    },
    [openTab]
  )

  const openJoinedGroup = useCallback(
    (groupId: string) => {
      const joined = useGroupsStore
        .getState()
        .groups.find((group) => group.id === groupId)
      openTab(
        descriptorFor('group-chat', {
          courseId: joined?.courseId ?? null,
          groupId,
          view: 'chat'
        })
      )
    },
    [openTab]
  )

  // `unconfigured` is also the safe pre-restore placeholder. Do not interpret
  // it as signed-out (or touch safeStorage) until the student enters Together.
  if (!hydrated) {
    return (
      <section className="together-footer" aria-label="함께하기">
        <TogetherEntryCard
          restoring={initializing}
          onOpen={() => void initAuth()}
        />
      </section>
    )
  }

  if (auth.phase === 'unconfigured') return null

  return (
    <section className="together-footer" aria-label="함께하기">
      {!signedIn ? (
        <SignInCard
          phase={auth.phase}
          errorCode={auth.errorCode}
          onSignIn={() => {
            void signIn('google').then((result) => {
              if (!result.ok) showToast(signInRefusalMessage(result.reason))
            })
          }}
        />
      ) : (
        <>
          <div className="together-footer__actions">
            <span className="together-footer__label">함께하기</span>
            <button
              type="button"
              className="together-footer__join"
              onClick={() => setJoinOpen(true)}
            >
              <GroupIcon name="ticket" />
              코드로 참여
            </button>
          </div>

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

          {unassignedGroups.length > 0 && (
            <div>
              <p className="together-footer__label">과목 미지정</p>
              <ul className="group-list">
                {unassignedGroups.map((group) => (
                  <GroupListRow
                    key={group.id}
                    group={group}
                    onOpen={openGroup}
                    onOpenWhiteboard={openWhiteboard}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <JoinCodeOverlay
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoin={joinWithCode}
        onJoined={(groupId, alreadyMember) => {
          setJoinOpen(false)
          openJoinedGroup(groupId)
          showToast(alreadyMember ? '이미 들어가 있는 그룹이에요.' : '참여했어요!')
        }}
      />
    </section>
  )
}
