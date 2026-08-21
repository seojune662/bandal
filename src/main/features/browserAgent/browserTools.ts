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

import type { AgentConfirmScope } from '../../../shared/types/agentTools'
import type { AuditRepo } from './audit'
import {
  ANY_ORIGIN,
  GRANT_DAYS,
  normalizeOrigin,
  type BrowserCapability,
  type GrantsRepo
} from './grants'
import { checkNavigation } from './navigation'
import { verdictFor } from './pageDriver'
import { resolveRef } from './refs'
import { DEFAULT_SNAPSHOT_CHARS } from './snapshot'
import type { ElementFacts } from './actionPolicy'
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
    /** Offered only for site access; the caller records which one was picked. */
    scopes?: AgentConfirmScope[]
  }) => Promise<AgentConfirmScope | false>
  /**
   * The browser tabs the student can see, as published by the renderer.
   *
   * Deliberately NOT the guest registry: hidden guests are evicted by the LRU
   * and only their last URL survives in the renderer store, so a registry
   * listing would omit tabs that are plainly on screen.
   */
  openTabs?: () => {
    tabs: { tabId: string; title: string; url: string; asleep: boolean }[]
    activeTabId: string | null
  }
  /**
   * Driving a live guest. Absent for conversations that only read the LMS
   * over the session — which is most of them, and the cheapest thing to be.
   */
  page?: PageSurface
  /**
   * Submitting, attaching a file, and using a saved login. Separate from
   * `page` because these are the irreversible ones — a conversation that only
   * reads should not be able to reach them by accident.
   */
  commit?: CommitSurface
}

export interface CommitSurface {
  /** Presses a submit control. Only ever called after an explicit yes. */
  submit: (tabId: string, frameIndex: number, elementIndex: number) => Promise<boolean>
  /** Fills the saved login for the page's origin. Never returns the secret. */
  useSavedLogin: (
    tabId: string
  ) => Promise<{ filled: boolean; username: string | null }>
  /** Attaches a course file to a file input. */
  attachFile: (
    tabId: string,
    frameIndex: number,
    elementIndex: number,
    courseId: string,
    relPath: string
  ) => Promise<boolean>
}

/**
 * Everything the interaction tools need from a live tab, injected so this
 * module stays free of Electron.
 */
export interface PageSurface {
  /** Opens (or reuses) a browser tab and returns its id. */
  openTab: (url: string) => Promise<{ tabId: string; url: string }>
  /**
   * Brings an existing tab forward so its guest mounts again. Returns false
   * if it never came back — the LRU may have dropped it for good.
   */
  wakeTab: (tabId: string) => Promise<boolean>
  /** Current snapshot generation; bumped by the caller on navigation. */
  generation: (tabId: string) => number
  snapshot: (
    tabId: string,
    maxChars: number
  ) => Promise<{ url: string; outline: string } | null>
  read: (
    tabId: string,
    maxChars: number
  ) => Promise<{ url: string; text: string } | null>
  factsFor: (
    tabId: string,
    frameIndex: number,
    elementIndex: number
  ) => Promise<ElementFacts | null>
  /**
   * Acts, waits for the page to settle, and says what happened.
   *
   * It used to return a bare boolean, so a click that navigated and a click
   * that did nothing were the same answer — and the next snapshot was taken
   * against whichever document happened to be committed at that instant,
   * usually the old one, under a generation that still looked valid. A
   * confident wrong picture instead of an error.
   */
  act: (
    tabId: string,
    frameIndex: number,
    elementIndex: number,
    action:
      | { kind: 'click' }
      | { kind: 'type'; text: string }
      | { kind: 'select'; value: string }
  ) => Promise<ActOutcome>
  currentUrl: (tabId: string) => string | null
  /** Suspends the run and asks the student to take over. */
  handoff: (tabId: string, message: string) => Promise<'resumed' | 'stopped'>
  /** Throws if the student pressed 중지. */
  assertLive: () => void
  /** Updates the strip the student is reading. */
  step: (action: string, url?: string) => void
}

export interface ActOutcome {
  ok: boolean
  /** Korean, one line, when `ok` is false. */
  problem: string | null
  /** What a `<select>` actually offers, so a failed pick can be retried. */
  options?: { value: string; label: string }[]
  /** The page AFTER settling. */
  url: string
  title: string
  /** The document changed — every outstanding ref is dead. */
  navigated: boolean
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

