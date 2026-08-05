/**
 * The main-process group runtime — everything the `auth:*`, `groups:*`,
 * `groupChat:*` and `safety:*` IPC channels call into.
 *
 * LAZY BY CONSTRUCTION (docs/phase2-community.md §1.4-2): `registerHandlers`
 * only holds a factory. Nothing in this module — no Supabase client, no
 * network, no session file read — happens until the renderer actually invokes
 * one of those channels. Boot stays exactly as fast and exactly as offline as
 * it is in Phase 1.
 *
 * LOCAL-CACHE-FIRST: every read answers from SQLite immediately and refreshes
 * in the background. That is what makes the 함께하기 rail render at zero
 * network cost, and what makes the whole feature degrade to "read-only, queued
 * writes" instead of "spinner" when the network is gone.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthProvider,
  AuthSignInResult,
  AuthState,
  MyProfile
} from '../../../shared/types/auth'
import type {
  FriendEntry,
  GroupChatOpenResult,
  GroupCreateResult,
  GroupMember,
  GroupMessage,
  GroupSummary,
  InviteByNicknameResult,
  InviteCodeInfo,
  JoinGroupResult,
  PendingGroupInvite,
  ProfileLookupResult,
  ReportTargetType
} from '../../../shared/types/group'
import type { GroupEvent } from '../../../shared/types/group-events'
import { normalizeInviteCode } from '../../../shared/group/inviteCode'
import { ValidationError } from '../../db/errors'
import type { AuthService } from './authService'
import type { GroupRealtimeManager } from './GroupRealtimeManager'
import type { GroupRepo } from './groupRepo'
import type { OutboxUploader, SendOutcome } from './OutboxUploader'
import type { RateGuard } from './rateGuard'
import * as rpc from './groupRpc'
import { asPostgresError, isRateLimited, retryAfterSeconds } from './supabaseClient'

/** How many cached messages the first render gets (§4.3). */
export const TAIL_PAGE_SIZE = 50

/** Thrown when an action needs a session the user does not have. */
export class NotSignedInError extends Error {
  override readonly name = 'NotSignedInError'
  constructor() {
    super('로그인이 필요해요.')
  }
}

/** Thrown when the main-side rate guard rejects before any round trip. */
export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError'
  constructor(readonly retryAfter: number) {
    super('잠시 후 다시 시도해요.')
  }
}

export interface GroupServiceDeps {
  repo: GroupRepo
  auth: AuthService
  realtime: GroupRealtimeManager
  outbox: OutboxUploader
  rateGuard: RateGuard
  /** null while unconfigured. */
  getClient: () => SupabaseClient | null
  emit: (groupId: string, event: GroupEvent) => void
  invalidate: (reason: 'membership' | 'invite' | 'unread' | 'profile') => void
}

export interface GroupService {
  // auth
  getAuthState(): AuthState
  restoreSession(): Promise<AuthState>
  signIn(provider: AuthProvider): Promise<AuthSignInResult>
  /** Finishes an OAuth round trip arriving on `bandal://auth/callback`. */
  handleDeepLink(url: string): Promise<void>
  signOut(): Promise<void>
  setNickname(nickname: string): Promise<MyProfile>
  setAvatar(patch: { color?: string; emoji?: string }): Promise<MyProfile>

  // groups
  listGroups(): GroupSummary[]
  createGroup(input: {
    name: string
    color: string
    courseId?: string
  }): Promise<GroupCreateResult>
  joinWithCode(code: string): Promise<JoinGroupResult>
  currentCode(groupId: string): Promise<InviteCodeInfo | null>
  regenerateCode(groupId: string, maxUses: number): Promise<InviteCodeInfo>
  linkCourse(groupId: string, courseId: string | null): GroupSummary
  leaveGroup(groupId: string): Promise<void>
  members(groupId: string): Promise<GroupMember[]>
  kick(groupId: string, userId: string): Promise<void>

