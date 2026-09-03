/**
 * Thin, total wrappers over the Postgres RPCs (supabase/migrations/*.sql).
 *
 * Two jobs and nothing else:
 *  1. call the RPC with the exact parameter names the SQL declares
 *  2. narrow the returned `jsonb` into the shared TypeScript types
 *
 * Every payload is validated structurally rather than cast. The rows come from
 * a server we control, but "we control it" is not a type — and a schema drift
 * that silently produces `undefined.nickname` in the renderer is exactly the
 * bug class this file exists to prevent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FriendEntry,
  GroupAuthor,
  GroupCreateResult,
  GroupMember,
  GroupMessage,
  GroupRole,
  GroupSummary,
  InviteByNicknameResult,
  InviteCodeInfo,
  JoinGroupResult,
  PendingGroupInvite,
  ProfileLookupResult
} from '../../../shared/types/group'

type Json = Record<string, unknown>

function asRecord(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {}
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asAuthor(value: unknown): GroupAuthor {
  const record = asRecord(value)
  return {
    nickname: str(record['nickname'], '알 수 없음'),
    avatarColor: str(record['avatarColor'], 'moon'),
    avatarEmoji: str(record['avatarEmoji'], '🌙')
  }
}

/** `load_messages()` returns rows already ordered oldest → newest. */
export function asGroupMessages(value: unknown): GroupMessage[] {
  if (!Array.isArray(value)) return []
  const out: GroupMessage[] = []
  for (const raw of value) {
    const record = asRecord(raw)
    const id = record['id']
    const groupId = record['groupId']
    if (typeof id !== 'string' || typeof groupId !== 'string') continue
    out.push({
      id,
      groupId,
      seq: num(record['seq']),
      authorId: str(record['authorId']),
      kind: record['kind'] === 'system' ? 'system' : 'text',
      body: nullableStr(record['body']),
      replyTo: nullableStr(record['replyTo']),
      createdAt: str(record['createdAt'], new Date().toISOString()),
      editedAt: nullableStr(record['editedAt']),
      deleted: record['deleted'] === true,
      author: asAuthor(record['author'])
    })
  }
  return out
}

function asInvite(value: unknown): InviteCodeInfo | null {
  const record = asRecord(value)
  const code = record['code']
  if (typeof code !== 'string') return null
  return {
    code,
    groupId: str(record['groupId']),
    expiresAt: str(record['expiresAt']),
    maxUses: num(record['maxUses']),
    useCount: num(record['useCount'])
  }
}

/** Throws when the RPC errored; otherwise hands back the raw jsonb. */
async function callRpc(
  client: SupabaseClient,
  fn: string,
  args: Json
): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args)
  if (error !== null) throw error
  return data
}

export async function rpcCreateGroup(
  client: SupabaseClient,
  input: { name: string; color: string }
): Promise<GroupCreateResult> {
  const data = asRecord(
    await callRpc(client, 'create_group', {
      p_name: input.name,
      p_color: input.color
    })
  )
  const invite = asInvite(data['invite'])
  if (invite === null) {
    throw new Error('create_group returned no invite code')
  }
  const group: GroupSummary = {
    id: str(data['id']),
    name: str(data['name'], input.name),
    color: str(data['color'], input.color),
    courseId: null,
    memberCount: num(data['memberCount'], 1),
    unread: 0,
    lastMsgAt: null,
    joinedAt: new Date().toISOString()
  }
  return { group, invite }
}

/**
 * ⚠ THIS RPC NEVER THROWS FOR A REJECTION (supabase/README.md §8-②).
 * A `raise` would roll back the `rate_events` row it just inserted, so the
 * "5 attempts / 5 minutes" defence would never accumulate and the 32^6 code
 * space would be freely scannable. Rejections come back as values.
 */
export async function rpcJoinWithCode(
  client: SupabaseClient,
  code: string
): Promise<JoinGroupResult> {
  const data = asRecord(await callRpc(client, 'join_group_with_code', { p_code: code }))
  if (data['ok'] !== true) {
    const error = str(data['error'], 'invalid_code')
    const result: JoinGroupResult = {
      ok: false,
      error: error === 'rate_limited' ? 'rate_limited' : 'invalid_code'
    }
    const reason = nullableStr(data['reason'])
    if (reason !== null) result.reason = reason
    const retryAfter = data['retryAfter']
    if (typeof retryAfter === 'number') result.retryAfter = retryAfter
    return result
  }
  return {
    ok: true,
    alreadyMember: data['alreadyMember'] === true,
    group: {
      id: str(data['groupId']),
      name: str(data['name']),
      color: str(data['color'], 'moon'),
      courseId: null,
      memberCount: num(data['memberCount'], 1),
      unread: 0,
      lastMsgAt: null,
      joinedAt: new Date().toISOString()
    }
  }
}

