/**
 * Pure view-model for group chat — an ordered message list derived by folding
 * `GroupEvent`s over immutable state.
 *
 * Deliberately the same architecture as `features/chat/chatModel.ts`: a total
 * reducer, `checkBatchSeq` gap detection, and hydration from a committed
 * snapshot. Everything below is side-effect free and unit tested.
 *
 * The three rules that matter:
 *
 *  1. ORDER IS `seq`, NOT `createdAt`. Client clocks really are wrong, and a
 *     chat that reorders itself is a broken product (§2.7).
 *  2. A LOCAL ECHO HAS NO `seq`, so it always sorts last. When the broadcast
 *     comes back carrying the same id, the echo is REPLACED rather than
 *     appended — client-generated uuids make that a pure id match with no
 *     dedupe heuristics.
 *  3. A DELETED MESSAGE KEEPS ITS SLOT. It renders as "삭제된 메시지"; removing
 *     the row would renumber everything the user was looking at.
 */

import type {
  GroupConnectionState,
  GroupMember,
  GroupMessage,
  PendingGroupMessage
} from '../../../../shared/types/group'
import type {
  GroupEvent,
  LocalEchoFailureReason
} from '../../../../shared/types/group-events'

// -- view types ---------------------------------------------------------------

export interface CommittedMessageView {
  kind: 'committed'
  id: string
  seq: number
  authorId: string
  messageKind: 'text' | 'system'
  body: string | null
  createdAt: string
  edited: boolean
  deleted: boolean
  authorNickname: string
  authorColor: string
  authorEmoji: string
}

export interface PendingMessageView {
  kind: 'pending'
  localId: string
  body: string
  createdAt: string
  state: 'sending' | 'failed'
  failure: LocalEchoFailureReason | null
  retryAfter: number | null
}

export type GroupMessageView = CommittedMessageView | PendingMessageView

export interface GroupChatViewState {
  /** Committed messages, always ascending by `seq`. */
  messages: CommittedMessageView[]
  /** Optimistic bubbles, oldest first. Rendered after `messages`. */
  pending: PendingMessageView[]
  members: GroupMember[]
  onlineUserIds: string[]
  connection: GroupConnectionState
  /** Highest `seq` seen — the cursor for markRead and gap checks. */
  lastSeq: number
  /** Seconds remaining on a send rate limit; 0 when unrestricted. */
  sendCooldown: number
}

export const initialGroupChatState: GroupChatViewState = {
  messages: [],
  pending: [],
  members: [],
  onlineUserIds: [],
  connection: 'offline',
  lastSeq: 0,
  sendCooldown: 0
}

// -- seq gap detection --------------------------------------------------------

export type SeqCheck = 'apply' | 'stale' | 'gap'

/**
 * Per-group BATCH seq is monotonic (assigned by the main-side batcher); a jump
 * means a frame was dropped and the local cache is no longer trustworthy, so
 * the caller rehydrates via `groupChat:open`. Identical contract to
 * `chatModel.checkBatchSeq` — same bug class, same fix.
 */
export function checkBatchSeq(lastSeq: number | null, seq: number): SeqCheck {
  if (lastSeq === null) return 'apply'
  if (seq <= lastSeq) return 'stale'
  return seq === lastSeq + 1 ? 'apply' : 'gap'
}

/**
 * Gap detection on MESSAGE seq, which is a different question: message seq is
 * per-group and strictly +1, so a hole means we missed a broadcast and should
 * catch up rather than render a chat with a silent hole in it.
 */
export function hasMessageGap(lastSeq: number, incomingSeq: number): boolean {
  if (lastSeq === 0) return false
  return incomingSeq > lastSeq + 1
}

// -- internal helpers ---------------------------------------------------------

function toCommitted(message: GroupMessage): CommittedMessageView {
  return {
    kind: 'committed',
    id: message.id,
    seq: message.seq,
    authorId: message.authorId,
    messageKind: message.kind,
    body: message.deleted ? null : message.body,
    createdAt: message.createdAt,
    edited: message.editedAt !== null,
    deleted: message.deleted,
    authorNickname: message.author.nickname,
    authorColor: message.author.avatarColor,
    authorEmoji: message.author.avatarEmoji
  }
}

