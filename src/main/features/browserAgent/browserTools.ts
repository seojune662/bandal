/**
 * The agent's read-only view of a course's LMS.
 *
 * Two tools, and neither opens a page: `course_links` already knows the
 * platform host and the course id, so the answer comes from a JSON endpoint
 * over the session the student logged into by hand. That makes this the
 * lowest-risk rung of the whole agent plan — nothing is clicked, nothing is
 * typed, nothing is written to the web — while answering the question
 * students actually ask every day.
 *
 * Everything still passes the same gate as a navigation would: hard-denied
 * origins are refused, a grant is required, and every call is audited. A read
 * being cheap is not a reason to make it unaccountable.
 */

import type { AuditRepo } from './audit'
import type { BrowserCapability, GrantsRepo } from './grants'
import { checkNavigation } from './navigation'
import { redactText, redactUrl } from './redact'
import { itemKey, type SeenRepo } from './seenRepo'
import {
  fetchLmsList,
  lmsTargetFor,
  type LmsListKind,
  type LmsTarget
} from './siteRecipes'
import type { CourseLinkSpec } from '../../../shared/types/university'

const LIST_KINDS: readonly LmsListKind[] = [
  'announcements',
  'assignments',
  'modules',
  'files'
]

export interface BrowserToolsDeps {
  courseId: string
  /** Groups a turn's audit rows, same id the app tools journal under. */
  getRunId: () => string
  grants: GrantsRepo
  audit: AuditRepo
  seen: SeenRepo
  /** The course's saved LMS links. */
  courseLinks: (courseId: string) => {
    url: string
    lmsCourseId: string | null
  }[]
  /** The active school's spec for a URL, so we know the platform. */
  specFor: (url: string) => Pick<CourseLinkSpec, 'platform'> | null
  /** Browsing-partition fetch — the student's own login. */
  fetch: (url: string) => Promise<Response>
}

export interface LmsCoursePageResult {
  url: string | null
  platform: string | null
}

export function createBrowserTools(deps: BrowserToolsDeps) {
  function targetFor(courseId: string): LmsTarget | null {
    for (const link of deps.courseLinks(courseId)) {
      const target = lmsTargetFor(link, deps.specFor(link.url))
      if (target !== null) return target
    }
    return null
  }

  function audit(
    action: Parameters<AuditRepo['record']>[0]['action'],
    url: string,
    detail: string
  ): void {
    deps.audit.record({
      courseId: deps.courseId,
      runId: deps.getRunId(),
      action,
      url: redactUrl(url),
      detail: redactText(detail)
    })
  }

  /** Shared gate: deny-list, scheme, and the student's grant. */
  function gate(
    url: string,
    capability: BrowserCapability
  ): { ok: true } | { ok: false; message: string } {
    const held = deps.grants.find({
      courseId: deps.courseId,
      url,
      capability
    })
    const verdict = checkNavigation({
      url,
      capability,
      heldCapability: held?.capability ?? null
    })
    if (!verdict.allowed) {
      audit('denied', url, `${verdict.reason}: ${verdict.message}`)
      return { ok: false, message: verdict.message }
    }
    if (held !== null) deps.grants.touch(held.id)
    return { ok: true }
  }

  return {
    lms_course_page(courseId: string): LmsCoursePageResult {
      const target = targetFor(courseId)
      if (target === null) return { url: null, platform: null }
      return {
        url: `${target.origin}/courses/${target.lmsCourseId}`,
        platform: target.platform
      }
    },

    async lms_new_items(
      courseId: string,
      rawKind: string | null
    ): Promise<
      | { status: 'ok'; kind: LmsListKind; items: { title: string; at: string | null; url: string }[]; firstRun: boolean }
      | { status: 'error'; message: string }
    > {
      const kind: LmsListKind = LIST_KINDS.includes(rawKind as LmsListKind)
        ? (rawKind as LmsListKind)
        : 'announcements'

      const target = targetFor(courseId)
      if (target === null) {
        return {
          status: 'error',
          message:
            '이 과목에 학교 강의실이 연결돼 있지 않아요. 과목 링크를 먼저 추가해 주세요.'
        }
      }

      const permitted = gate(target.origin, 'read')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const result = await fetchLmsList({ fetch: deps.fetch }, target, kind)
      if (result.status !== 'ok') {
        audit('read', target.origin, `${kind}: ${result.message}`)
        return { status: 'error', message: result.message }
      }

      const listKey = `${target.origin}|${target.lmsCourseId}|${kind}`
      const seenItems = result.items.map((item) => ({
        key: itemKey(item.id, item.title, item.at),
        title: item.title
      }))

      // The first look at a list is not "new" — otherwise the very first
      // question dumps the whole semester back at the student.
      const firstRun = !deps.seen.has(courseId, listKey)
      if (firstRun) {
        deps.seen.seed({ courseId, listKey, items: seenItems })
        audit('read', target.origin, `${kind}: 처음 확인 (${seenItems.length}건 기록)`)
        return { status: 'ok', kind, items: [], firstRun: true }
      }

      const fresh = deps.seen.diffAndRecord({
        courseId,
        listKey,
        items: seenItems
      })
      const freshKeys = new Set(fresh.map((item) => item.key))
      const items = result.items
        .filter((item) => freshKeys.has(itemKey(item.id, item.title, item.at)))
        .map((item) => ({ title: item.title, at: item.at, url: item.url }))

      audit('read', target.origin, `${kind}: 새 항목 ${items.length}건`)
      return { status: 'ok', kind, items, firstRun: false }
    }
  }
}
