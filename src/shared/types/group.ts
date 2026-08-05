/**
 * [C6/C8] Phase-2 group (조별과제) domain types shared by main and renderer.
 *
 * NAME COLLISION WARNING (docs/phase2-community.md §3.4): the LOCAL AI tutor
 * conversation also has "messages". Local = `ChatMessage` / `chatRepo`,
 * remote group chat = `GroupMessage` / `groupRepo`. Never mix them.
 *
 * Field names mirror the jsonb the RPCs return verbatim (camelCase, chosen in
 * supabase/migrations/*.sql) so main can hand payloads through with a shape
 * check instead of a translation layer.
 */

export type GroupRole = 'owner' | 'admin' | 'member'

export type GroupMessageKind = 'text' | 'system'

/**
 * System messages carry an EVENT CODE as their body, not a sentence — the
 * Korean copy lives in the renderer so wording changes are not migrations
 * (supabase/README.md §8-⑨).
 */
export type SystemEventCode =
  | 'joined'
  | 'left'
  | 'kicked'
  | 'code_auto_revoked'
  | 'renamed'

/** Denormalized author profile — shipped inside every broadcast payload. */
export interface GroupAuthor {
  nickname: string
  avatarColor: string
  avatarEmoji: string
}

export interface GroupMessage {
  id: string
  groupId: string
  /** Per-group monotonic sequence assigned by a BEFORE INSERT trigger. */
  seq: number
  authorId: string
  kind: GroupMessageKind
  /** null once the message is soft-deleted. */
  body: string | null
  replyTo: string | null
  createdAt: string
  editedAt: string | null
  deleted: boolean
  author: GroupAuthor
}

export interface GroupMember {
  groupId: string
  userId: string
  role: GroupRole
  joinedAt: string
  nickname: string
  avatarColor: string
  avatarEmoji: string
}

/**
 * A group as the sidebar needs it: remote identity + the LOCAL course it is
 * pinned under. `courseId` is null until the user links it (§5.2) — that
 * nullability is what keeps "join by code" at two steps.
 */
export interface GroupSummary {
  /** Remote `study_groups.id`. */
  id: string
  name: string
  color: string
  courseId: string | null
  memberCount: number
  unread: number
  lastMsgAt: string | null
  joinedAt: string
}

export interface InviteCodeInfo {
  code: string
  groupId: string
  expiresAt: string
  maxUses: number
  useCount: number
}

export interface GroupCreateResult {
  group: GroupSummary
  invite: InviteCodeInfo
}

/**
 * `join_group_with_code()` returns rejections as VALUES, never exceptions —
 * a raise would roll back the rate-limit row it just wrote and the whole
 * 5-attempts-per-5-minutes defence would never accumulate
 * (supabase/README.md §8-②). The IPC layer mirrors that contract exactly.
 */
export type JoinGroupError =
  | 'invalid_code'
  | 'rate_limited'
  | 'offline'
  | 'not-signed-in'
  | 'unconfigured'

export type JoinGroupResult =
  | { ok: true; group: GroupSummary; alreadyMember: boolean }
  | {
      ok: false
      error: JoinGroupError
      /** Server-side sub-reason, e.g. 'join_5m' | 'join_code_locked'. */
      reason?: string
      /** Seconds until the next attempt is allowed. */
      retryAfter?: number
    }

/** A message the user sent that has not been acknowledged by the server yet. */
export interface PendingGroupMessage {
  localId: string
  groupId: string
  body: string
  replyTo: string | null
  createdAt: string
  state: 'pending' | 'sending' | 'failed'
  attempts: number
  lastError: string | null
}

export type GroupConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'degraded-polling'
  | 'offline'

export interface GroupChatOpenResult {
  /** null when the group is unknown locally (stale tab → renderer drops it). */
  group: GroupSummary | null
  /** Local cache tail — rendered with ZERO network round trips (§4.3). */
  messages: GroupMessage[]
  members: GroupMember[]
  pending: PendingGroupMessage[]
  connection: GroupConnectionState
  myUserId: string | null
  lastReadSeq: number
}

export interface PendingGroupInvite {
  inviteId: string
  groupId: string
  groupName: string
  groupColor: string
  inviterNickname: string
  createdAt: string
}

export type InviteByNicknameResult =
  | { status: 'pending'; userId: string; inviteId: string }
  | { status: 'already_member' | 'already_pending'; userId: string }

export type FriendStatus = 'pending' | 'accepted'

export interface FriendEntry {
  userId: string
  nickname: string
  avatarColor: string
  avatarEmoji: string
  status: FriendStatus
  /** Who asked. Only meaningful while `status === 'pending'`. */
  direction: 'incoming' | 'outgoing'
}

/** Exact-match nickname lookup (prefix search is never exposed server-side). */
export interface ProfileLookupResult {
  id: string
  nickname: string
  avatarColor: string
  avatarEmoji: string
  isFriend: boolean
}

export type ReportTargetType = 'message' | 'profile' | 'group'

/** Reason why `groups:invalidated` fired — the renderer refetches that slice. */
export type GroupsInvalidationReason =
  | 'membership'
  | 'invite'
  | 'unread'
  | 'profile'