  /**
   * The tab's current URL, waking the guest if the LRU dropped it.
   *
   * A hidden guest beyond MAX_LIVE_GUESTS is destroyed while its tab stays on
   * screen. Without this, asking about a tab the student can plainly see
   * answers "그 탭을 찾지 못했어요", which reads as a bug because it is one.
   */
  async function urlOfTab(page: PageSurface, tabId: string): Promise<string | null> {
    const current = page.currentUrl(tabId)
    if (current !== null) return current
    const woke = await page.wakeTab(tabId)
    return woke ? page.currentUrl(tabId) : null
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

    // ONE question, three answers. It used to ask per capability per origin,
    // so a single task across two sites produced four prompts the student had
    // no way to tell apart.
    const scope = await deps.confirm({
      courseId: deps.courseId,
      tool: 'browser_access',
      summary: `${origin} 을 읽고 다룰까요?`,
      details: [
        '보기와 누르기, 파일 받기까지 할 수 있어요.',
        '글을 쓰거나 제출하는 건 그때마다 따로 물어봐요.'
      ],
      scopes: ['once', 'site', 'course']
    })
    if (scope === false) {
      audit('denied', url, '학생이 거부함')
      return { ok: false, message: '학생이 접근을 허용하지 않았어요.' }
    }

    // 'once' grants nothing: this call proceeds and the next one asks again.
    if (scope === 'once') {
      audit('grant', origin, '이번 한 번만')
      return { ok: true }
    }

    const target = scope === 'course' ? ANY_ORIGIN : origin
    const created = deps.grants.grant({
      courseId: deps.courseId,
      url: target,
      capability
    })
    if (created === null) {
      return { ok: false, message: verdict.message }
    }
    audit(
      'grant',
      origin,
      `${scope === 'course' ? '이 과목의 모든 사이트' : '이 사이트'} · ${GRANT_DAYS}일`
    )
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

    /**
     * The tabs the student has open, so "the page I am looking at" is
     * addressable at all.
     *
     * Listing needs no grant. These are titles and URLs of pages the student
     * put on their own screen, and refusing to name them would only make the
     * assistant claim it cannot see a browser that is right there. READING one
     * still goes through `gate` — enumeration is free, content is not.
     */
    browser_tabs(): {
      status: 'ok'
      tabs: {
        tabId: string
        title: string
        url: string
        active: boolean
        asleep: boolean
      }[]
      activeTabId: string | null
    } {
      const source = deps.openTabs
      if (source === undefined) {
        return { status: 'ok', tabs: [], activeTabId: null }
      }
      const { tabs, activeTabId } = source()
      audit('snapshot', '', `탭 ${tabs.length}개를 확인했어요`)
      return {
        status: 'ok',
        tabs: tabs.map((tab) => ({
          tabId: tab.tabId,
          // Portal URLs carry student numbers; titles carry names.
          title: redactText(tab.title),
          url: redactUrl(tab.url),
          active: tab.tabId === activeTabId,
          asleep: tab.asleep
        })),
        activeTabId
      }
    },

    async browser_open(
      url: string
    ): Promise<
      { status: 'ok'; tabId: string; url: string } | { status: 'error'; message: string }
    > {
      const page = deps.page
      if (page === undefined) {
        return { status: 'error', message: '이 대화에서는 페이지를 열 수 없어요.' }
      }
      page.assertLive()
      const permitted = await gate(url, 'read')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const opened = await page.openTab(url)
      audit('navigate', opened.url, '탭에서 열었어요')
      page.step('페이지를 여는 중', opened.url)
      return { status: 'ok', tabId: opened.tabId, url: opened.url }
    },

    async browser_snapshot(
      tabId: string,
      maxChars: number | null
    ): Promise<
      { status: 'ok'; url: string; outline: string } | { status: 'error'; message: string }
    > {
      const page = deps.page
      if (page === undefined) {
        return { status: 'error', message: '이 대화에서는 페이지를 볼 수 없어요.' }
      }
      page.assertLive()
      const url = await urlOfTab(page, tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      const permitted = await gate(url, 'read')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const result = await page.snapshot(tabId, maxChars ?? DEFAULT_SNAPSHOT_CHARS)
      if (result === null) {
        return { status: 'error', message: '페이지를 살펴보지 못했어요.' }
      }
      audit('snapshot', result.url, `${result.outline.length}자`)
      page.step('페이지를 살펴보는 중', result.url)
      return { status: 'ok', url: result.url, outline: result.outline }
    },

    async browser_read(
      tabId: string,
      maxChars: number | null
    ): Promise<
      { status: 'ok'; url: string; text: string } | { status: 'error'; message: string }
    > {
      const page = deps.page
      if (page === undefined) {
        return { status: 'error', message: '이 대화에서는 페이지를 읽을 수 없어요.' }
      }
      page.assertLive()
      const url = await urlOfTab(page, tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      const permitted = await gate(url, 'read')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const result = await page.read(tabId, maxChars ?? 8000)
      if (result === null) {
        return { status: 'error', message: '페이지를 읽지 못했어요.' }
      }
      audit('read', result.url, `본문 ${result.text.length}자`)
      return { status: 'ok', url: result.url, text: result.text }
    },

    /**
     * click / type / select. All three share the gate, the ref generation
     * check and the element policy, because the difference between them is
     * only what happens after all three have said yes.
     */
    async browser_act(
      tabId: string,
      ref: string,
      action:
        | { kind: 'click' }
        | { kind: 'type'; text: string }
        | { kind: 'select'; value: string }
    ): Promise<
      | {
          status: 'ok'
          url: string
          title: string
          navigated: boolean
          options?: { value: string; label: string }[]
        }
      | {
          status: 'error'
          message: string
          options?: { value: string; label: string }[]
        }
    > {
      const page = deps.page
      if (page === undefined) {
        return { status: 'error', message: '이 대화에서는 페이지를 조작할 수 없어요.' }
      }
      page.assertLive()
      const url = page.currentUrl(tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      // Interacting is its own decision — a read grant never implies it.
      const permitted = await gate(url, 'interact')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const resolved = resolveRef(ref, page.generation(tabId))
      if (!resolved.ok) {
        audit('denied', url, `ref ${resolved.reason}`)
        return { status: 'error', message: resolved.message }
      }

      const facts = await page.factsFor(
        tabId,
        resolved.frameIndex,
        resolved.elementIndex
      )
      if (facts === null) {
        return { status: 'error', message: '그 요소를 찾지 못했어요.' }
      }
      const verdict = verdictFor(action.kind, facts)
      if (!verdict.allowed) {
        audit('denied', url, `${action.kind}: ${verdict.reason}`)
        return { status: 'error', message: verdict.message }
      }

      const outcome = await page.act(
        tabId,
        resolved.frameIndex,
        resolved.elementIndex,
        action
      )
      if (!outcome.ok) {
        // The page's own answer, not a generic failure — "그 값을 고를 수
        // 없어요" plus the options it does offer is actionable; "동작을
        // 실행하지 못했어요" is not.
        return {
          status: 'error',
          message: outcome.problem ?? '동작을 실행하지 못했어요.',
          ...(outcome.options === undefined ? {} : { options: outcome.options })
        }
      }

      // Typed text is audited through the same redaction as everything else,
      // and a password field never reaches here at all (actionPolicy).
      const detail =
        action.kind === 'type'
          ? `type ${facts.tag}: ${action.text}`
          : action.kind === 'select'
            ? `select ${action.value}`
            : `click ${facts.tag} "${facts.href ?? ''}"`
      audit('navigate', outcome.url, detail)
      page.step('페이지를 조작하는 중', outcome.url)
      // The page AFTER settling, and whether the document changed. Without
      // this the model had no way to learn a click had navigated, so it
      // snapshotted the old document under a still-valid generation.
      return {
        status: 'ok',
        url: outcome.url,
        title: outcome.title,
        navigated: outcome.navigated,
        ...(outcome.options === undefined ? {} : { options: outcome.options })
      }
    },

    /**
     * Hands the wheel back. Not a failure — a first-class outcome. SSO, OTP,
     * nProtect and CAPTCHA are where an agent SHOULD stop, and pretending
     * otherwise is how it clicks something it should not.
     */
    async browser_handoff(
      tabId: string,
      message: string
    ): Promise<{ status: 'resumed' } | { status: 'error'; message: string }> {
      const page = deps.page
      if (page === undefined) {
        return { status: 'error', message: '이 대화에서는 넘길 수 없어요.' }
      }
      const outcome = await page.handoff(tabId, message)
      if (outcome === 'stopped') {
        return { status: 'error', message: '학생이 중지했어요.' }
      }
      return { status: 'resumed' }
    },

    /**
     * Presses submit — and asks, every single time.
     *
     * This gate is never rememberable. On the web, submit is the entire set of
     * irreversible acts: 과제 제출, 게시글, 수강신청, 메시지, 결제. Enumerating
     * dangerous PAGES is unreliable; enumerating the dangerous VERB is exact.
     * A grant covers reading and clicking around; it never covers this.
     */
    async browser_submit(
      tabId: string,
      ref: string
    ): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
      const page = deps.page
      const commit = deps.commit
      if (page === undefined || commit === undefined) {
        return { status: 'error', message: '이 대화에서는 제출할 수 없어요.' }
      }
      page.assertLive()
      const url = page.currentUrl(tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      const permitted = await gate(url, 'interact')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const resolved = resolveRef(ref, page.generation(tabId))
      if (!resolved.ok) {
        audit('denied', url, `submit ref ${resolved.reason}`)
        return { status: 'error', message: resolved.message }
      }
      const facts = await page.factsFor(
        tabId,
        resolved.frameIndex,
        resolved.elementIndex
      )
      if (facts === null) {
        return { status: 'error', message: '그 요소를 찾지 못했어요.' }
      }

      const approved = await deps.confirm({
        courseId: deps.courseId,
        tool: 'browser_submit',
        summary: `${normalizeOrigin(url) ?? url} 에서 제출할까요?`,
        details: [
          '되돌릴 수 없는 동작입니다.',
          '이 승인은 이번 한 번만 유효하고, 기억해 두지 않습니다.'
        ]
      })
      if (!approved) {
        audit('denied', url, 'submit: 학생이 거부함')
        return { status: 'error', message: '학생이 제출을 승인하지 않았어요.' }
      }

      const ok = await commit.submit(
        tabId,
        resolved.frameIndex,
        resolved.elementIndex
      )
      audit('navigate', url, ok ? 'submit 실행' : 'submit 실패')
      return ok
        ? { status: 'ok' }
        : { status: 'error', message: '제출하지 못했어요.' }
    },

    /**
     * Signs in with a login the student already saved.
     *
     * The agent names an origin and learns only whether it worked. There is no
     * parameter through which it could ask for the secret and no field in the
     * result that carries one — Aside ships an agent-scoped password manager;
     * this ships an agent that structurally cannot read a password.
     */
    async browser_use_saved_login(
      tabId: string
    ): Promise<
      { status: 'ok'; filled: boolean } | { status: 'error'; message: string }
    > {
      const page = deps.page
      const commit = deps.commit
      if (page === undefined || commit === undefined) {
        return { status: 'error', message: '이 대화에서는 로그인할 수 없어요.' }
      }
      page.assertLive()
      const url = page.currentUrl(tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      const permitted = await gate(url, 'interact')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const origin = normalizeOrigin(url) ?? url
      const approved = await deps.confirm({
        courseId: deps.courseId,
        tool: 'browser_use_saved_login',
        summary: `${origin} 에 저장된 로그인을 사용할까요?`,
        details: [
          '아이디와 비밀번호를 채우기만 하고, 제출은 하지 않습니다.',
          '이 승인은 이번 한 번만 유효하고, 기억해 두지 않습니다.'
        ]
      })
      if (!approved) {
        audit('denied', url, 'saved-login: 학생이 거부함')
        return { status: 'error', message: '학생이 로그인을 승인하지 않았어요.' }
      }

      const result = await commit.useSavedLogin(tabId)
      // Only the origin and whether it worked. Never the username's value in
      // a form that could be reconstructed, never the secret.
      audit('navigate', url, result.filled ? 'saved-login 채움' : 'saved-login 없음')
      return { status: 'ok', filled: result.filled }
    },

    /** Attaches a course file to a file input (`DOM.setFileInputFiles`). */
    async browser_attach_file(
      tabId: string,
      ref: string,
      courseId: string,
      relPath: string
    ): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
      const page = deps.page
      const commit = deps.commit
      if (page === undefined || commit === undefined) {
        return { status: 'error', message: '이 대화에서는 파일을 붙일 수 없어요.' }
      }
      page.assertLive()
      const url = page.currentUrl(tabId)
      if (url === null) {
        return { status: 'error', message: '그 탭을 찾지 못했어요.' }
      }
      const permitted = await gate(url, 'interact')
      if (!permitted.ok) return { status: 'error', message: permitted.message }

      const resolved = resolveRef(ref, page.generation(tabId))
      if (!resolved.ok) {
        return { status: 'error', message: resolved.message }
      }
      const ok = await commit.attachFile(
        tabId,
        resolved.frameIndex,
        resolved.elementIndex,
        courseId,
        relPath
      )
      audit('navigate', url, ok ? `파일 첨부 «${relPath}»` : '파일 첨부 실패')
      return ok
        ? { status: 'ok' }
        : { status: 'error', message: '파일을 붙이지 못했어요.' }
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