/**
 * Insert-or-replace keyed by id, keeping the array sorted by `seq`.
 *
 * The common case — a new message with the highest seq — is an O(1) append;
 * only out-of-order catch-up pages pay for the scan.
 */
function upsertSorted(
  messages: readonly CommittedMessageView[],
  next: CommittedMessageView
): CommittedMessageView[] {
  const existingIndex = messages.findIndex((message) => message.id === next.id)
  if (existingIndex >= 0) {
    const existing = messages[existingIndex]
    if (existing !== undefined && existing.seq === next.seq) {
      return [
        ...messages.slice(0, existingIndex),
        next,
        ...messages.slice(existingIndex + 1)
      ]
    }
    // seq changed (a local id that just got its real seq) — reposition.
    const without = messages.filter((message) => message.id !== next.id)
    return upsertSorted(without, next)
  }

  const last = messages[messages.length - 1]
  if (last === undefined || last.seq < next.seq) {
    return [...messages, next]
  }
  const index = messages.findIndex((message) => message.seq > next.seq)
  const at = index < 0 ? messages.length : index
  return [...messages.slice(0, at), next, ...messages.slice(at)]
}

function withoutPending(
  pending: readonly PendingMessageView[],
  localId: string
): PendingMessageView[] {
  return pending.filter((entry) => entry.localId !== localId)
}

// -- event reducer ------------------------------------------------------------

function applyMessage(
  state: GroupChatViewState,
  message: GroupMessage
): GroupChatViewState {
  const view = toCommitted(message)
  return {
    ...state,
    // A broadcast that echoes our own send settles the optimistic bubble by
    // id — no timestamp fuzzing, no duplicate window.
    pending: withoutPending(state.pending, message.id),
    messages: upsertSorted(state.messages, view),
    lastSeq: Math.max(state.lastSeq, message.seq)
  }
}

function applyMessageUpdated(
  state: GroupChatViewState,
  event: Extract<GroupEvent, { type: 'message-updated' }>
): GroupChatViewState {
  const index = state.messages.findIndex(
    (message) => message.id === event.messageId
  )
  if (index < 0) return state
  const existing = state.messages[index]
  if (existing === undefined) return state
  const next: CommittedMessageView = {
    ...existing,
    body: event.deleted ? null : event.body,
    deleted: event.deleted,
    edited: !event.deleted && event.body !== existing.body
  }
  return {
    ...state,
    messages: [
      ...state.messages.slice(0, index),
      next,
      ...state.messages.slice(index + 1)
    ]
  }
}

function applyLocalEcho(
  state: GroupChatViewState,
  event: Extract<GroupEvent, { type: 'local-echo' }>
): GroupChatViewState {
  const entry: PendingMessageView = {
    kind: 'pending',
    localId: event.localId,
    body: event.body,
    createdAt: event.createdAt,
    state: 'sending',
    failure: null,
    retryAfter: null
  }
  return {
    ...state,
    // Re-echo (a retry) replaces the failed bubble in place rather than
    // stacking a second copy of the same text.
    pending: [...withoutPending(state.pending, event.localId), entry]
  }
}

function applyEchoSettled(
  state: GroupChatViewState,
  event: Extract<GroupEvent, { type: 'local-echo-settled' }>
): GroupChatViewState {
  return {
    ...state,
    pending: withoutPending(state.pending, event.localId),
    lastSeq: Math.max(state.lastSeq, event.seq),
    sendCooldown: 0
  }
}

function applyEchoFailed(
  state: GroupChatViewState,
  event: Extract<GroupEvent, { type: 'local-echo-failed' }>
): GroupChatViewState {
  const pending = state.pending.map((entry) =>
    entry.localId === event.localId
      ? {
          ...entry,
          state: 'failed' as const,
          failure: event.reason,
          retryAfter: event.retryAfter ?? null
        }
      : entry
  )
  return {
    ...state,
    pending,
    sendCooldown:
      event.reason === 'rate-limit' ? (event.retryAfter ?? 5) : state.sendCooldown
  }
}

