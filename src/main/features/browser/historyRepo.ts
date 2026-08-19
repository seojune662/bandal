/**
 * Browser history, kept only to make the omnibox useful.
 *
 * Deliberately narrow: no page content, no full visit log, no analytics. A
 * row is a URL the student reached, how often, and when — which is exactly
 * what ranking a suggestion needs and nothing more. School portal URLs carry
 * student numbers and session keys, so the less of them we keep the better.
 *
 * Pruned on boot rather than on write: a rolling window keeps the table small
 * without adding a delete to the hot path.
 */

import type { Database } from 'better-sqlite3'
import { requireNonEmptyString } from '../../db/validate'

/** How long a visit stays useful for ranking. */
export const HISTORY_RETENTION_DAYS = 90
/** Hard ceiling, so a scripted page cannot grow the table without bound. */
export const HISTORY_MAX_ROWS = 20_000

export interface HistoryEntry {
  url: string
  title: string
  host: string
  courseId: string | null
  visitCount: number
  lastVisitedAt: string
}

export interface RecordVisitInput {
  url: string
  title: string
  courseId: string | null
}

export interface HistoryRepo {
  /** Upserts: a revisit bumps the count and the timestamp, never appends. */
  recordVisit(input: RecordVisitInput, at?: Date): void
  /** Ranked for the omnibox: host-prefix match first, then count, then recency. */
  search(query: string, limit?: number): HistoryEntry[]
  /** `null` clears everything; a course id clears just that course's rows. */
  clear(courseId: string | null): void
  /** Drops rows outside the retention window and above the row ceiling. */
  prune(at?: Date): void
}

interface HistoryRow {
  url: string
  title: string
  host: string
  course_id: string | null
  visit_count: number
  last_visited_at: string
}

function toEntry(row: HistoryRow): HistoryEntry {
  return {
    url: row.url,
    title: row.title,
    host: row.host,
    courseId: row.course_id,
    visitCount: row.visit_count,
    lastVisitedAt: row.last_visited_at
  }
}

/** Bare hostname, `www.` dropped so a prefix match behaves as a student expects. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/**
 * Whether a URL is worth remembering. Search-result pages are excluded: the
 * omnibox creates them itself, so keeping them makes every query suggest the
 * student's own past queries instead of the pages they actually opened.
 */
export function isRecordableUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.replace(/^www\./i, '')
  const isSearchResults =
    (host === 'google.com' && parsed.pathname.startsWith('/search')) ||
    (host === 'search.naver.com') ||
    (host === 'search.daum.net') ||
    (host === 'duckduckgo.com' && parsed.searchParams.has('q'))
  return !isSearchResults
}

export function createHistoryRepo(db: Database): HistoryRepo {
  return {
    recordVisit(input, at = new Date()) {
      const url = requireNonEmptyString(input.url, 'url')
      if (!isRecordableUrl(url)) return
      const host = hostOf(url)
      const title = typeof input.title === 'string' ? input.title : ''
      db.prepare(
        `INSERT INTO browser_history
           (url, title, host, course_id, visit_count, last_visited_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET
           -- Keep the last non-empty title: a page that briefly reports "" mid
           -- load would otherwise wipe a good one.
           title = CASE WHEN excluded.title = '' THEN browser_history.title
                        ELSE excluded.title END,
           course_id = excluded.course_id,
           visit_count = browser_history.visit_count + 1,
           last_visited_at = excluded.last_visited_at`
      ).run(url, title, host, input.courseId, at.toISOString())
    },

    search(query, limit = 8) {
      const trimmed = query.trim().toLowerCase()
      if (trimmed === '') return []
      const like = `%${trimmed}%`
      const rows = db
        .prepare(
          `SELECT * FROM browser_history
             WHERE lower(url) LIKE ? OR lower(title) LIKE ?
             ORDER BY
               -- A host the student is literally typing outranks anything a
               -- raw frequency sort would surface.
               CASE WHEN lower(host) LIKE ? THEN 0 ELSE 1 END,
               visit_count DESC,
               last_visited_at DESC
             LIMIT ?`
        )
        .all(like, like, `${trimmed}%`, limit) as HistoryRow[]
      return rows.map(toEntry)
    },

    clear(courseId) {
      if (courseId === null) {
        db.prepare('DELETE FROM browser_history').run()
        return
      }
      db.prepare('DELETE FROM browser_history WHERE course_id = ?').run(courseId)
    },

    prune(at = new Date()) {
      const cutoff = new Date(
        at.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString()
      db.prepare('DELETE FROM browser_history WHERE last_visited_at < ?').run(
        cutoff
      )
      db.prepare(
        `DELETE FROM browser_history WHERE url IN (
           SELECT url FROM browser_history
             ORDER BY last_visited_at DESC
             LIMIT -1 OFFSET ?
         )`
      ).run(HISTORY_MAX_ROWS)
    }
  }
}
