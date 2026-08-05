/**
 * Message list for group chat.
 *
 * Three rendering decisions worth stating:
 *  1. Consecutive messages from the same author within 5 minutes are GROUPED —
 *     the avatar and name print once. Without it a 3-line reply becomes three
 *     stacked headers and the thread stops being readable.
 *  2. Deleted messages keep their slot as "삭제된 메시지". Removing the row
 *     would shift everything the reader was looking at.
 *  3. Pending bubbles render after every committed message because they have
 *     no `seq` yet — that is the honest position, not a styling choice (§4.4).
 */

import { memo } from 'react'
import type { GroupMember } from '../../../../shared/types/group'
import { Icon } from '../../app/icons'
import { GroupAvatar } from './GroupAvatar'
import { GroupIcon } from './groupIcons'
import {
  systemMessageText,
  type CommittedMessageView,
  type PendingMessageView
} from './groupModel'

const GROUPING_WINDOW_MS = 5 * 60 * 1000

function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

function sameBurst(
  previous: CommittedMessageView | undefined,
  current: CommittedMessageView
): boolean {
  if (previous === undefined) return false
  if (previous.messageKind === 'system' || current.messageKind === 'system') {
    return false
  }
  if (previous.authorId !== current.authorId) return false
  const gap =
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime()
  return Number.isFinite(gap) && gap < GROUPING_WINDOW_MS
}

interface CommittedRowProps {
  message: CommittedMessageView
  continuation: boolean
  isMine: boolean
  blocked: boolean
  onDelete: (messageId: string) => void
  onReport: (messageId: string) => void
}

const CommittedRow = memo(function CommittedRow({
  message,
  continuation,
  isMine,
  blocked,
  onDelete,
  onReport
}: CommittedRowProps): JSX.Element {
  if (message.messageKind === 'system') {
    return (
      <li className="group-msg group-msg--system">
        <span>{systemMessageText(message.body ?? '', message.authorNickname)}</span>
      </li>
    )
  }

  if (blocked) {
    // Blocking is never revealed to the blocked user, and the reader keeps a
    // way back in — a hard hide would make the thread unreadable (§6.4).
    return (
      <li className="group-msg group-msg--blocked">
        <span>차단한 사용자의 메시지</span>
      </li>
    )
  }

  return (
    <li
      className="group-msg"
      data-mine={isMine || undefined}
      data-continuation={continuation || undefined}
    >
      {!continuation && (
        <GroupAvatar
          emoji={message.authorEmoji}
          color={message.authorColor}
          nickname={message.authorNickname}
        />
      )}
      <div className="group-msg__body">
        {!continuation && (
          <p className="group-msg__meta">
            <span className="group-msg__author">{message.authorNickname}</span>
            <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
          </p>
        )}
        {message.deleted ? (
          <p className="group-msg__text group-msg__text--deleted">
            삭제된 메시지
          </p>
        ) : (
          <p className="group-msg__text">
            {message.body}
            {message.edited && <span className="group-msg__edited">(수정됨)</span>}
          </p>
        )}
      </div>
      {!message.deleted && (
        <div className="group-msg__actions">
          {isMine ? (
            <button
              type="button"
              className="group-msg__action"
              aria-label="메시지 삭제"
              onClick={() => onDelete(message.id)}
            >
              <Icon name="trash" />
            </button>
          ) : (
            <button
              type="button"
              className="group-msg__action"
              aria-label="메시지 신고"
              onClick={() => onReport(message.id)}
            >
              <GroupIcon name="alert" />
            </button>
          )}
        </div>
      )}
    </li>
  )
})

interface PendingRowProps {
  message: PendingMessageView
  onRetry: (localId: string) => void
}

function PendingRow({ message, onRetry }: PendingRowProps): JSX.Element {
  const failed = message.state === 'failed'
  return (
    <li className="group-msg group-msg--pending" data-mine data-failed={failed || undefined}>
      <div className="group-msg__body">
        <p className="group-msg__text">{message.body}</p>
        {failed ? (
          <p className="group-msg__failure" role="status">
            <GroupIcon name="alert" />
            {message.failure === 'rate-limit'
              ? '조금만 천천히 보내요'
              : message.failure === 'rejected'
                ? '보낼 수 없는 메시지예요'
                : '전송하지 못했어요'}
            <button
              type="button"
              className="group-msg__retry"
              onClick={() => onRetry(message.localId)}
            >
              다시 시도
            </button>
          </p>
        ) : (
          <span className="group-msg__sending" aria-label="전송 중">
            ···
          </span>
        )}
      </div>
    </li>
  )
}

interface GroupMessageListProps {
  messages: readonly CommittedMessageView[]
  pending: readonly PendingMessageView[]
  members: readonly GroupMember[]
  myUserId: string | null
  blockedUserIds: ReadonlySet<string>
  onRetry: (localId: string) => void
  onDelete: (messageId: string) => void
  onReport: (messageId: string) => void
}

export function GroupMessageList({
  messages,
  pending,
  myUserId,
  blockedUserIds,
  onRetry,
  onDelete,
  onReport
}: GroupMessageListProps): JSX.Element {
  return (
    <ul className="group-msg-list">
      {messages.map((message, index) => (
        <CommittedRow
          key={message.id}
          message={message}
          continuation={sameBurst(messages[index - 1], message)}
          isMine={message.authorId === myUserId}
          blocked={blockedUserIds.has(message.authorId)}
          onDelete={onDelete}
          onReport={onReport}
        />
      ))}
      {pending.map((message) => (
        <PendingRow key={message.localId} message={message} onRetry={onRetry} />
      ))}
    </ul>
  )
}
