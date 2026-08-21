import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { redactText } from '../browserAgent/redact'

export type DesktopAuditAction =
  | 'screenshot'
  | 'windows'
  | 'frontmost'
  | 'clipboard'
  | 'grant'
  | 'revoke'
  | 'denied'
  | 'action'

export interface DesktopAuditEntry {
  id: string
  courseId: string
  conversationId: string
  action: DesktopAuditAction
  target: string
  detail: string
  createdAt: string
}

export interface DesktopAuditRepo {
  record(entry: {
    courseId: string
    conversationId: string
    action: DesktopAuditAction
    target: string
    detail: string
  }): void
  recent(courseId: string, limit?: number): DesktopAuditEntry[]
}

interface AuditRow {
  id: string
  course_id: string
  conversation_id: string
  action: DesktopAuditAction
  target: string
  detail: string
  created_at: string
}

function toEntry(row: AuditRow): DesktopAuditEntry {
  return {
    id: row.id,
    courseId: row.course_id,
    conversationId: row.conversation_id,
    action: row.action,
    target: row.target,
    detail: row.detail,
    createdAt: row.created_at
  }
}

export function createDesktopAuditRepo(
  db: Database,
  now: () => Date = () => new Date()
): DesktopAuditRepo {
  return {
    record(entry) {
      db.prepare(
        `INSERT INTO desktop_audit
           (id, course_id, conversation_id, action, target, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        entry.courseId,
        entry.conversationId,
        entry.action,
        redactText(entry.target),
        redactText(entry.detail),
        now().toISOString()
      )
    },

    recent(courseId, limit = 200) {
      const rows = db
        .prepare(
          `SELECT * FROM desktop_audit
            WHERE course_id = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?`
        )
        .all(courseId, Math.max(0, Math.floor(limit))) as AuditRow[]
      return rows.map(toEntry)
    }
  }
}
