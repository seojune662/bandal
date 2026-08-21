import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type {
  AgentAction,
  AgentActionTarget,
  AgentAppState,
  AgentConfirmRequest
} from '../../../shared/types/agentTools'
import { NotFoundError, ValidationError } from '../../db/errors'
import { assertRealInside, resolveInside } from '../../db/validate'
import type { BoardRepo } from '../board/boardRepo'
import type { CanvasRepo } from '../canvas/canvasRepo'
import type { CourseGroupsRepo } from '../courses/courseGroupsRepo'
import type { CourseLinksRepo } from '../courses/courseLinksRepo'
import type { CoursesRepo } from '../courses/coursesRepo'
import type { FavoritesRepo } from '../favorites'
import type { LinkService } from '../link/linkService'
import type { MaterialsRepo } from '../materials/materialsRepo'
import type { NotesRepo } from '../notes/notesRepo'
import type { SearchIndex } from '../search/searchIndex'
import type { DesktopToolsPort } from '../desktopAgent/desktopTools'
import { DESKTOP_TOOL_DEFINITIONS } from '../desktopAgent/schemas'
import {
  AGENT_TOOL_DEFINITIONS,
  BROWSER_TOOL_DEFINITIONS,
  BROWSER_TOOL_NAMES,
  type BrowserToolName,
  DESKTOP_TOOL_NAMES,
  type DesktopToolName,
  AGENT_TOOL_NAMES,
  type AgentToolName
} from './schemas'
import { boardTools } from './toolHandlers/board'
import { canvasTools } from './toolHandlers/canvas'
import {
  errorText,
  inputObject,
  optionalInteger,
  optionalString,
  RawToolResult,
  stringField,
  type ToolContext,
  type ToolHandlerMap,
  type TurnContext
} from './toolHandlers/context'
import { courseTools } from './toolHandlers/courses'
import { materialTools } from './toolHandlers/materials'
import { miscTools } from './toolHandlers/misc'
import { noteTools } from './toolHandlers/notes'

export type AgentJournalEntry = Omit<
  AgentAction,
  'id' | 'undoneAt' | 'createdAt'
>