export async function rpcCurrentInviteCode(
  client: SupabaseClient,
  groupId: string
): Promise<InviteCodeInfo | null> {
  return asInvite(await callRpc(client, 'current_invite_code', { p_group_id: groupId }))
}

export async function rpcRegenerateInviteCode(
  client: SupabaseClient,
  input: { groupId: string; maxUses: number }
): Promise<InviteCodeInfo> {
  const invite = asInvite(
    await callRpc(client, 'regenerate_invite_code', {
      p_group_id: input.groupId,
      p_max_uses: input.maxUses
    })
  )
  if (invite === null) throw new Error('regenerate_invite_code returned nothing')
  return invite
}

export async function rpcLoadMessages(
  client: SupabaseClient,
  input: {
    groupId: string
    beforeSeq?: number | null
    afterSeq?: number | null
    limit?: number
  }
): Promise<GroupMessage[]> {
  return asGroupMessages(
    await callRpc(client, 'load_messages', {
      p_group_id: input.groupId,
      p_before_seq: input.beforeSeq ?? null,
      p_after_seq: input.afterSeq ?? null,
      p_limit: input.limit ?? 50
    })
  )
}

export async function rpcMarkRead(
  client: SupabaseClient,
  input: { groupId: string; seq: number }
): Promise<number> {
  const data = asRecord(
    await callRpc(client, 'mark_read', {
      p_group_id: input.groupId,
      p_seq: input.seq
    })
  )
  return num(data['lastReadSeq'])
}

export async function rpcLeaveGroup(
  client: SupabaseClient,
  groupId: string
): Promise<void> {
  await callRpc(client, 'leave_group', { p_group_id: groupId })
}

export async function rpcKickMember(
  client: SupabaseClient,
  input: { groupId: string; userId: string }
): Promise<void> {
  await callRpc(client, 'kick_member', {
    p_group_id: input.groupId,
    p_user_id: input.userId
  })
}

export async function rpcDeleteMessage(
  client: SupabaseClient,
  messageId: string
): Promise<void> {
  await callRpc(client, 'delete_message', { p_message_id: messageId })
}

export async function rpcFindProfile(
  client: SupabaseClient,
  nickname: string
): Promise<ProfileLookupResult | null> {
  const data = await callRpc(client, 'find_profile_by_nickname', {
    p_nickname: nickname
  })
  if (data === null || data === undefined) return null
  const record = asRecord(data)
  const id = record['id']
  if (typeof id !== 'string') return null
  return {
    id,
    nickname: str(record['nickname']),
    avatarColor: str(record['avatarColor'], 'moon'),
    avatarEmoji: str(record['avatarEmoji'], '🌙'),
    isFriend: record['isFriend'] === true
  }
}

export async function rpcInviteByNickname(
  client: SupabaseClient,
  input: { groupId: string; nickname: string }
): Promise<InviteByNicknameResult> {
  const data = asRecord(
    await callRpc(client, 'invite_by_nickname', {
      p_group_id: input.groupId,
      p_nickname: input.nickname
    })
  )
  const status = str(data['status'])
  const userId = str(data['userId'])
  if (status === 'pending') {
    return { status: 'pending', userId, inviteId: str(data['inviteId']) }
  }
  return {
    status: status === 'already_member' ? 'already_member' : 'already_pending',
    userId
  }
}

export async function rpcRespondGroupInvite(
  client: SupabaseClient,
  input: { inviteId: string; accept: boolean }
): Promise<'accepted' | 'declined'> {
  const data = asRecord(
    await callRpc(client, 'respond_group_invite', {
      p_invite_id: input.inviteId,
      p_accept: input.accept
    })
  )
  return str(data['status']) === 'accepted' ? 'accepted' : 'declined'
}

export async function rpcSendFriendRequest(
  client: SupabaseClient,
  nickname: string
): Promise<{ status: 'pending' | 'accepted'; userId: string }> {
  const data = asRecord(
    await callRpc(client, 'send_friend_request', { p_nickname: nickname })
  )
  return {
    status: str(data['status']) === 'accepted' ? 'accepted' : 'pending',
    userId: str(data['userId'])
  }
}

