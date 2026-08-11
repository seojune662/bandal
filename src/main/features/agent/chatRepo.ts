/**
 * Chat persistence: agent_sessions / messages / message_blocks /
 * permission_grants. Assistant turns are committed atomically on
 * turn-complete; a user message with no matching assistant reply after a
 * crash is closed out by markDanglingInterrupted() at startup.
 */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { AgentProvider } from '../../../shared/types/agent-events'
import type {
  AgentSessionStatus,
  ChatConversationSummary,
  ChatMessage,
  ChatSessionInfo,
  MessageBlock,
  MessageBlockKind
} from '../../../shared/types/chat'
import { nowIso, requireId, requireNonEmptyString } from '../../db/validate'

export const HISTORY_TAIL_LIMIT = 300

export const CONVERSATION_TITLE_MAX = 60

/**
 * Conversation title from the first user message: whitespace (newlines
 * included) collapsed to single spaces, truncated to 60 chars. Shared with the
 * migration backfill so old and new rows derive titles identically.
 */
export function deriveConversationTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX)
}

export interface BlockInput {
  kind: MessageBlockKind
  payload: unknown
}

export interface SessionStartRecord {
  cliSessionId: string
  model: string
  transcriptPath: string | null
  launchConfigJson: string | null
}

export interface ChatRepo {
  /** Live session row by id, or null when it never persisted / was deleted. */
  getSession(sessionId: string): ChatSessionInfo | null
  /** Persists a conversation under a CALLER-supplied id (renderer-minted). */
  createSession(
    sessionId: string,
    courseId: string,
    provider: AgentProvider
  ): ChatSessionInfo
  /** Conversation list for a course; zero-message rows are excluded. */
  listConversations(courseId: string): ChatConversationSummary[]
  /** Sets the title once — later sends never rename the conversation. */
  setTitleIfEmpty(sessionId: string, title: string): void
  softDeleteSession(sessionId: string): void
  /** Persists the resume record once the CLI reports its session id. */
  recordSessionStart(sessionId: string, record: SessionStartRecord): void
  /** Pins a model without touching the resumable CLI session id. */
  setModel(sessionId: string, model: string): void
  setStatus(sessionId: string, status: AgentSessionStatus): void
  nextTurnSeq(sessionId: string): number
  appendMessage(
    courseId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    turnSeq: number,
    blocks: BlockInput[]
  ): ChatMessage
  historyTail(sessionId: string, limit?: number): ChatMessage[]
  /** Startup recovery: closes turns left dangling by a crash. */
  markDanglingInterrupted(): void
  listGrants(courseId: string): string[]
  addGrant(courseId: string, rule: string): void
}

interface SessionRow {
  id: string
  course_id: string
  provider: string
  cli_session_id: string | null
  model: string | null
  status: string
  last_used_at: string | null
  title: string | null
}

interface MessageRow {
  id: string
  course_id: string
  session_id: string
  role: string
  turn_seq: number
  created_at: string
}

interface BlockRow {
  id: string
  message_id: string
  ord: number
  kind: string
  payload_json: string
}

function rowToSessionInfo(row: SessionRow): ChatSessionInfo {
  return {
    id: row.id,
    courseId: row.course_id,
    provider: row.provider as AgentProvider,
    cliSessionId: row.cli_session_id,
    model: row.model,
    status: row.status as AgentSessionStatus,
    lastUsedAt: row.last_used_at,
    title: row.title
  }
}