export function applyGroupEvent(
  state: GroupChatViewState,
  event: GroupEvent
): GroupChatViewState {
  switch (event.type) {
    case 'message':
      return applyMessage(state, event.message)
    case 'message-updated':
      return applyMessageUpdated(state, event)
    case 'local-echo':
      return applyLocalEcho(state, event)
    case 'local-echo-settled':
      return applyEchoSettled(state, event)
    case 'local-echo-failed':
      return applyEchoFailed(state, event)
    case 'presence':
      return { ...state, onlineUserIds: event.online.map((entry) => entry.userId) }
    case 'member-joined': {
      const others = state.members.filter(
        (member) => member.userId !== event.member.userId
      )
      return { ...state, members: [...others, event.member] }
    }
    case 'member-left':
      return {
        ...state,
        members: state.members.filter((member) => member.userId !== event.userId),
        onlineUserIds: state.onlineUserIds.filter((id) => id !== event.userId)
      }
    case 'connection':
      return { ...state, connection: event.state }
  }
}

export function applyGroupEvents(
  state: GroupChatViewState,
  events: readonly GroupEvent[]
): GroupChatViewState {
  return events.reduce(applyGroupEvent, state)
}

// -- hydration from `groupChat:open` -----------------------------------------

function toPendingView(row: PendingGroupMessage): PendingMessageView {
  return {
    kind: 'pending',
    localId: row.localId,
    body: row.body,
    createdAt: row.createdAt,
    state: row.state === 'failed' ? 'failed' : 'sending',
    failure: row.state === 'failed' ? 'network' : null,
    retryAfter: null
  }
}

export function hydrateGroupChat(input: {
  messages: readonly GroupMessage[]
  members: readonly GroupMember[]
  pending: readonly PendingGroupMessage[]
  connection: GroupConnectionState
}): GroupChatViewState {
  const messages = [...input.messages]
    .sort((a, b) => a.seq - b.seq)
    .map(toCommitted)
  const last = messages[messages.length - 1]
  return {
    ...initialGroupChatState,
    messages,
    members: [...input.members],
    pending: input.pending.map(toPendingView),
    connection: input.connection,
    lastSeq: last?.seq ?? 0
  }
}

/** Prepends an older page fetched by `groupChat:loadOlder`. */
export function prependOlder(
  state: GroupChatViewState,
  older: readonly GroupMessage[]
): GroupChatViewState {
  if (older.length === 0) return state
  const known = new Set(state.messages.map((message) => message.id))
  const fresh = older
    .filter((message) => !known.has(message.id))
    .map(toCommitted)
  if (fresh.length === 0) return state
  return {
    ...state,
    messages: [...fresh, ...state.messages].sort((a, b) => a.seq - b.seq)
  }
}

/** Merges the member list fetched by `groups:members`. */
export function setMembers(
  state: GroupChatViewState,
  members: readonly GroupMember[]
): GroupChatViewState {
  return { ...state, members: [...members] }
}

export function tickCooldown(state: GroupChatViewState): GroupChatViewState {
  if (state.sendCooldown <= 0) return state
  return { ...state, sendCooldown: state.sendCooldown - 1 }
}

// -- derived ------------------------------------------------------------------

/** The render list: committed first (by seq), then optimistic bubbles. */
export function visibleMessages(
  state: GroupChatViewState
): GroupMessageView[] {
  return [...state.messages, ...state.pending]
}

export function unreadFrom(
  state: GroupChatViewState,
  lastReadSeq: number
): number {
  return state.messages.filter((message) => message.seq > lastReadSeq).length
}

/**
 * System message copy lives HERE, not in Postgres: the server stores an event
 * code so wording changes never become migrations and localization stays
 * possible (supabase/README.md §8-⑨).
 */
export function systemMessageText(code: string, actor: string): string {
  switch (code) {
    case 'joined':
      return `${actor}님이 들어왔어요`
    case 'left':
      return `${actor}님이 나갔어요`
    case 'kicked':
      return `${actor}님이 내보내졌어요`
    case 'code_auto_revoked':
      return '참여가 너무 몰려서 초대 코드를 잠갔어요. 새 코드를 만들어 주세요.'
    case 'renamed':
      return `${actor}님이 그룹 이름을 바꿨어요`
    default:
      return '알림'
  }
}