  // invites / friends
  inviteByNickname(groupId: string, nickname: string): Promise<InviteByNicknameResult>
  findProfile(nickname: string): Promise<ProfileLookupResult | null>
  listPendingInvites(): Promise<PendingGroupInvite[]>
  respondInvite(inviteId: string, accept: boolean): Promise<'accepted' | 'declined'>
  listFriends(): Promise<FriendEntry[]>
  requestFriend(nickname: string): Promise<{ status: 'pending' | 'accepted'; userId: string }>
  respondFriend(requesterId: string, accept: boolean): Promise<'accepted' | 'declined'>

  // group chat
  openChat(groupId: string): Promise<GroupChatOpenResult>
  send(groupId: string, body: string, replyTo?: string): { localId: string }
  loadOlder(groupId: string, beforeSeq: number, limit?: number): Promise<GroupMessage[]>
  markRead(groupId: string, seq: number): Promise<void>
  retry(localId: string): void
  deleteMessage(messageId: string): Promise<void>
  closeChat(groupId: string): void

  // safety
  block(userId: string, blocked: boolean): Promise<void>
  report(input: {
    targetType: ReportTargetType
    targetId: string
    reason: string
  }): Promise<void>

  // lifecycle
  setWindowFocused(focused: boolean): void
  catchUp(groupId: string, afterSeq: number): Promise<void>
  classifySendError(error: unknown): SendOutcome
  dispose(): void
}

/** Network-ish failures look like a thrown TypeError from undici/fetch. */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(
    message
  )
}

