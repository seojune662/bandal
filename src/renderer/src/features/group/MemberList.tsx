/**
 * Member roster with presence.
 *
 * Presence is free (channel-level, zero DB writes) and reads as high value —
 * "3명 접속 중" is the whole reason it shipped in P2 while typing indicators
 * did not (§4.6: typing costs ~10× the realtime quota of actual messages).
 *
 * Online members sort first, then by role, so the useful half of the list is
 * always above the fold.
 */

import { useMemo } from 'react'
import type { GroupMember, GroupRole } from '../../../../shared/types/group'
import { GroupAvatar } from './GroupAvatar'
import { GroupIcon } from './groupIcons'

const ROLE_LABEL: Record<GroupRole, string> = {
  owner: '방장',
  admin: '관리자',
  member: ''
}

const ROLE_ORDER: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 }

interface MemberListProps {
  members: readonly GroupMember[]
  onlineUserIds: readonly string[]
  myUserId: string | null
  /** Only owners/admins get the kick affordance. */
  canManage: boolean
  onKick: (userId: string) => void
  onBlock: (userId: string) => void
  onInvite: () => void
}

export function MemberList({
  members,
  onlineUserIds,
  myUserId,
  canManage,
  onKick,
  onBlock,
  onInvite
}: MemberListProps): JSX.Element {
  const online = useMemo(() => new Set(onlineUserIds), [onlineUserIds])

  const sorted = useMemo(
    () =>
      [...members].sort((a, b) => {
        const onlineDelta =
          Number(online.has(b.userId)) - Number(online.has(a.userId))
        if (onlineDelta !== 0) return onlineDelta
        const roleDelta = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
        if (roleDelta !== 0) return roleDelta
        return a.nickname.localeCompare(b.nickname, 'ko')
      }),
    [members, online]
  )

  return (
    <section className="group-members" aria-label="멤버">
      <header className="group-members__head">
        <h3>
          멤버 <span className="group-members__count">{members.length}</span>
        </h3>
        <button
          type="button"
          className="group-members__invite"
          onClick={onInvite}
        >
          <GroupIcon name="userPlus" />
          초대
        </button>
      </header>
      <ul className="group-members__list">
        {sorted.map((member) => {
          const isMine = member.userId === myUserId
          return (
            <li key={member.userId} className="group-members__row">
              <GroupAvatar
                emoji={member.avatarEmoji}
                color={member.avatarColor}
                nickname={member.nickname}
                size="sm"
                online={online.has(member.userId)}
              />
              <span className="group-members__name">{member.nickname}</span>
              {ROLE_LABEL[member.role] !== '' && (
                <span className="group-members__role">
                  {ROLE_LABEL[member.role]}
                </span>
              )}
              {!isMine && (
                <span className="group-members__actions">
                  {canManage && member.role !== 'owner' && (
                    <button
                      type="button"
                      aria-label={`${member.nickname} 내보내기`}
                      onClick={() => onKick(member.userId)}
                    >
                      <GroupIcon name="logOut" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`${member.nickname} 차단`}
                    onClick={() => onBlock(member.userId)}
                  >
                    <GroupIcon name="alert" />
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