function parsePayload(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function createChatRepo(db: Database): ChatRepo {
  function insertMessageTx(
    courseId: string,
    sessionId: string,
    role: 'user' | 'assistant',
    turnSeq: number,
    blocks: BlockInput[]
  ): ChatMessage {
    const now = nowIso()
    const messageId = randomUUID()
    db.prepare(
      `INSERT INTO messages (id, course_id, session_id, role, turn_seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(messageId, courseId, sessionId, role, turnSeq, now, now)

    const insertBlock = db.prepare(
      `INSERT INTO message_blocks (id, message_id, ord, kind, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const resultBlocks: MessageBlock[] = blocks.map((block, ord) => {
      const blockId = randomUUID()
      insertBlock.run(
        blockId,
        messageId,
        ord,
        block.kind,
        JSON.stringify(block.payload ?? null),
        now,
        now
      )
      return {
        id: blockId,
        messageId,
        ord,
        kind: block.kind,
        payload: block.payload
      }
    })

    return {
      id: messageId,
      courseId,
      sessionId,
      role,
      turnSeq,
      blocks: resultBlocks,
      createdAt: now
    }
  }

  return {
    getSession(sessionId) {
      const row = db
        .prepare(
          `SELECT * FROM agent_sessions WHERE id = ? AND deleted_at IS NULL`
        )
        .get(requireId(sessionId, 'sessionId')) as SessionRow | undefined
      return row === undefined ? null : rowToSessionInfo(row)
    },

    createSession(sessionId, courseId, provider) {
      const id = requireId(sessionId, 'sessionId')
      const course = requireId(courseId, 'courseId')
      const now = nowIso()
      db.prepare(
        `INSERT INTO agent_sessions
           (id, course_id, provider, cli_session_id, model, status, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, 'idle', NULL, ?, ?)`
      ).run(id, course, provider, now, now)
      return {
        id,
        courseId: course,
        provider,
        cliSessionId: null,
        model: null,
        status: 'idle',
        lastUsedAt: null,
        title: null
      }
    },

    listConversations(courseId) {
      // INNER JOIN on messages drops zero-message conversations: a tab that
      // was opened but never used must not clutter the list.
      const rows = db
        .prepare(
          `SELECT s.id, s.course_id, s.provider, s.title, s.model,
                  s.last_used_at, s.created_at, COUNT(m.id) AS message_count
             FROM agent_sessions s
             JOIN messages m ON m.session_id = s.id AND m.deleted_at IS NULL
            WHERE s.course_id = ? AND s.deleted_at IS NULL
            GROUP BY s.id
            ORDER BY COALESCE(s.last_used_at, s.created_at) DESC`
        )
        .all(requireId(courseId, 'courseId')) as {
        id: string
        course_id: string
        provider: string
        title: string | null
        model: string | null
        last_used_at: string | null
        created_at: string
        message_count: number
      }[]
      return rows.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        provider: row.provider as AgentProvider,
        title: row.title,
        model: row.model,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
        messageCount: row.message_count
      }))
    },

    setTitleIfEmpty(sessionId, title) {
      const clean = requireNonEmptyString(title, 'title').trim()
      db.prepare(
        `UPDATE agent_sessions SET title = ?, updated_at = ?
         WHERE id = ? AND (title IS NULL OR title = '')`
      ).run(clean, nowIso(), requireId(sessionId, 'sessionId'))
    },

    softDeleteSession(sessionId) {
      const now = nowIso()
      db.prepare(
        `UPDATE agent_sessions SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      ).run(now, now, requireId(sessionId, 'sessionId'))
    },

    recordSessionStart(sessionId, record) {
      db.prepare(
        `UPDATE agent_sessions
         SET cli_session_id = ?, model = ?, transcript_path = ?,
             launch_config_json = ?, last_used_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        record.cliSessionId,
        record.model,
        record.transcriptPath,
        record.launchConfigJson,
        nowIso(),
        nowIso(),
        requireId(sessionId, 'sessionId')
      )
    },

    setModel(sessionId, model) {
      db.prepare(
        `UPDATE agent_sessions SET model = ?, updated_at = ? WHERE id = ?`
      ).run(
        requireNonEmptyString(model, 'model').trim(),
        nowIso(),
        requireId(sessionId, 'sessionId')
      )
    },

    setStatus(sessionId, status) {
      db.prepare(
        `UPDATE agent_sessions
         SET status = ?, last_used_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(status, nowIso(), nowIso(), requireId(sessionId, 'sessionId'))
    },

    nextTurnSeq(sessionId) {
      const row = db
        .prepare(
          `SELECT MAX(turn_seq) AS max FROM messages
           WHERE session_id = ? AND deleted_at IS NULL`
        )
        .get(requireId(sessionId, 'sessionId')) as { max: number | null }
      return (row.max ?? 0) + 1
    },

    appendMessage(courseId, sessionId, role, turnSeq, blocks) {
      const insert = db.transaction(() =>
        insertMessageTx(
          requireId(courseId, 'courseId'),
          requireId(sessionId, 'sessionId'),
          role,
          turnSeq,
          blocks
        )
      )
      return insert()
    },

    historyTail(sessionId, limit = HISTORY_TAIL_LIMIT) {
      const id = requireId(sessionId, 'sessionId')
      const rows = db
        .prepare(
          `SELECT * FROM (
             SELECT * FROM messages
             WHERE session_id = ? AND deleted_at IS NULL
             ORDER BY turn_seq DESC, CASE role WHEN 'user' THEN 1 ELSE 0 END, created_at DESC
             LIMIT ?
           ) ORDER BY turn_seq ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END, created_at ASC`
        )
        .all(id, limit) as MessageRow[]
      const blockStmt = db.prepare(
        `SELECT * FROM message_blocks
         WHERE message_id = ? AND deleted_at IS NULL
         ORDER BY ord ASC`
      )
      return rows.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        sessionId: row.session_id,
        role: row.role as 'user' | 'assistant',
        turnSeq: row.turn_seq,
        createdAt: row.created_at,
        blocks: (blockStmt.all(row.id) as BlockRow[]).map((block) => ({
          id: block.id,
          messageId: block.message_id,
          ord: block.ord,
          kind: block.kind as MessageBlockKind,
          payload: parsePayload(block.payload_json)
        }))
      }))
    },

    markDanglingInterrupted() {
      const recover = db.transaction(() => {
        const running = db
          .prepare(
            `SELECT * FROM agent_sessions
             WHERE status = 'running' AND deleted_at IS NULL`
          )
          .all() as SessionRow[]
        for (const session of running) {
          const dangling = db
            .prepare(
              `SELECT u.turn_seq FROM messages u
               WHERE u.session_id = ? AND u.role = 'user' AND u.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM messages a
                   WHERE a.session_id = u.session_id AND a.role = 'assistant'
                     AND a.turn_seq = u.turn_seq AND a.deleted_at IS NULL
                 )`
            )
            .all(session.id) as { turn_seq: number }[]
          for (const { turn_seq } of dangling) {
            insertMessageTx(session.course_id, session.id, 'assistant', turn_seq, [
              { kind: 'text', payload: { text: '', interrupted: true } }
            ])
          }
          db.prepare(
            `UPDATE agent_sessions SET status = 'idle', updated_at = ? WHERE id = ?`
          ).run(nowIso(), session.id)
        }
      })
      recover()
    },

    listGrants(courseId) {
      const rows = db
        .prepare(
          `SELECT rule FROM permission_grants
           WHERE course_id = ? AND deleted_at IS NULL`
        )
        .all(requireId(courseId, 'courseId')) as { rule: string }[]
      return rows.map((row) => row.rule)
    },

    addGrant(courseId, rule) {
      const id = requireId(courseId, 'courseId')
      const cleanRule = requireNonEmptyString(rule, 'rule').trim()
      const exists = db
        .prepare(
          `SELECT 1 FROM permission_grants
           WHERE course_id = ? AND rule = ? AND deleted_at IS NULL`
        )
        .get(id, cleanRule)
      if (exists !== undefined) {
        return
      }
      const now = nowIso()
      db.prepare(
        `INSERT INTO permission_grants (id, course_id, rule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), id, cleanRule, now, now)
    }
  }
}