export async function rpcRespondFriendRequest(
  client: SupabaseClient,
  input: { requesterId: string; accept: boolean }
): Promise<'accepted' | 'declined'> {
  const data = asRecord(
    await callRpc(client, 'respond_friend_request', {
      p_requester_id: input.requesterId,
      p_accept: input.accept
    })
  )
  return str(data['status']) === 'accepted' ? 'accepted' : 'declined'
}

export async function rpcBlockUser(
  client: SupabaseClient,
  input: { userId: string; blocked: boolean }
): Promise<void> {
  await callRpc(client, input.blocked ? 'block_user' : 'unblock_user', {
    p_user_id: input.userId
  })
}

export async function rpcReportContent(
  client: SupabaseClient,
  input: { targetType: string; targetId: string; reason: string }
): Promise<void> {
  await callRpc(client, 'report_content', {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason: input.reason
  })
}

// -- table reads (RLS-scoped SELECTs, no RPC needed) --------------------------

/** Groups the signed-in user belongs to, with the membership row joined. */
export async function selectMyGroups(
  client: SupabaseClient
): Promise<{ group: GroupSummary; lastReadSeq: number }[]> {
  const { data, error } = await client
    .from('group_members')
    .select(
      'group_id, role, joined_at, last_read_seq, study_groups!inner(id, name, color, member_count, last_msg_seq, last_msg_at, deleted_at)'
    )
    .is('left_at', null)
  if (error !== null) throw error
  if (!Array.isArray(data)) return []

  const out: { group: GroupSummary; lastReadSeq: number }[] = []
  for (const raw of data) {
    const row = asRecord(raw)
    // PostgREST returns the embedded relation as an object or a 1-item array
    // depending on how it infers cardinality; accept both.
    const embedded = row['study_groups']
    const group = asRecord(Array.isArray(embedded) ? embedded[0] : embedded)
    const id = group['id']
    if (typeof id !== 'string' || group['deleted_at'] !== null) continue
    const lastReadSeq = num(row['last_read_seq'])
    out.push({
      lastReadSeq,
      group: {
        id,
        name: str(group['name']),
        color: str(group['color'], 'moon'),
        courseId: null,
        memberCount: num(group['member_count'], 1),
        unread: Math.max(0, num(group['last_msg_seq']) - lastReadSeq),
        lastMsgAt: nullableStr(group['last_msg_at']),
        joinedAt: str(row['joined_at'], new Date().toISOString())
      }
    })
  }
  return out
}

// -- group↔course link backup (per-user, RLS-scoped) --------------------------
// 과목은 로컬 소유 개념이라 연결의 진실은 로컬 SQLite다. 이 테이블은
// 재로그인으로 로컬 캐시가 초기화될 때 연결을 복원하기 위한 백업이다.