export function createGroupService(deps: GroupServiceDeps): GroupService {
  function requireClient(): SupabaseClient {
    const client = deps.getClient()
    if (client === null) throw new NotSignedInError()
    return client
  }

  function requireSession(): { client: SupabaseClient; userId: string } {
    const client = requireClient()
    const userId = deps.auth.userId()
    if (userId === null) throw new NotSignedInError()
    return { client, userId }
  }

  function guard(action: string, scope?: string): void {
    const decision = deps.rateGuard.take(action, scope)
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfter)
  }

  /**
   * Applies a fetched page to the cache and republishes it as events, so the
   * renderer's reducer has exactly one code path for "new messages" whether
   * they came from a broadcast or from a catch-up.
   */
  function ingest(groupId: string, messages: readonly GroupMessage[]): void {
    if (messages.length === 0) return
    deps.repo.upsertMessages(messages)
    for (const message of messages) {
      deps.emit(groupId, { type: 'message', message })
    }
    const newest = messages[messages.length - 1]
    if (newest !== undefined) {
      const existing = deps.repo.getGroup(groupId)
      if (existing !== null) {
        deps.repo.setUnread(groupId, existing.unread, newest.createdAt)
      }
    }
  }

  /** Cheap value fingerprint of the cached list, for change detection. */
  function groupsSignature(): string {
    return deps.repo
      .listGroups()
      .map(
        (group) =>
          `${group.id}:${group.name}:${group.color}:${group.unread}:${group.memberCount}:${group.courseId ?? ''}`
      )
      .join('|')
  }

  let refreshInFlight: Promise<void> | null = null

  /**
   * Background reconciliation of the group list. Failures are silent.
   *
   * ⚠ It invalidates ONLY when the cache actually changed. `groups:list`
   * kicks off a refresh, and the renderer refetches on `groups:invalidated` —
   * so an unconditional broadcast would be an infinite request loop. Concurrent
   * calls also coalesce, since several UI surfaces list groups on mount.
   */
  function refreshGroups(): Promise<void> {
    if (refreshInFlight !== null) return refreshInFlight
    const client = deps.getClient()
    if (client === null || deps.auth.userId() === null) return Promise.resolve()

    refreshInFlight = (async () => {
      const before = groupsSignature()
      try {
        const rows = await rpc.selectMyGroups(client)
        for (const { group } of rows) {
          deps.repo.upsertGroup({
            id: group.id,
            name: group.name,
            color: group.color,
            memberCount: group.memberCount,
            unread: group.unread,
            lastMsgAt: group.lastMsgAt,
            joinedAt: group.joinedAt
          })
        }
        deps.repo.retainGroups(rows.map((row) => row.group.id))
        deps.auth.setOnline(true)
        if (groupsSignature() !== before) deps.invalidate('membership')
      } catch (error) {
        console.error('[group] group list refresh failed', error)
        if (isNetworkError(error)) deps.auth.setOnline(false)
      } finally {
        refreshInFlight = null
      }
    })()
    return refreshInFlight
  }

  return {
    getAuthState: () => deps.auth.getState(),

    async restoreSession() {
      const state = await deps.auth.restore()
      if (state.phase === 'signed-in') {
        deps.repo.releaseStranded()
        void refreshGroups()
        deps.outbox.wake()
      }
      return state
    },

    signIn: (provider) => deps.auth.signIn(provider),

    async handleDeepLink(url) {
      await deps.auth.handleDeepLink(url)
      // Same post-sign-in work as `restoreSession` — a session that arrives via
      // the deep link has to light up the rail exactly like a restored one.
      if (deps.auth.getState().phase === 'signed-in') {
        deps.repo.releaseStranded()
        void refreshGroups()
        deps.outbox.wake()
      }
    },

    async signOut() {
      deps.realtime.disposeAll()
      await deps.auth.signOut()
      // The cache is per-account; leaving it behind would leak one student's
      // group names into the next sign-in on a shared laptop.
      deps.repo.clearAll()
      deps.invalidate('membership')
    },

    setNickname: (nickname) => deps.auth.setNickname(nickname),
    setAvatar: (patch) => deps.auth.setAvatar(patch),

    listGroups() {
      // Answered from SQLite — always instant, always offline-safe. The
      // refresh below invalidates when the server disagrees.
      void refreshGroups()
      return deps.repo.listGroups()
    },

    async createGroup(input) {
      const { client } = requireSession()
      guard('createGroup')
      const result = await rpc.rpcCreateGroup(client, {
        name: input.name,
        color: input.color
      })
      const group = deps.repo.upsertGroup({
        id: result.group.id,
        name: result.group.name,
        color: result.group.color,
        memberCount: result.group.memberCount,
        courseId: input.courseId ?? null
      })
      deps.invalidate('membership')
      return { group, invite: result.invite }
    },

    async joinWithCode(rawCode) {
      const code = normalizeInviteCode(rawCode)
      const client = deps.getClient()
      if (client === null) {
        return { ok: false, error: 'unconfigured' }
      }
      if (deps.auth.userId() === null) {
        return { ok: false, error: 'not-signed-in' }
      }
      // Local guard first (instant rejection, no round trip); the RPC's own
      // `try_rate` is the defence that actually counts.
      const decision = deps.rateGuard.take('joinWithCode')
      if (!decision.allowed) {
        return {
          ok: false,
          error: 'rate_limited',
          reason: 'local_guard',
          retryAfter: decision.retryAfter
        }
      }
      try {
        const result = await rpc.rpcJoinWithCode(client, code)
        if (!result.ok) return result
        const group = deps.repo.upsertGroup({
          id: result.group.id,
          name: result.group.name,
          color: result.group.color,
          memberCount: result.group.memberCount
        })
        deps.rateGuard.reset('joinWithCode')
        deps.invalidate('membership')
        return { ok: true, group, alreadyMember: result.alreadyMember }
      } catch (error) {
        if (isNetworkError(error)) {
          deps.auth.setOnline(false)
          return { ok: false, error: 'offline' }
        }
        throw error
      }
    },

    currentCode(groupId) {
      const { client } = requireSession()
      return rpc.rpcCurrentInviteCode(client, groupId)
    },

    regenerateCode(groupId, maxUses) {
      const { client } = requireSession()
      guard('regenerateCode', groupId)
      return rpc.rpcRegenerateInviteCode(client, { groupId, maxUses })
    },

    linkCourse(groupId, courseId) {
      const summary = deps.repo.linkCourse(groupId, courseId)
      deps.invalidate('membership')
      return summary
    },

    async leaveGroup(groupId) {
      const { client } = requireSession()
      await rpc.rpcLeaveGroup(client, groupId)
      deps.realtime.close(groupId)
      deps.repo.removeGroup(groupId)
      deps.invalidate('membership')
    },

    async members(groupId) {
      const client = deps.getClient()
      const cached = deps.repo.listMembers(groupId)
      if (client === null || deps.auth.userId() === null) return cached
      try {
        const fresh = await rpc.selectMembers(client, groupId)
        deps.repo.replaceMembers(groupId, fresh)
        return fresh
      } catch (error) {
        console.error('[group] member refresh failed', error)
        return cached
      }
    },

    async kick(groupId, userId) {
      const { client } = requireSession()
      await rpc.rpcKickMember(client, { groupId, userId })
      deps.emit(groupId, { type: 'member-left', userId })
      deps.invalidate('membership')
    },

    async inviteByNickname(groupId, nickname) {
      const { client } = requireSession()
      guard('inviteByNickname')
      const result = await rpc.rpcInviteByNickname(client, { groupId, nickname })
      deps.invalidate('invite')
      return result
    },

    findProfile(nickname) {
      const { client } = requireSession()
      guard('findProfile')
      return rpc.rpcFindProfile(client, nickname)
    },

    async listPendingInvites() {
      const client = deps.getClient()
      if (client === null || deps.auth.userId() === null) return []
      try {
        return await rpc.selectPendingInvites(client)
      } catch (error) {
        console.error('[group] pending invites failed', error)
        return []
      }
    },

    async respondInvite(inviteId, accept) {
      const { client } = requireSession()
      const status = await rpc.rpcRespondGroupInvite(client, { inviteId, accept })
      if (status === 'accepted') await refreshGroups()
      deps.invalidate('invite')
      return status
    },

    async listFriends() {
      const client = deps.getClient()
      const userId = deps.auth.userId()
      if (client === null || userId === null) return []
      try {
        const friends = await rpc.selectFriends(client, userId)
        // Friends double as the invite palette's offline autocomplete cache
        // — that is exactly what makes the second 조별과제 zero typing (§5.3).
        deps.repo.upsertProfiles(
          friends.map((friend) => ({
            groupId: '',
            userId: friend.userId,
            role: 'member' as const,
            joinedAt: new Date().toISOString(),
            nickname: friend.nickname,
            avatarColor: friend.avatarColor,
            avatarEmoji: friend.avatarEmoji
          }))
        )
        return friends
      } catch (error) {
        console.error('[group] friend list failed', error)
        return []
      }
    },

    async requestFriend(nickname) {
      const { client } = requireSession()
      guard('friendRequest')
      const result = await rpc.rpcSendFriendRequest(client, nickname)
      deps.invalidate('profile')
      return result
    },

    async respondFriend(requesterId, accept) {
      const { client } = requireSession()
      const status = await rpc.rpcRespondFriendRequest(client, {
        requesterId,
        accept
      })
      deps.invalidate('profile')
      return status
    },

    async openChat(groupId) {
      const group = deps.repo.getGroup(groupId)
      const messages = deps.repo.tailMessages(groupId, TAIL_PAGE_SIZE)
      // `last_read_seq` is not mirrored locally, but it is recoverable:
      // unread is defined server-side as `last_msg_seq - last_read_seq`, so
      // the cached max seq minus the cached unread reproduces it. Being
      // slightly stale is harmless — `mark_read()` takes greatest().
      const lastReadSeq = Math.max(
        0,
        deps.repo.maxSeq(groupId) - (group?.unread ?? 0)
      )
      const result: GroupChatOpenResult = {
        group,
        messages,
        members: deps.repo.listMembers(groupId),
        pending: deps.repo.pendingFor(groupId),
        connection: deps.realtime.connectionState(groupId),
        myUserId: deps.auth.userId(),
        lastReadSeq
      }
      // Subscribe + reconcile happen after the synchronous cache render, so
      // the tab paints before any network work starts.
      void deps.realtime.open(groupId).catch((error: unknown) => {
        console.error('[group] failed to open realtime channel', error)
      })
      return result
    },

    send(groupId, body, replyTo) {
      const trimmed = body.trim()
      if (trimmed.length === 0) {
        throw new ValidationError('body must be a non-empty string')
      }
      const row = deps.repo.enqueue({
        groupId,
        body: trimmed,
        replyTo: replyTo ?? null
      })
      // Optimistic bubble first — the queue drain is deliberately behind it.
      deps.emit(groupId, {
        type: 'local-echo',
        localId: row.localId,
        body: row.body,
        createdAt: row.createdAt
      })
      deps.outbox.wake()
      return { localId: row.localId }
    },

    async loadOlder(groupId, beforeSeq, limit = TAIL_PAGE_SIZE) {
      const cached = deps.repo.messagesBefore(groupId, beforeSeq, limit)
      if (cached.length >= limit) return cached
      const client = deps.getClient()
      if (client === null || deps.auth.userId() === null) return cached
      try {
        const fetched = await rpc.rpcLoadMessages(client, {
          groupId,
          beforeSeq,
          limit
        })
        deps.repo.upsertMessages(fetched)
        return deps.repo.messagesBefore(groupId, beforeSeq, limit)
      } catch (error) {
        console.error('[group] loadOlder failed', error)
        return cached
      }
    },

    async markRead(groupId, seq) {
      const summary = deps.repo.getGroup(groupId)
      // Only broadcast when a badge actually cleared. markRead fires on every
      // scroll, and the renderer refetches on invalidation — an unconditional
      // broadcast would be a request per scroll frame.
      if (summary !== null && summary.unread > 0) {
        deps.repo.setUnread(groupId, 0, summary.lastMsgAt)
        deps.invalidate('unread')
      }
      const client = deps.getClient()
      if (client === null || deps.auth.userId() === null) return
      try {
        await rpc.rpcMarkRead(client, { groupId, seq })
      } catch (error) {
        // Read state is convergent: the next mark_read wins with greatest().
        console.error('[group] markRead failed', error)
      }
    },

    retry(localId) {
      const row = deps.repo.requeue(localId)
      if (row !== null) {
        deps.emit(row.groupId, {
          type: 'local-echo',
          localId: row.localId,
          body: row.body,
          createdAt: row.createdAt
        })
      }
      deps.outbox.wake()
    },

    async deleteMessage(messageId) {
      const { client } = requireSession()
      await rpc.rpcDeleteMessage(client, messageId)
      deps.repo.markMessageDeleted(messageId, null, true)
    },

    closeChat(groupId) {
      deps.realtime.close(groupId)
      deps.repo.trimCache(groupId)
    },

    async block(userId, blocked) {
      const { client } = requireSession()
      guard('block')
      await rpc.rpcBlockUser(client, { userId, blocked })
      deps.invalidate('profile')
    },

    async report(input) {
      const { client } = requireSession()
      guard('report')
      await rpc.rpcReportContent(client, input)
    },

    setWindowFocused(focused) {
      deps.realtime.setWindowFocused(focused)
      if (focused) deps.outbox.wake()
    },

    async catchUp(groupId, afterSeq) {
      const client = deps.getClient()
      if (client === null || deps.auth.userId() === null) return
      const fetched = await rpc.rpcLoadMessages(client, {
        groupId,
        afterSeq,
        limit: 200
      })
      deps.auth.setOnline(true)
      ingest(groupId, fetched)
    },

    /**
     * Maps a thrown insert error onto the outbox state machine. Getting this
     * table wrong is how a chat app either loses messages or posts them twice.
     */
    classifySendError(error) {
      const pg = asPostgresError(error)
      // 23505 = the client-generated PK is already there. That is SUCCESS:
      // the message is stored, only our acknowledgement went missing (§4.4).
      if (pg?.code === '23505') return { kind: 'duplicate' }
      if (isRateLimited(error)) {
        return {
          kind: 'rate-limited',
          error: 'rate_limited',
          retryAfter: retryAfterSeconds(error) ?? 5
        }
      }
      if (isNetworkError(error)) {
        return { kind: 'retry', error: 'network' }
      }
      // 42501 (RLS) / not_a_member / body constraint — retrying cannot help.
      if (
        pg?.code === '42501' ||
        pg?.message === 'not_a_member' ||
        pg?.code === '23514'
      ) {
        return { kind: 'rejected', error: pg.message ?? 'rejected' }
      }
      // Unknown 5xx-ish: assume transient. Bounded by MAX_OUTBOX_ATTEMPTS.
      return {
        kind: 'retry',
        error: pg?.message ?? (error instanceof Error ? error.message : 'unknown')
      }
    },

    dispose() {
      deps.realtime.disposeAll()
      deps.outbox.dispose()
      deps.auth.dispose()
    }
  }
}
