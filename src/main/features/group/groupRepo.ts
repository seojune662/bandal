/**
 * Local mirror of the remote group world (migration 005).
 *
 * ⚠ The truth model is INVERTED relative to Phase 1. For courses / materials /
 * notes / board / AI chat, SQLite *is* the truth. Here the remote Postgres is
 * the truth and these tables are a render cache plus a durable outbox — the
 * same relationship `materials_index` has with the disk, so the concept is
 * already in the codebase (docs/phase2-community.md §3.2).
 *
 * The practical payoff: the 함께하기 rail and a reopened group tab render from
 * disk with ZERO network round trips, and a queued message survives an app
 * restart because the queue is a table, not a memory array.
 *
 * NAME COLLISION: `groupRepo` / `GroupMessage` is the REMOTE chat.
 * `chatRepo` / `ChatMessage` is the LOCAL AI tutor. Never mix them (§3.4).
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  GroupAuthor,
  GroupMember,
  GroupMessage,
  GroupRole,
  GroupSummary,
  PendingGroupMessage
} from '../../../shared/types/group'
import { ValidationError } from '../../db/errors'
import { nowIso, requireId } from '../../db/validate'

/** Per-group cache ceiling (§3.2). Trimmed when a channel closes. */
export const MESSAGE_CACHE_LIMIT = 500

/** Outbox attempts before a row is parked as `failed` (§4.4). */
export const MAX_OUTBOX_ATTEMPTS = 6

const ROLES: readonly GroupRole[] = ['owner', 'admin', 'member']

interface LinkRow {
  id: string
  course_id: string | null
  remote_group_id: string
  name_cache: string
  color_cache: string
  member_count_cache: number
  unread_cache: number
  last_msg_at_cache: string | null
  joined_at: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface MessageRow {
  id: string
  group_id: string
  seq: number
  author_id: string
  kind: string
  body: string
  reply_to: string | null
  author_json: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

interface OutboxRow {
  id: string
  group_id: string
  body: string
  reply_to: string | null
  state: string
  attempts: number
  last_error: string | null
  next_try_at: string | null
  created_at: string
  updated_at: string
}

interface MemberRow {
  group_id: string
  user_id: string
  role: string
  joined_at: string
  nickname: string | null
  avatar_color: string | null
  avatar_emoji: string | null
}

const FALLBACK_AUTHOR: GroupAuthor = {
  nickname: '알 수 없음',
  avatarColor: 'moon',
  avatarEmoji: '🌙'
}

function parseAuthor(json: string): GroupAuthor {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return FALLBACK_AUTHOR
    const record = parsed as Record<string, unknown>
    return {
      nickname:
        typeof record['nickname'] === 'string' && record['nickname'] !== ''
          ? record['nickname']
          : FALLBACK_AUTHOR.nickname,
      avatarColor:
        typeof record['avatarColor'] === 'string'
          ? record['avatarColor']
          : FALLBACK_AUTHOR.avatarColor,
      avatarEmoji:
        typeof record['avatarEmoji'] === 'string'
          ? record['avatarEmoji']
          : FALLBACK_AUTHOR.avatarEmoji
    }
  } catch {
    return FALLBACK_AUTHOR
  }
}

function rowToSummary(row: LinkRow): GroupSummary {
  return {
    id: row.remote_group_id,
    name: row.name_cache,
    color: row.color_cache,
    courseId: row.course_id,
    memberCount: row.member_count_cache,
    unread: row.unread_cache,
    lastMsgAt: row.last_msg_at_cache,
    joinedAt: row.joined_at
  }
}

function rowToMessage(row: MessageRow): GroupMessage {
  const deleted = row.deleted_at !== null
  return {
    id: row.id,
    groupId: row.group_id,
    seq: row.seq,
    authorId: row.author_id,
    kind: row.kind === 'system' ? 'system' : 'text',
    body: deleted ? null : row.body,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted,
    author: parseAuthor(row.author_json)
  }
}

function rowToPending(row: OutboxRow): PendingGroupMessage {
  const state =
    row.state === 'sending' || row.state === 'failed' ? row.state : 'pending'
  return {
    localId: row.id,
    groupId: row.group_id,
    body: row.body,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    state,
    attempts: row.attempts,
    lastError: row.last_error
  }
}

function rowToMember(row: MemberRow): GroupMember {
  return {
    groupId: row.group_id,
    userId: row.user_id,
    role: (ROLES.includes(row.role as GroupRole) ? row.role : 'member') as GroupRole,
    joinedAt: row.joined_at,
    nickname: row.nickname ?? FALLBACK_AUTHOR.nickname,
    avatarColor: row.avatar_color ?? FALLBACK_AUTHOR.avatarColor,
    avatarEmoji: row.avatar_emoji ?? FALLBACK_AUTHOR.avatarEmoji
  }
}

/** Upsert shape used when a group is created / joined / reconciled. */
export interface GroupUpsert {
  id: string
  name: string
  color: string
  memberCount?: number
  unread?: number
  lastMsgAt?: string | null
  joinedAt?: string
  courseId?: string | null
}

export interface GroupRepo {
  // -- course_group_links ---------------------------------------------------
  listGroups(): GroupSummary[]
  getGroup(groupId: string): GroupSummary | null
  upsertGroup(input: GroupUpsert): GroupSummary
  linkCourse(groupId: string, courseId: string | null): GroupSummary
  setUnread(groupId: string, unread: number, lastMsgAt: string | null): void
  removeGroup(groupId: string): void
  /** Drops links whose group is gone remotely; keeps the rail honest. */
  retainGroups(remoteGroupIds: readonly string[]): void

