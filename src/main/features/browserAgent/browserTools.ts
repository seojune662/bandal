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
import {
  GRANT_DAYS,
  normalizeOrigin,
  type BrowserCapability,
  type GrantsRepo
} from './grants'
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
  /**
   * Downloads a URL through the browsing session and files it in the course.
   * Injected rather than reached for directly so this module stays testable
   * without Electron, and so the caller keeps owning the per-turn budget and
   * the undo journal.
   */
  collect?: (input: {
    courseId: string
    url: string
    dirRelPath: string
  }) => Promise<{ relPath: string }>
  /**
   * Asks the student. Reuses the app's own confirmer rather than the CLI's
   * permission flow, for the reason already documented in
   * `agentTools/confirm.ts`: Codex's `respondPermission` is a no-op, so a
   * provider permission card would leave that provider unguarded.
   */
  confirm: (request: {
    courseId: string
    tool: string
    summary: string
    details: string[]
  }) => Promise<boolean>
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

  const CAPABILITY_LABEL: Record<BrowserCapability, string> = {
    read: '읽기',
    interact: '조작',
    download: '내려받기'
  }

  /**
   * Deny-list, scheme, and the student's grant — and, when only the grant is
   * missing, the ask that creates one.
   *
   * The ask is how a grant comes into existence at all: there is no settings
   * switch that pre-authorises an origin, because a permission granted away
   * from the moment it is used is one nobody thinks about.
   */
  async function gate(
    url: string,
    capability: BrowserCapability
  ): Promise<{ ok: true } | { ok: false; message: string }> {
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

    if (verdict.allowed) {
      if (held !== null) deps.grants.touch(held.id)
      return { ok: true }
    }

    // Anything other than a missing grant is categorical — a 수강신청 page is
    // refused because of what it is, and asking would imply otherwise.
    if (verdict.reason !== 'no-grant') {
      audit('denied', url, `${verdict.reason}: ${verdict.message}`)
      return { ok: false, message: verdict.message }
    }

    const origin = normalizeOrigin(url)
    if (origin === null) {
      audit('denied', url, 'malformed origin')
      return { ok: false, message: verdict.message }
    }

    const approved = await deps.confirm({
      courseId: deps.courseId,
      tool: 'browser_access',
      summary: `${origin}에 ${CAPABILITY_LABEL[capability]} 권한을 허용할까요?`,
      details: [
        `이 과목에서만, ${GRANT_DAYS}일 동안 유효합니다.`,
        '설정 > AI > 에이전트 접근 권한에서 언제든 해제할 수 있습니다.'
      ]
    })
    if (!approved) {
      audit('denied', url, '학생이 거부함')
      return { ok: false, message: '학생이 접근을 허용하지 않았어요.' }
    }

    const created = deps.grants.grant({
      courseId: deps.courseId,
      url: origin,
      capability
    })
    if (created === null) {
      return { ok: false, message: verdict.message }
    }
    audit('grant', origin, `${CAPABILITY_LABEL[capability]} · ${GRANT_DAYS}일`)
    deps.grants.touch(created.id)
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

    /**
     * The whole list, not just what is new. `lms_new_items` answers "anything
     * I have not seen"; this answers "what is there", which is what collecting
     * this week's handouts needs.
     */
    async lms_list(
      courseId: string,
      rawKind: string | null
    ): Promise<
      | { status: 'ok'; kind: LmsListKind; items: { title: string; at: string | null; url: string }[] }
      | { status: 'error'; message: string }
    > {
      const kind: LmsListKind = LIST_KINDS.includes(rawKind as LmsListKind)
        ? (rawKind as LmsListKind)
        : 'files'
      const target = targetFor(courseId)
      if (target === null) {
        return {
          status: 'error',
          message:
            '이 과목에 학교 강의실이 연결돼 있지 않아요. 과목 링크를 먼저 추가해 주세요.'
        }
      }
      const permitted = await gate(target.origin, 'read')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const result = await fetchLmsList({ fetch: deps.fetch }, target, kind)
      if (result.status !== 'ok') {
        audit('read', target.origin, `${kind}: ${result.message}`)
        return { status: 'error', message: result.message }
      }
      audit('read', target.origin, `${kind}: ${result.items.length}건 조회`)
      return {
        status: 'ok',
        kind,
        items: result.items.map((item) => ({
          title: item.title,
          at: item.at,
          url: item.url
        }))
      }
    },

    /**
     * Pulls one file into the course folder.
     *
     * Needs its own `download` capability: reading a page and taking files off
     * it are separate decisions, and a read grant must never imply this.
     */
    async browser_download(
      courseId: string,
      url: string,
      dirRelPath: string
    ): Promise<
      { status: 'ok'; relPath: string } | { status: 'error'; message: string }
    > {
      if (deps.collect === undefined) {
        return { status: 'error', message: '이 대화에서는 내려받을 수 없어요.' }
      }
      const permitted = await gate(url, 'download')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      try {
        const { relPath } = await deps.collect({ courseId, url, dirRelPath })
        audit('download', url, `자료 «${relPath}»`)
        return { status: 'ok', relPath }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '내려받지 못했어요.'
        audit('download', url, `실패: ${message}`)
        return { status: 'error', message }
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

      const permitted = await gate(target.origin, 'read')
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