/** The repository-only seam the IPC orchestrator wires into this feature. */
export interface AgentToolsDeps {
  /** Course whose chat owns the current agent session and confirmation UI. */
  courseId: string
  /** Must return the active app turn; a changed id resets per-turn limits. */
  getTurnId: () => string
  coursesRepo: Pick<
    CoursesRepo,
    | 'list'
    | 'create'
    | 'rename'
    | 'softDelete'
    | 'getById'
    | 'getFolder'
    | 'organize'
    | 'archive'
  >
  /**
   * 학기 그룹 — the named sidebar sections the student sees.
   *
   * This was fully built (repo, IPC, drag-and-drop UI) and completely
   * unreachable by the agent: the word "group" appeared zero times in this
   * whole layer, while `list_courses` handed out a `groupId` UUID with no way
   * to resolve it. A student asking to "change the semester" got the browser.
   */
  courseGroupsRepo: Pick<
    CourseGroupsRepo,
    'list' | 'create' | 'rename' | 'delete'
  >
  /**
   * What the student is looking at right now, published by the renderer.
   *
   * The agent could see the web (browser_tabs) and nothing of the app it
   * lives in, so any instruction about the app was resolved against the only
   * surface it could see.
   */
  appState?: () => AgentAppState
  materialsRepo: Pick<
    MaterialsRepo,
    | 'tree'
    | 'writeFile'
    | 'createFolder'
    | 'rename'
    | 'softDelete'
    | 'move'
    | 'duplicate'
  >
  /**
   * The course's saved classroom links.
   *
   * The agent had `lms_course_page`, `lms_list` and `lms_new_items` and no
   * way to CREATE the link they all depend on — so "새 공지 있어?" answered
   * "이 과목엔 강의실이 연결돼 있지 않아요" and the agent could do nothing
   * about it.
   */
  courseLinksRepo: Pick<CourseLinksRepo, 'list' | 'create' | 'update' | 'delete'>
  favoritesRepo: Pick<FavoritesRepo, 'list' | 'add' | 'rename' | 'softDelete'>
  searchIndex: Pick<SearchIndex, 'query'>
  linkService: Pick<LinkService, 'sendHighlightToNote' | 'sendWebClipToNote'>
  notesRepo: Pick<NotesRepo, 'read' | 'write' | 'create'>
  boardRepo: Pick<BoardRepo, 'list' | 'create' | 'update' | 'softDelete'>
  canvasRepo: Pick<
    CanvasRepo,
    | 'listBoards'
    | 'createBoard'
    | 'renameBoard'
    | 'setBackground'
    | 'setPageCount'
    | 'removeBoard'
    | 'open'
    | 'putShape'
    | 'removeShapes'
  >
  /**
   * `conversationId` is supplied by the injection site, which is the only
   * place that knows it — a tool has no idea which chat it is serving.
   */
  confirm: (
    request: Omit<AgentConfirmRequest, 'requestId' | 'conversationId'>
  ) => Promise<boolean>
  journal: {
    record: (entry: AgentJournalEntry) => void
  }
  /**
   * Browser and LMS tools. Optional so tests can build a tool set without
   * them; the app always supplies them (see registerHandlers `browserToolsFor`).
   */
  browser?: {
    browser_tabs: () => unknown
    lms_course_page: (courseId: string) => unknown
    lms_list: (courseId: string, kind: string | null) => Promise<unknown>
    lms_new_items: (courseId: string, kind: string | null) => Promise<unknown>
    browser_download: (
      courseId: string,
      url: string,
      dirRelPath: string
    ) => Promise<unknown>
    browser_open: (url: string) => Promise<unknown>
    browser_snapshot: (tabId: string, maxChars: number | null) => Promise<unknown>
    browser_read: (tabId: string, maxChars: number | null) => Promise<unknown>
    browser_act: (
      tabId: string,
      ref: string,
      action:
        | { kind: 'click' }
        | { kind: 'type'; text: string }
        | { kind: 'select'; value: string }
    ) => Promise<unknown>
    browser_handoff: (tabId: string, message: string) => Promise<unknown>
    browser_submit: (tabId: string, ref: string) => Promise<unknown>
    browser_use_saved_login: (tabId: string) => Promise<unknown>
    browser_attach_file: (
      tabId: string,
      ref: string,
      courseId: string,
      relPath: string
    ) => Promise<unknown>
  }
  /** Desktop capture/read tools, supplied only for desktop conversations. */
  desktop?: DesktopToolsPort
}

export interface AgentTools {
  readonly definitions: readonly Tool[]
  /** Includes optional browser and desktop tools when this session has them. */
  readonly names: readonly (
    | AgentToolName
    | BrowserToolName
    | DesktopToolName
  )[]
  call: (name: string, args?: unknown) => Promise<CallToolResult>
}

export const AGENT_TURN_LIMITS = {
  courses: 20,
  files: 50,
  shapes: 500,
  tasks: 50
} as const

export type LimitKind = keyof typeof AGENT_TURN_LIMITS

function success(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }
}

function failure(tool: string, error: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `도구 "${tool}" 실행 실패: ${errorText(error)}\n입력을 고친 뒤 다시 호출하세요.`
      }
    ],
    isError: true
  }
}