export async function upsertCourseLink(
  client: SupabaseClient,
  groupId: string,
  courseId: string
): Promise<void> {
  const { error } = await client.from('group_course_links').upsert(
    {
      group_id: groupId,
      course_id: courseId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,group_id' }
  )
  if (error !== null) throw error
}

export async function deleteCourseLink(
  client: SupabaseClient,
  groupId: string
): Promise<void> {
  const { error } = await client
    .from('group_course_links')
    .delete()
    .eq('group_id', groupId)
  if (error !== null) throw error
}

export async function selectCourseLinks(
  client: SupabaseClient
): Promise<{ groupId: string; courseId: string }[]> {
  const { data, error } = await client
    .from('group_course_links')
    .select('group_id, course_id')
  if (error !== null) throw error
  if (!Array.isArray(data)) return []
  const out: { groupId: string; courseId: string }[] = []
  for (const raw of data) {
    const row = asRecord(raw)
    const groupId = row['group_id']
    const courseId = row['course_id']
    if (typeof groupId === 'string' && typeof courseId === 'string') {
      out.push({ groupId, courseId })
    }
  }
  return out
}

export async function selectMembers(
  client: SupabaseClient,
  groupId: string
): Promise<GroupMember[]> {
  const { data, error } = await client
    .from('group_members')
    .select('group_id, user_id, role, joined_at, profiles!inner(nickname, avatar_color, avatar_emoji)')
    .eq('group_id', groupId)
    .is('left_at', null)
  if (error !== null) throw error
  if (!Array.isArray(data)) return []

  return data.map((raw) => {
    const row = asRecord(raw)
    const embedded = row['profiles']
    const profile = asRecord(Array.isArray(embedded) ? embedded[0] : embedded)
    const role = str(row['role'], 'member')
    return {
      groupId: str(row['group_id'], groupId),
      userId: str(row['user_id']),
      role: (role === 'owner' || role === 'admin' ? role : 'member') as GroupRole,
      joinedAt: str(row['joined_at'], new Date().toISOString()),
      nickname: str(profile['nickname'], '알 수 없음'),
      avatarColor: str(profile['avatar_color'], 'moon'),
      avatarEmoji: str(profile['avatar_emoji'], '🌙')
    }
  })
}

export async function selectPendingInvites(
  client: SupabaseClient,
  userId: string
): Promise<PendingGroupInvite[]> {
  // RLS also grants group *members* read access to their group's invites (for
  // management screens), so without this filter the inviter reads back the row
  // they just created — rendered with their own nickname via the inviter join.
  const { data, error } = await client
    .from('group_invites')
    .select(
      'id, group_id, created_at, study_groups!inner(name, color), profiles!group_invites_inviter_id_fkey(nickname)'
    )
    .eq('status', 'pending')
    .eq('invitee_id', userId)
  if (error !== null) throw error
  if (!Array.isArray(data)) return []

  return data.map((raw) => {
    const row = asRecord(raw)
    const groupRaw = row['study_groups']
    const group = asRecord(Array.isArray(groupRaw) ? groupRaw[0] : groupRaw)
    const inviterRaw = row['profiles']
    const inviter = asRecord(Array.isArray(inviterRaw) ? inviterRaw[0] : inviterRaw)
    return {
      inviteId: str(row['id']),
      groupId: str(row['group_id']),
      groupName: str(group['name'], '이름 없는 그룹'),
      groupColor: str(group['color'], 'moon'),
      inviterNickname: str(inviter['nickname'], '알 수 없음'),
      createdAt: str(row['created_at'], new Date().toISOString())
    }
  })
}

export async function selectFriends(
  client: SupabaseClient,
  myUserId: string
): Promise<FriendEntry[]> {
  const { data, error } = await client
    .from('friendships')
    .select('user_a, user_b, requested_by, status')
  if (error !== null) throw error
  if (!Array.isArray(data)) return []

  const rows = data.map(asRecord)
  const otherIds = rows
    .map((row) => (str(row['user_a']) === myUserId ? str(row['user_b']) : str(row['user_a'])))
    .filter((id) => id !== '')
  if (otherIds.length === 0) return []

  const { data: profileData } = await client
    .from('profiles')
    .select('id, nickname, avatar_color, avatar_emoji')
    .in('id', otherIds)
  const profiles = new Map<string, Json>()
  if (Array.isArray(profileData)) {
    for (const raw of profileData) {
      const profile = asRecord(raw)
      profiles.set(str(profile['id']), profile)
    }
  }

  return rows.map((row) => {
    const otherId =
      str(row['user_a']) === myUserId ? str(row['user_b']) : str(row['user_a'])
    const profile = profiles.get(otherId) ?? {}
    return {
      userId: otherId,
      nickname: str(profile['nickname'], '알 수 없음'),
      avatarColor: str(profile['avatar_color'], 'moon'),
      avatarEmoji: str(profile['avatar_emoji'], '🌙'),
      status: str(row['status']) === 'accepted' ? 'accepted' : 'pending',
      direction: str(row['requested_by']) === myUserId ? 'outgoing' : 'incoming'
    }
  })
}

/** Direct INSERT — the send path stays a plain insert so the broadcast
 *  trigger and the token-bucket trigger both stay simple (§6.1). */
export async function insertMessage(
  client: SupabaseClient,
  input: {
    id: string
    groupId: string
    authorId: string
    body: string
    replyTo: string | null
  }
): Promise<GroupMessage | null> {
  const { data, error } = await client
    .from('messages')
    .insert({
      id: input.id,
      group_id: input.groupId,
      author_id: input.authorId,
      kind: 'text',
      body: input.body,
      reply_to: input.replyTo
    })
    .select('id, group_id, seq, author_id, kind, body, reply_to, created_at')
    .single()
  if (error !== null) throw error
  const row = asRecord(data)
  const id = row['id']
  if (typeof id !== 'string') return null
  return {
    id,
    groupId: str(row['group_id'], input.groupId),
    seq: num(row['seq']),
    authorId: str(row['author_id'], input.authorId),
    kind: 'text',
    body: str(row['body'], input.body),
    replyTo: nullableStr(row['reply_to']),
    createdAt: str(row['created_at'], new Date().toISOString()),
    editedAt: null,
    deleted: false,
    author: { nickname: '', avatarColor: 'moon', avatarEmoji: '🌙' }
  }
}