  // -- group_messages_cache -------------------------------------------------
  tailMessages(groupId: string, limit: number): GroupMessage[]
  messagesBefore(groupId: string, beforeSeq: number, limit: number): GroupMessage[]
  upsertMessages(messages: readonly GroupMessage[]): void
  markMessageDeleted(messageId: string, body: string | null, deleted: boolean): void
  maxSeq(groupId: string): number
  trimCache(groupId: string, keep?: number): void

  // -- group_outbox ---------------------------------------------------------
  enqueue(input: { groupId: string; body: string; replyTo?: string | null }): PendingGroupMessage
  pendingFor(groupId: string): PendingGroupMessage[]
  /** Rows eligible to send right now (state pending and backoff elapsed). */
  claimable(now?: string): PendingGroupMessage[]
  markSending(localId: string): void
  markSent(localId: string): void
  markRetry(localId: string, error: string, nextTryAt: string): PendingGroupMessage | null
  markFailed(localId: string, error: string): void
  requeue(localId: string): PendingGroupMessage | null
  /** Resets rows stranded in `sending` by a crash — called once on startup. */
  releaseStranded(): void

  // -- caches ---------------------------------------------------------------
  replaceMembers(groupId: string, members: readonly GroupMember[]): void
  listMembers(groupId: string): GroupMember[]
  upsertProfiles(profiles: readonly GroupMember[]): void
  /** Autocomplete source for the invite palette — offline, prefix, local. */
  searchProfiles(prefix: string, limit?: number): GroupMember[]
  /** Wipes every Phase-2 cache. Used on sign-out. */
  clearAll(): void
}

export function createGroupRepo(db: Database): GroupRepo {
  const getLink = db.prepare(
    'SELECT * FROM course_group_links WHERE remote_group_id = ? AND deleted_at IS NULL'
  )
  const getAnyLink = db.prepare(
    'SELECT * FROM course_group_links WHERE remote_group_id = ?'
  )

  function linkRow(groupId: string): LinkRow | null {
    return (getLink.get(groupId) as LinkRow | undefined) ?? null
  }

  function requireLink(groupId: string): LinkRow {
    const row = linkRow(groupId)
    if (row === null) {
      throw new ValidationError(`unknown group ${groupId}`)
    }
    return row
  }

  const dropGroup = db.transaction((id: string, now: string) => {
    db.prepare(
      'UPDATE course_group_links SET deleted_at = ?, updated_at = ? WHERE remote_group_id = ?'
    ).run(now, now, id)
    db.prepare('DELETE FROM group_messages_cache WHERE group_id = ?').run(id)
    db.prepare('DELETE FROM group_members_cache WHERE group_id = ?').run(id)
    db.prepare('DELETE FROM group_outbox WHERE group_id = ?').run(id)
  })

  const upsertProfileRows = db.transaction((list: readonly GroupMember[]) => {
    const statement = db.prepare(
      `INSERT INTO group_profiles_cache
         (user_id, nickname, avatar_color, avatar_emoji, fetched_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         nickname = excluded.nickname,
         avatar_color = excluded.avatar_color,
         avatar_emoji = excluded.avatar_emoji,
         fetched_at = excluded.fetched_at`
    )
    const now = nowIso()
    for (const profile of list) {
      statement.run(
        profile.userId,
        profile.nickname,
        profile.avatarColor,
        profile.avatarEmoji,
        now
      )
    }
  })

  return {
    listGroups() {
      const rows = db
        .prepare(
          `SELECT * FROM course_group_links
           WHERE deleted_at IS NULL
           ORDER BY (last_msg_at_cache IS NULL), last_msg_at_cache DESC, name_cache ASC`
        )
        .all() as LinkRow[]
      return rows.map(rowToSummary)
    },

    getGroup(groupId) {
      const row = linkRow(requireId(groupId, 'groupId'))
      return row === null ? null : rowToSummary(row)
    },

    upsertGroup(input) {
      const groupId = requireId(input.id, 'id')
      const now = nowIso()
      const existing = linkRow(groupId)
      if (existing !== null) {
        const next: LinkRow = {
          ...existing,
          name_cache: input.name,
          color_cache: input.color,
          member_count_cache: input.memberCount ?? existing.member_count_cache,
          unread_cache: input.unread ?? existing.unread_cache,
          last_msg_at_cache:
            input.lastMsgAt === undefined
              ? existing.last_msg_at_cache
              : input.lastMsgAt,
          // `courseId: undefined` must NOT unlink — only an explicit null does.
          course_id:
            input.courseId === undefined ? existing.course_id : input.courseId,
          updated_at: now
        }
        db.prepare(
          `UPDATE course_group_links
              SET course_id = ?, name_cache = ?, color_cache = ?,
                  member_count_cache = ?, unread_cache = ?,
                  last_msg_at_cache = ?, updated_at = ?
            WHERE id = ?`
        ).run(
          next.course_id,
          next.name_cache,
          next.color_cache,
          next.member_count_cache,
          next.unread_cache,
          next.last_msg_at_cache,
          now,
          existing.id
        )
        return rowToSummary(next)
      }

      // `linkRow` deliberately hides soft-deleted rows, but the UNIQUE remote
      // id still sees them. Preserve only the local course link when omitted;
      // every cache value below belongs to the new membership period.
      const deleted = (getAnyLink.get(groupId) as LinkRow | undefined) ?? null
      const row: LinkRow = {
        id: deleted?.id ?? randomUUID(),
        course_id:
          input.courseId === undefined
            ? (deleted?.course_id ?? null)
            : input.courseId,
        remote_group_id: groupId,
        name_cache: input.name,
        color_cache: input.color,
        member_count_cache: input.memberCount ?? 1,
        unread_cache: input.unread ?? 0,
        last_msg_at_cache: input.lastMsgAt ?? null,
        // A restored membership starts a new membership period. Prefer the
        // server timestamp when available and otherwise use the local join.
        joined_at: input.joinedAt ?? now,
        created_at: deleted?.created_at ?? now,
        updated_at: now,
        deleted_at: null
      }
      db.prepare(
        `INSERT INTO course_group_links
           (id, course_id, remote_group_id, name_cache, color_cache,
            member_count_cache, unread_cache, last_msg_at_cache, joined_at,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(remote_group_id) DO UPDATE SET
           course_id = excluded.course_id,
           name_cache = excluded.name_cache,
           color_cache = excluded.color_cache,
           member_count_cache = excluded.member_count_cache,
           unread_cache = excluded.unread_cache,
           last_msg_at_cache = excluded.last_msg_at_cache,
           joined_at = excluded.joined_at,
           updated_at = excluded.updated_at,
           deleted_at = NULL`
      ).run(
        row.id,
        row.course_id,
        row.remote_group_id,
        row.name_cache,
        row.color_cache,
        row.member_count_cache,
        row.unread_cache,
        row.last_msg_at_cache,
        row.joined_at,
        row.created_at,
        row.updated_at,
        row.deleted_at
      )
      return rowToSummary(row)
    },

    linkCourse(groupId, courseId) {
      const row = requireLink(requireId(groupId, 'groupId'))
      if (courseId !== null) {
        const course = db
          .prepare('SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL')
          .get(courseId)
        if (course === undefined) {
          throw new ValidationError(`unknown course ${courseId}`)
        }
      }
      const now = nowIso()
      db.prepare(
        'UPDATE course_group_links SET course_id = ?, updated_at = ? WHERE id = ?'
      ).run(courseId, now, row.id)
      return rowToSummary({ ...row, course_id: courseId, updated_at: now })
    },

    setUnread(groupId, unread, lastMsgAt) {
      db.prepare(
        `UPDATE course_group_links
            SET unread_cache = ?, last_msg_at_cache = ?, updated_at = ?
          WHERE remote_group_id = ?`
      ).run(Math.max(0, Math.trunc(unread)), lastMsgAt, nowIso(), groupId)
    },

    removeGroup(groupId) {
      dropGroup(requireId(groupId, 'groupId'), nowIso())
    },

    retainGroups(remoteGroupIds) {
      const live = new Set(remoteGroupIds)
      const rows = db
        .prepare(
          'SELECT remote_group_id FROM course_group_links WHERE deleted_at IS NULL'
        )
        .all() as { remote_group_id: string }[]
      const now = nowIso()
      for (const row of rows) {
        if (!live.has(row.remote_group_id)) {
          dropGroup(row.remote_group_id, now)
        }
      }
    },

    tailMessages(groupId, limit) {
      const rows = db
        .prepare(
          `SELECT * FROM group_messages_cache
            WHERE group_id = ?
            ORDER BY seq DESC
            LIMIT ?`
        )
        .all(groupId, Math.max(1, Math.trunc(limit))) as MessageRow[]
      // Query is newest-first for the index; the renderer always wants
      // oldest → newest.
      return rows.reverse().map(rowToMessage)
    },

    messagesBefore(groupId, beforeSeq, limit) {
      const rows = db
        .prepare(
          `SELECT * FROM group_messages_cache
            WHERE group_id = ? AND seq < ?
            ORDER BY seq DESC
            LIMIT ?`
        )
        .all(groupId, beforeSeq, Math.max(1, Math.trunc(limit))) as MessageRow[]
      return rows.reverse().map(rowToMessage)
    },

    upsertMessages(messages) {
      if (messages.length === 0) return
      const statement = db.prepare(
        `INSERT INTO group_messages_cache
           (id, group_id, seq, author_id, kind, body, reply_to, author_json,
            created_at, edited_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           seq = excluded.seq,
           body = excluded.body,
           author_json = excluded.author_json,
           edited_at = excluded.edited_at,
           deleted_at = excluded.deleted_at`
      )
      const run = db.transaction((batch: readonly GroupMessage[]) => {
        for (const message of batch) {
          statement.run(
            message.id,
            message.groupId,
            message.seq,
            message.authorId,
            message.kind,
            message.body ?? '',
            message.replyTo,
            JSON.stringify(message.author),
            message.createdAt,
            message.editedAt,
            message.deleted ? message.editedAt ?? message.createdAt : null
          )
        }
      })
      run(messages)
    },

    markMessageDeleted(messageId, body, deleted) {
      db.prepare(
        `UPDATE group_messages_cache
            SET body = ?, deleted_at = ?
          WHERE id = ?`
      ).run(body ?? '', deleted ? nowIso() : null, messageId)
    },

    maxSeq(groupId) {
      const row = db
        .prepare(
          'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM group_messages_cache WHERE group_id = ?'
        )
        .get(groupId) as { max_seq: number }
      return row.max_seq
    },

    trimCache(groupId, keep = MESSAGE_CACHE_LIMIT) {
      db.prepare(
        `DELETE FROM group_messages_cache
          WHERE group_id = ?
            AND id NOT IN (
              SELECT id FROM group_messages_cache
               WHERE group_id = ?
               ORDER BY seq DESC
               LIMIT ?
            )`
      ).run(groupId, groupId, Math.max(1, Math.trunc(keep)))
    },

    enqueue(input) {
      const groupId = requireId(input.groupId, 'groupId')
      const body = input.body.trim()
      if (body.length === 0) {
        throw new ValidationError('body must be a non-empty string')
      }
      if (body.length > 4000) {
        throw new ValidationError('body must be at most 4000 characters')
      }
      const now = nowIso()
      // The outbox id BECOMES the remote messages.id — client-generated PKs
      // are what make an infinitely retried insert idempotent (§4.4).
      const row: OutboxRow = {
        id: randomUUID(),
        group_id: groupId,
        body,
        reply_to: input.replyTo ?? null,
        state: 'pending',
        attempts: 0,
        last_error: null,
        next_try_at: now,
        created_at: now,
        updated_at: now
      }
      db.prepare(
        `INSERT INTO group_outbox
           (id, group_id, body, reply_to, state, attempts, last_error,
            next_try_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.group_id,
        row.body,
        row.reply_to,
        row.state,
        row.attempts,
        row.last_error,
        row.next_try_at,
        row.created_at,
        row.updated_at
      )
      return rowToPending(row)
    },

    pendingFor(groupId) {
      const rows = db
        .prepare(
          'SELECT * FROM group_outbox WHERE group_id = ? ORDER BY created_at ASC'
        )
        .all(groupId) as OutboxRow[]
      return rows.map(rowToPending)
    },

    claimable(now = nowIso()) {
      const rows = db
        .prepare(
          `SELECT * FROM group_outbox
            WHERE state = 'pending'
              AND (next_try_at IS NULL OR next_try_at <= ?)
            ORDER BY created_at ASC`
        )
        .all(now) as OutboxRow[]
      return rows.map(rowToPending)
    },

    markSending(localId) {
      db.prepare(
        "UPDATE group_outbox SET state = 'sending', updated_at = ? WHERE id = ?"
      ).run(nowIso(), localId)
    },

    markSent(localId) {
      // The committed row comes back through broadcast carrying its seq, so
      // the queue entry has no reason to survive.
      db.prepare('DELETE FROM group_outbox WHERE id = ?').run(localId)
    },

    markRetry(localId, error, nextTryAt) {
      const now = nowIso()
      db.prepare(
        `UPDATE group_outbox
            SET state = 'pending', attempts = attempts + 1,
                last_error = ?, next_try_at = ?, updated_at = ?
          WHERE id = ?`
      ).run(error, nextTryAt, now, localId)
      const row = db.prepare('SELECT * FROM group_outbox WHERE id = ?').get(localId) as
        | OutboxRow
        | undefined
      return row === undefined ? null : rowToPending(row)
    },

    markFailed(localId, error) {
      db.prepare(
        `UPDATE group_outbox
            SET state = 'failed', last_error = ?, next_try_at = NULL, updated_at = ?
          WHERE id = ?`
      ).run(error, nowIso(), localId)
    },

    requeue(localId) {
      const now = nowIso()
      db.prepare(
        `UPDATE group_outbox
            SET state = 'pending', attempts = 0, last_error = NULL,
                next_try_at = ?, updated_at = ?
          WHERE id = ?`
      ).run(now, now, localId)
      const row = db.prepare('SELECT * FROM group_outbox WHERE id = ?').get(localId) as
        | OutboxRow
        | undefined
      return row === undefined ? null : rowToPending(row)
    },

    releaseStranded() {
      db.prepare(
        `UPDATE group_outbox
            SET state = 'pending', next_try_at = ?, updated_at = ?
          WHERE state = 'sending'`
      ).run(nowIso(), nowIso())
    },

    replaceMembers(groupId, members) {
      const run = db.transaction(
        (id: string, list: readonly GroupMember[]) => {
          db.prepare('DELETE FROM group_members_cache WHERE group_id = ?').run(id)
          const insert = db.prepare(
            `INSERT INTO group_members_cache (group_id, user_id, role, joined_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(group_id, user_id) DO UPDATE SET role = excluded.role`
          )
          for (const member of list) {
            insert.run(id, member.userId, member.role, member.joinedAt)
          }
        }
      )
      run(groupId, members)
      upsertProfileRows(members)
    },

    listMembers(groupId) {
      const rows = db
        .prepare(
          `SELECT m.group_id, m.user_id, m.role, m.joined_at,
                  p.nickname, p.avatar_color, p.avatar_emoji
             FROM group_members_cache m
             LEFT JOIN group_profiles_cache p ON p.user_id = m.user_id
            WHERE m.group_id = ?
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                     m.joined_at ASC`
        )
        .all(groupId) as MemberRow[]
      return rows.map(rowToMember)
    },

    upsertProfiles(profiles) {
      if (profiles.length === 0) return
      upsertProfileRows(profiles)
    },

    searchProfiles(prefix, limit = 8) {
      const needle = prefix.trim().toLocaleLowerCase()
      if (needle.length === 0) return []
      // Prefix matching happens HERE, never on the server: an exposed
      // server-side prefix search lets anyone scrape the nickname directory
      // (§5.3).
      const rows = db
        .prepare(
          `SELECT '' AS group_id, user_id, 'member' AS role, fetched_at AS joined_at,
                  nickname, avatar_color, avatar_emoji
             FROM group_profiles_cache
            WHERE lower(nickname) LIKE ? ESCAPE '\\'
            ORDER BY fetched_at DESC
            LIMIT ?`
        )
        .all(
          `${needle.replace(/[\\%_]/g, '\\$&')}%`,
          Math.max(1, Math.trunc(limit))
        ) as MemberRow[]
      return rows.map(rowToMember)
    },

    clearAll() {
      const run = db.transaction(() => {
        db.prepare('DELETE FROM group_outbox').run()
        db.prepare('DELETE FROM group_messages_cache').run()
        db.prepare('DELETE FROM group_members_cache').run()
        db.prepare('DELETE FROM group_profiles_cache').run()
        db.prepare('DELETE FROM course_group_links').run()
      })
      run()
    }
  }
}