export function createAgentTools(deps: AgentToolsDeps): AgentTools {
  let activeTurnId: string | null = null
  let used: Record<LimitKind, number> = {
    courses: 0,
    files: 0,
    shapes: 0,
    tasks: 0
  }

  function currentTurn(): TurnContext {
    const turnId = deps.getTurnId()
    if (typeof turnId !== 'string' || turnId.trim() === '') {
      throw new ValidationError('there is no active agent turn')
    }
    if (activeTurnId !== turnId) {
      activeTurnId = turnId
      used = { courses: 0, files: 0, shapes: 0, tasks: 0 }
    }
    return { courseId: deps.courseId, turnId }
  }

  function reserve(kind: LimitKind, amount: number): void {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new ValidationError(`${kind} creation count must be an integer >= 1`)
    }
    const limit = AGENT_TURN_LIMITS[kind]
    if (used[kind] + amount > limit) {
      throw new ValidationError(
        `한 턴의 ${kind} 생성 상한은 ${limit}개입니다 ` +
        `(이미 ${used[kind]}개, 이번 요청 ${amount}개). 요청을 줄여 주세요.`
      )
    }
    used[kind] += amount
  }

  function release(kind: LimitKind, amount: number): void {
    used[kind] = Math.max(0, used[kind] - amount)
  }

  function record(
    context: TurnContext,
    courseId: string,
    tool: AgentToolName,
    targetKind: AgentActionTarget,
    targetId: string,
    label: string,
    undoable: boolean
  ): void {
    deps.journal.record({
      courseId,
      turnId: context.turnId,
      tool,
      targetKind,
      targetId,
      label,
      undoable
    })
  }

  function courseFolder(courseId: string): string {
    return deps.coursesRepo.getFolder(courseId)
  }

  function assertCoursePath(
    courseId: string,
    relPath: string,
    allowRoot = false
  ): string {
    const root = courseFolder(courseId)
    const abs = resolveInside(
      root,
      relPath,
      allowRoot ? { allowRoot: true } : {}
    )
    return assertRealInside(root, abs)
  }

  function assertChildPath(
    courseId: string,
    dirRelPath: string,
    name: string
  ): void {
    const root = courseFolder(courseId)
    const parent = assertRealInside(
      root,
      resolveInside(root, dirRelPath, { allowRoot: true })
    )
    assertRealInside(root, resolveInside(parent, name))
  }

  async function approve(
    context: TurnContext,
    tool: AgentToolName,
    summary: string,
    details: string[]
  ): Promise<boolean> {
    return deps.confirm({
      courseId: context.courseId,
      tool,
      summary,
      details
    })
  }

  function findTask(id: string) {
    const task = deps.boardRepo
      .list({ includeDone: true })
      .find((candidate) => candidate.id === id)
    if (task === undefined) throw new NotFoundError('task', id)
    return task
  }

  const context: ToolContext = {
    deps,
    currentTurn,
    reserve,
    release,
    approve,
    record,
    courseFolder,
    assertCoursePath,
    assertChildPath,
    findTask
  }

  const handlers: ToolHandlerMap = {
    ...courseTools(context),
    ...materialTools(context),
    ...noteTools(context),
    ...boardTools(context),
    ...canvasTools(context),
    ...miscTools(context)
  }

  const browser = deps.browser
  if (browser !== undefined) {
    const browserHandlers: Record<
      string,
      (input: Record<string, unknown>) => Promise<unknown> | unknown
    > = {
      browser_tabs: () => browser.browser_tabs(),
      lms_course_page: (input) =>
        browser.lms_course_page(stringField(input, 'courseId', { nonEmpty: true })),
      lms_list: (input) =>
        browser.lms_list(
          stringField(input, 'courseId', { nonEmpty: true }),
          optionalString(input, 'kind') ?? null
        ),
      lms_new_items: (input) =>
        browser.lms_new_items(
          stringField(input, 'courseId', { nonEmpty: true }),
          optionalString(input, 'kind') ?? null
        ),
      browser_download: async (input) => {
        const context = currentTurn()
        const courseId = stringField(input, 'courseId', { nonEmpty: true })
        const url = stringField(input, 'url', { nonEmpty: true })
        const dirRelPath = stringField(input, 'dirRelPath')
        // Path safety and the per-turn file budget are the SAME ones
        // `write_file` obeys — a download is a file creation, so a poisoned
        // page cannot use it to slip past a cap the other tools respect.
        assertCoursePath(courseId, dirRelPath, true)
        reserve('files', 1)

        const result = (await browser.browser_download(
          courseId,
          url,
          dirRelPath
        )) as { status: string; relPath?: string }
        if (result.status === 'ok' && typeof result.relPath === 'string') {
          record(
            context,
            courseId,
            'browser_download' as AgentToolName,
            'material',
            result.relPath,
            `자료 «${result.relPath}»`,
            true
          )
        }
        return result
      },
      browser_open: (input) =>
        browser.browser_open(stringField(input, 'url', { nonEmpty: true })),
      browser_snapshot: (input) =>
        browser.browser_snapshot(
          stringField(input, 'tabId', { nonEmpty: true }),
          optionalInteger(input, 'maxChars', 500) ?? null
        ),
      browser_read: (input) =>
        browser.browser_read(
          stringField(input, 'tabId', { nonEmpty: true }),
          optionalInteger(input, 'maxChars', 500) ?? null
        ),
      browser_click: (input) =>
        browser.browser_act(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'ref', { nonEmpty: true }),
          { kind: 'click' }
        ),
      browser_type: (input) =>
        browser.browser_act(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'ref', { nonEmpty: true }),
          { kind: 'type', text: stringField(input, 'text') }
        ),
      browser_select: (input) =>
        browser.browser_act(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'ref', { nonEmpty: true }),
          { kind: 'select', value: stringField(input, 'value') }
        ),
      browser_handoff: (input) =>
        browser.browser_handoff(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'message')
        ),
      browser_submit: (input) =>
        browser.browser_submit(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'ref', { nonEmpty: true })
        ),
      browser_use_saved_login: (input) =>
        browser.browser_use_saved_login(
          stringField(input, 'tabId', { nonEmpty: true })
        ),
      browser_attach_file: (input) => {
        const courseId = stringField(input, 'courseId', { nonEmpty: true })
        const relPath = stringField(input, 'relPath', { nonEmpty: true })
        // The same path guard every other file tool obeys.
        assertCoursePath(courseId, relPath)
        return browser.browser_attach_file(
          stringField(input, 'tabId', { nonEmpty: true }),
          stringField(input, 'ref', { nonEmpty: true }),
          courseId,
          relPath
        )
      }
    }
    Object.assign(handlers, browserHandlers)
  }

  const desktop = deps.desktop
  if (desktop !== undefined) {
    const desktopHandlers: Record<
      DesktopToolName,
      (input: Record<string, unknown>) => Promise<unknown> | unknown
    > = {
      desktop_screenshot: (input) => desktop.desktop_screenshot(input),
      desktop_windows: (input) => desktop.desktop_windows(input),
      desktop_frontmost: (input) => desktop.desktop_frontmost(input),
      desktop_clipboard_read: (input) =>
        desktop.desktop_clipboard_read(input)
    }
    Object.assign(handlers, desktopHandlers)
  }

  return {
    definitions: [
      ...AGENT_TOOL_DEFINITIONS,
      ...(browser === undefined ? [] : BROWSER_TOOL_DEFINITIONS),
      ...(desktop === undefined ? [] : DESKTOP_TOOL_DEFINITIONS)
    ],
    names: [
      ...AGENT_TOOL_NAMES,
      ...(browser === undefined ? [] : BROWSER_TOOL_NAMES),
      ...(desktop === undefined ? [] : DESKTOP_TOOL_NAMES)
    ],
    async call(name, args = {}) {
      const handler = handlers[name as AgentToolName]
      if (handler === undefined) {
        return failure(name, new ValidationError(`unknown tool "${name}"`))
      }
      try {
        const result = await handler(inputObject(args))
        return result instanceof RawToolResult ? result.result : success(result)
      } catch (error) {
        return failure(name, error)
      }
    }
  }
}
