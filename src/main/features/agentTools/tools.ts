import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type {
  AgentAction,
  AgentActionTarget,
  AgentConfirmRequest
} from '../../../shared/types/agentTools'
import type { TaskKind, TaskStatus, UpdateTaskInput } from '../../../shared/types/board'
import type { BoardBackground, BoardSurface } from '../../../shared/types/whiteboard'
import { NotFoundError, ValidationError } from '../../db/errors'
import { resolveInside } from '../../db/validate'
import type { BoardRepo } from '../board/boardRepo'
import type { CanvasRepo } from '../canvas/canvasRepo'
import type { CoursesRepo } from '../courses/coursesRepo'
import type { MaterialsRepo } from '../materials/materialsRepo'
import {
  DEFAULT_EXTRACT_MAX_CHARS,
  extractMaterialText
} from '../materials/textExtract'
import type { NotesRepo } from '../notes/notesRepo'
import { backupMaterial, materialEditTargetId } from './documentBackup'
import {
  applySheetEdits,
  parseDocxReplacements,
  parseSheetEditRequest,
  prepareDocxTextEdit,
  type DocxReplaceScope
} from './documentEdit'
import {
  AGENT_TOOL_DEFINITIONS,
  BROWSER_TOOL_DEFINITIONS,
  BROWSER_TOOL_NAMES,
  type BrowserToolName,
  AGENT_TOOL_NAMES,
  type AgentToolName
} from './schemas'
import { assertAgentBoardShape } from './shapeValidation'

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
    'list' | 'create' | 'rename' | 'softDelete' | 'getById' | 'getFolder'
  >
  materialsRepo: Pick<
    MaterialsRepo,
    'tree' | 'writeFile' | 'createFolder' | 'rename' | 'softDelete'
  >
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
  >
  confirm: (
    request: Omit<AgentConfirmRequest, 'requestId'>
  ) => Promise<boolean>
  journal: {
    record: (entry: AgentJournalEntry) => void
  }
  /**
   * Read-only LMS tools. Present only for conversations doing browser work —
   * their schemas are ~1k tokens on every turn otherwise, including one that
   * just asks about a PDF. `--allowedTools` is derived from `names` at spawn,
   * so this is naturally per session.
   */
  browser?: {
    lms_course_page: (courseId: string) => unknown
    lms_new_items: (courseId: string, kind: string | null) => Promise<unknown>
  }
}

export interface AgentTools {
  readonly definitions: readonly Tool[]
  /** Includes the browser tools when this session has them. */
  readonly names: readonly (AgentToolName | BrowserToolName)[]
  call: (name: string, args?: unknown) => Promise<CallToolResult>
}

export const AGENT_TURN_LIMITS = {
  courses: 20,
  files: 50,
  shapes: 500,
  tasks: 50
} as const

type LimitKind = keyof typeof AGENT_TURN_LIMITS

interface TurnContext {
  courseId: string
  turnId: string
}

interface ShapeRequest {
  id: string
  shape: ReturnType<typeof assertAgentBoardShape>
}

function inputObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('tool arguments must be an object')
  }
  return value as Record<string, unknown>
}

function has(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  options: { nonEmpty?: boolean } = {}
): string {
  const value = input[key]
  if (typeof value !== 'string') {
    throw new ValidationError(`${key} must be a string`)
  }
  if (options.nonEmpty === true && value.trim() === '') {
    throw new ValidationError(`${key} must be a non-empty string`)
  }
  return value
}

function optionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  return has(input, key) ? stringField(input, key) : undefined
}

function optionalBoolean(
  input: Record<string, unknown>,
  key: string
): boolean | undefined {
  if (!has(input, key)) return undefined
  const value = input[key]
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${key} must be a boolean`)
  }
  return value
}

function optionalInteger(
  input: Record<string, unknown>,
  key: string,
  minimum: number
): number | undefined {
  if (!has(input, key)) return undefined
  const value = input[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new ValidationError(`${key} must be an integer >= ${minimum}`)
  }
  return value
}

function nullableStringField(
  input: Record<string, unknown>,
  key: string
): string | null {
  if (input[key] === null) return null
  return stringField(input, key, { nonEmpty: true })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

function cancelled(tool: string): object {
  return {
    ok: false,
    cancelled: true,
    message: `사용자가 ${tool} 작업을 승인하지 않아 아무것도 변경하지 않았습니다.`
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
    return resolveInside(
      courseFolder(courseId),
      relPath,
      allowRoot ? { allowRoot: true } : {}
    )
  }

  function assertChildPath(
    courseId: string,
    dirRelPath: string,
    name: string
  ): void {
    const parent = assertCoursePath(courseId, dirRelPath, true)
    resolveInside(parent, name)
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

  const handlers: Record<
    AgentToolName,
    (input: Record<string, unknown>) => Promise<unknown> | unknown
  > = {
    list_courses(input) {
      const includeArchived = optionalBoolean(input, 'includeArchived') ?? false
      return deps.coursesRepo.list({ includeArchived })
    },

    list_materials(input) {
      return deps.materialsRepo.tree(
        stringField(input, 'courseId', { nonEmpty: true })
      )
    },

    list_boards(input) {
      return deps.canvasRepo.listBoards(
        stringField(input, 'courseId', { nonEmpty: true })
      )
    },

    async read_material(input) {
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      // 상한을 걸어 한 호출이 세션 문맥을 통째로 삼키지 못하게 한다.
      const maxChars = Math.min(
        optionalInteger(input, 'maxChars', 1) ?? DEFAULT_EXTRACT_MAX_CHARS,
        200_000
      )
      const absPath = assertCoursePath(courseId, relPath)
      const ext = posix.extname(relPath)
      const text = await extractMaterialText(absPath, ext, maxChars)
      if (text === null) {
        return {
          relPath,
          supported: false,
          message:
            ext.toLowerCase() === '.pdf'
              ? 'PDF 는 read_material 대신 파일을 직접 읽으세요.'
              : `지원하지 않는 형식(${ext === '' ? '확장자 없음' : ext})입니다. 텍스트, 마크다운, .docx, .xlsx/.xls 만 읽을 수 있습니다.`
        }
      }
      return { relPath, supported: true, text }
    },

    list_tasks(input) {
      const includeDone = optionalBoolean(input, 'includeDone')
      const courseId = has(input, 'courseId')
        ? nullableStringField(input, 'courseId')
        : undefined
      return deps.boardRepo.list({
        ...(courseId !== undefined ? { courseId } : {}),
        ...(includeDone !== undefined ? { includeDone } : {})
      })
    },

    create_course(input) {
      const context = currentTurn()
      const name = stringField(input, 'name', { nonEmpty: true }).trim()
      const color = optionalString(input, 'color') ?? 'blue'
      const nameKey = name.normalize('NFC')
      const existing = deps.coursesRepo
        .list({ includeArchived: true })
        .find((course) => course.name.trim().normalize('NFC') === nameKey)
      if (existing !== undefined) {
        return { created: false, duplicate: true, course: existing }
      }

      reserve('courses', 1)
      let course
      try {
        course = deps.coursesRepo.create({ name, color })
      } catch (error) {
        release('courses', 1)
        throw error
      }
      record(context, course.id, 'create_course', 'course', course.id, `과목 «${course.name}»`, true)
      return { created: true, duplicate: false, course }
    },

    create_note(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const dirRelPath = stringField(input, 'dirRelPath')
      const title = stringField(input, 'title', { nonEmpty: true })
      const markdown = optionalString(input, 'markdown')
      assertCoursePath(courseId, dirRelPath, true)
      assertChildPath(courseId, dirRelPath, `${title}.md`)

      reserve('files', 1)
      let note
      try {
        note = deps.notesRepo.create({ courseId, dirRelPath, title })
        if (markdown !== undefined) {
          deps.notesRepo.write({ ...note, markdown })
        }
      } catch (error) {
        release('files', 1)
        throw error
      }
      record(context, courseId, 'create_note', 'note', note.relPath, `필기 «${note.relPath}»`, true)
      return note
    },

    write_file(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const dirRelPath = stringField(input, 'dirRelPath')
      const fileName = stringField(input, 'fileName', { nonEmpty: true })
      const encoding = optionalString(input, 'encoding') ?? 'utf8'
      if (encoding !== 'utf8' && encoding !== 'base64') {
        throw new ValidationError('encoding must be "utf8" or "base64"')
      }
      const data = stringField(input, 'data')
      assertChildPath(courseId, dirRelPath, fileName)

      reserve('files', 1)
      let result
      try {
        result = deps.materialsRepo.writeFile({
          courseId,
          dirRelPath,
          fileName,
          encoding,
          data
        })
      } catch (error) {
        release('files', 1)
        throw error
      }
      record(context, courseId, 'write_file', 'material', result.relPath, `자료 «${result.relPath}»`, true)
      return result
    },

    create_folder(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const dirRelPath = stringField(input, 'dirRelPath')
      const name = stringField(input, 'name', { nonEmpty: true })
      assertChildPath(courseId, dirRelPath, name)

      reserve('files', 1)
      let result
      try {
        result = deps.materialsRepo.createFolder({ courseId, dirRelPath, name })
      } catch (error) {
        release('files', 1)
        throw error
      }
      record(context, courseId, 'create_folder', 'material', result.relPath, `폴더 «${result.relPath}»`, true)
      return result
    },

    create_task(input) {
      const context = currentTurn()
      const courseId = nullableStringField(input, 'courseId')
      const title = stringField(input, 'title', { nonEmpty: true })
      const notes = optionalString(input, 'notes')
      const status = optionalString(input, 'status') as TaskStatus | undefined
      const kind = optionalString(input, 'kind') as TaskKind | undefined
      const dueAt = has(input, 'dueAt')
        ? input['dueAt'] === null
          ? null
          : stringField(input, 'dueAt')
        : undefined
      const allDay = optionalBoolean(input, 'allDay')

      reserve('tasks', 1)
      let task
      try {
        task = deps.boardRepo.create({
          courseId,
          title,
          ...(notes !== undefined ? { notes } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(kind !== undefined ? { kind } : {}),
          ...(dueAt !== undefined ? { dueAt } : {}),
          ...(allDay !== undefined ? { allDay } : {})
        })
      } catch (error) {
        release('tasks', 1)
        throw error
      }
      record(context, task.courseId ?? context.courseId, 'create_task', 'task', task.id, `할 일 «${task.title}»`, true)
      return task
    },

    update_task(input) {
      const context = currentTurn()
      const id = stringField(input, 'id', { nonEmpty: true })
      const update: UpdateTaskInput = { id }
      if (has(input, 'courseId')) update.courseId = nullableStringField(input, 'courseId')
      if (has(input, 'title')) update.title = stringField(input, 'title')
      if (has(input, 'notes')) update.notes = stringField(input, 'notes')
      if (has(input, 'status')) update.status = stringField(input, 'status') as TaskStatus
      if (has(input, 'kind')) update.kind = stringField(input, 'kind') as TaskKind
      if (has(input, 'dueAt')) {
        update.dueAt = input['dueAt'] === null ? null : stringField(input, 'dueAt')
      }
      if (has(input, 'allDay')) {
        update.allDay = optionalBoolean(input, 'allDay') as boolean
      }
      if (has(input, 'sortOrder')) {
        update.sortOrder = optionalInteger(input, 'sortOrder', 0) as number
      }
      const task = deps.boardRepo.update(update)
      record(context, task.courseId ?? context.courseId, 'update_task', 'task', task.id, `할 일 «${task.title}»`, false)
      return task
    },

    create_board(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const title = optionalString(input, 'title')
      const background = optionalString(input, 'background') as BoardBackground | undefined
      const surface = optionalString(input, 'surface') as BoardSurface | undefined
      if (background !== undefined && !['grid', 'dots', 'lines', 'blank'].includes(background)) {
        throw new ValidationError('background must be one of grid, dots, lines, blank')
      }
      if (surface !== undefined && !['dark', 'light'].includes(surface)) {
        throw new ValidationError('surface must be one of dark, light')
      }
      let board = deps.canvasRepo.createBoard({
        courseId,
        ...(title !== undefined ? { title } : {})
      })
      if (background !== undefined || surface !== undefined) {
        board = deps.canvasRepo.setBackground({
          boardId: board.id,
          ...(background !== undefined ? { background } : {}),
          ...(surface !== undefined ? { surface } : {})
        })
      }
      record(context, board.courseId, 'create_board', 'board', board.id, `화이트보드 «${board.title}»`, true)
      return board
    },

    add_page(input) {
      const context = currentTurn()
      const boardId = stringField(input, 'boardId', { nonEmpty: true })
      const before = deps.canvasRepo.open(boardId).board
      const board = deps.canvasRepo.setPageCount({
        boardId,
        pageCount: before.pageCount + 1
      })
      record(
        context,
        board.courseId,
        'add_page',
        'board',
        board.id,
        `화이트보드 «${board.title}» ${board.pageCount}쪽`,
        false
      )
      return board
    },

    add_shapes(input) {
      const context = currentTurn()
      const boardId = stringField(input, 'boardId', { nonEmpty: true })
      const page = optionalInteger(input, 'page', 1) ?? 1
      const rawShapes = input['shapes']
      if (!Array.isArray(rawShapes) || rawShapes.length === 0) {
        throw new ValidationError('shapes must be a non-empty array')
      }
      const board = deps.canvasRepo.open(boardId).board
      if (page > board.pageCount) {
        throw new ValidationError(`page must be <= board pageCount (${board.pageCount})`)
      }

      const validated: ShapeRequest[] = []
      const ids = new Set<string>()
      const errors: string[] = []
      const folder = courseFolder(board.courseId)
      for (const [index, raw] of rawShapes.entries()) {
        try {
          const shape = assertAgentBoardShape(raw)
          const rawObject = inputObject(raw)
          const id = has(rawObject, 'id')
            ? stringField(rawObject, 'id', { nonEmpty: true })
            : randomUUID()
          if (ids.has(id)) {
            throw new ValidationError(`duplicate shape id "${id}"`)
          }
          ids.add(id)
          const referencedPath = shape.data.clip?.relPath ?? shape.data.image?.relPath
          if (referencedPath !== undefined) resolveInside(folder, referencedPath)
          validated.push({ id, shape })
        } catch (error) {
          errors.push(`shapes[${index}]: ${errorText(error)}`)
        }
      }
      if (errors.length > 0) {
        throw new ValidationError(
          `도형 ${errors.length}개가 잘못되어 아무 도형도 저장하지 않았습니다:\n- ${errors.join('\n- ')}`
        )
      }

      reserve('shapes', validated.length)
      const created = []
      try {
        for (const candidate of validated) {
          created.push(deps.canvasRepo.putShape({
            boardId,
            id: candidate.id,
            page,
            shape: candidate.shape
          }))
        }
      } catch (error) {
        // A repository failure can happen only after validation. Keep the
        // reservation because preceding puts may already have succeeded.
        throw error
      }
      for (const shape of created) {
        record(
          context,
          board.courseId,
          'add_shapes',
          'shape',
          shape.id,
          `화이트보드 도형 «${shape.kind}»`,
          true
        )
      }
      return { boardId, page, count: created.length, shapes: created }
    },

    async rename_material(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      const newName = stringField(input, 'newName', { nonEmpty: true })
      assertCoursePath(courseId, relPath)
      const parentRelPath = posix.dirname(relPath)
      assertChildPath(courseId, parentRelPath === '.' ? '' : parentRelPath, newName)
      if (!await approve(
        context,
        'rename_material',
        `자료 «${relPath}»의 이름을 «${newName}»(으)로 바꿉니다.`,
        [relPath, newName]
      )) return cancelled('rename_material')
      const result = deps.materialsRepo.rename({ courseId, relPath, newName })
      record(context, courseId, 'rename_material', 'material', result.relPath, `자료 «${result.relPath}»`, false)
      return result
    },

    async rename_course(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const name = stringField(input, 'name', { nonEmpty: true })
      const before = deps.coursesRepo.getById(courseId)
      if (!await approve(
        context,
        'rename_course',
        `과목 «${before.name}»의 이름을 «${name.trim()}»(으)로 바꿉니다.`,
        [before.name, name.trim()]
      )) return cancelled('rename_course')
      const course = deps.coursesRepo.rename({ courseId, name })
      record(context, course.id, 'rename_course', 'course', course.id, `과목 «${course.name}»`, false)
      return course
    },

    async rename_board(input) {
      const context = currentTurn()
      const id = stringField(input, 'id', { nonEmpty: true })
      const title = stringField(input, 'title', { nonEmpty: true })
      const before = deps.canvasRepo.open(id).board
      if (!await approve(
        context,
        'rename_board',
        `화이트보드 «${before.title}»의 이름을 «${title.trim()}»(으)로 바꿉니다.`,
        [before.title, title.trim()]
      )) return cancelled('rename_board')
      const board = deps.canvasRepo.renameBoard({ id, title })
      record(context, board.courseId, 'rename_board', 'board', board.id, `화이트보드 «${board.title}»`, false)
      return board
    },

    async delete_material(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      assertCoursePath(courseId, relPath)
      if (!await approve(
        context,
        'delete_material',
        `자료 «${relPath}»을(를) 휴지통으로 보냅니다.`,
        [relPath]
      )) return cancelled('delete_material')
      const result = await deps.materialsRepo.softDelete({ courseId, relPath })
      record(context, courseId, 'delete_material', 'material', relPath, `자료 «${relPath}»`, false)
      return result
    },

    async delete_task(input) {
      const context = currentTurn()
      const id = stringField(input, 'id', { nonEmpty: true })
      const task = findTask(id)
      if (!await approve(
        context,
        'delete_task',
        `할 일 «${task.title}»을(를) 삭제합니다.`,
        [task.title]
      )) return cancelled('delete_task')
      const result = deps.boardRepo.softDelete({ id })
      record(context, task.courseId ?? context.courseId, 'delete_task', 'task', id, `할 일 «${task.title}»`, false)
      return result
    },

    async delete_board(input) {
      const context = currentTurn()
      const id = stringField(input, 'id', { nonEmpty: true })
      const board = deps.canvasRepo.open(id).board
      if (!await approve(
        context,
        'delete_board',
        `화이트보드 «${board.title}»와 그 안의 도형을 삭제합니다.`,
        [board.title, `페이지 ${board.pageCount}개`]
      )) return cancelled('delete_board')
      deps.canvasRepo.removeBoard(id)
      record(context, board.courseId, 'delete_board', 'board', id, `화이트보드 «${board.title}»`, false)
      return { ok: true }
    },

    async delete_course(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const course = deps.coursesRepo.getById(courseId)
      if (!await approve(
        context,
        'delete_course',
        `과목 «${course.name}»을(를) 앱에서 삭제합니다. 디스크의 폴더는 남습니다.`,
        [course.name, course.folderPath]
      )) return cancelled('delete_course')
      const result = deps.coursesRepo.softDelete({ courseId })
      record(context, courseId, 'delete_course', 'course', courseId, `과목 «${course.name}»`, false)
      return result
    },

    async overwrite_note(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      const markdown = stringField(input, 'markdown')
      const requestedMtime = optionalInteger(input, 'expectedMtime', 0)
      assertCoursePath(courseId, relPath)
      const before = deps.notesRepo.read({ courseId, relPath })
      if (!await approve(
        context,
        'overwrite_note',
        `필기 «${relPath}»의 전체 내용을 덮어씁니다.`,
        [relPath, `${Buffer.byteLength(markdown, 'utf8')} bytes`]
      )) return cancelled('overwrite_note')
      const result = deps.notesRepo.write({
        courseId,
        relPath,
        markdown,
        expectedMtime: requestedMtime ?? before.mtime
      })
      record(context, courseId, 'overwrite_note', 'note', relPath, `필기 «${relPath}»`, false)
      return { courseId, relPath, ...result }
    },

    async edit_sheet(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      const sheetName = optionalString(input, 'sheet')
      const request = parseSheetEditRequest(input)
      const ext = posix.extname(relPath).toLowerCase()
      if (ext === '.xls') {
        throw new ValidationError(
          '.xls 는 편집할 수 없습니다 — 이 도구는 .xlsx 형식만 저장할 수 있습니다. 먼저 .xlsx 로 변환해 주세요.'
        )
      }
      if (ext !== '.xlsx') {
        throw new ValidationError('edit_sheet 는 .xlsx 파일만 편집합니다')
      }
      const absPath = assertCoursePath(courseId, relPath)

      const parts: string[] = []
      if (request.edits.length > 0) parts.push(`셀 ${request.edits.length}개 수정`)
      if (request.appendRows.length > 0) parts.push(`행 ${request.appendRows.length}개 추가`)
      if (!await approve(
        context,
        'edit_sheet',
        `스프레드시트 «${relPath}»에서 ${parts.join(', ')}을(를) 합니다.`,
        [relPath, sheetName === undefined ? '첫 번째 시트' : `시트 «${sheetName}»`, ...parts]
      )) return cancelled('edit_sheet')

      // 확인 뒤·쓰기 전 백업. 이후 실패해도 원본은 백업에 남는다.
      const backup = backupMaterial(courseFolder(courseId), absPath)
      const result = await applySheetEdits({ absPath, sheetName, request })
      record(
        context,
        courseId,
        'edit_sheet',
        'material-edit',
        materialEditTargetId(relPath, backup.backupAbs),
        `자료 «${relPath}» 편집`,
        true
      )
      return { relPath, ...result, backup: backup.backupName }
    },

    async edit_docx_text(input) {
      const context = currentTurn()
      const courseId = stringField(input, 'courseId', { nonEmpty: true })
      const relPath = stringField(input, 'relPath', { nonEmpty: true })
      const scope = (optionalString(input, 'scope') ?? 'all') as DocxReplaceScope
      if (scope !== 'first' && scope !== 'all') {
        throw new ValidationError('scope must be "first" or "all"')
      }
      const replacements = parseDocxReplacements(input)
      if (posix.extname(relPath).toLowerCase() !== '.docx') {
        throw new ValidationError('edit_docx_text 는 .docx 파일만 편집합니다')
      }
      const absPath = assertCoursePath(courseId, relPath)

      // 먼저 결과를 계산만 한다 — 일치가 0이면 확인·백업·쓰기 모두 생략.
      const prepared = await prepareDocxTextEdit({ absPath, replacements, scope })
      if (prepared.total === 0) {
        return {
          relPath,
          replaced: prepared.replaced,
          totalReplacements: 0,
          message:
            '일치하는 텍스트가 없어 아무것도 바꾸지 않았습니다. 문구가 run 중간에서 서식이 바뀌면 매칭되지 않으니, read_material 로 정확한 문구를 확인해 보세요.'
        }
      }
      if (!await approve(
        context,
        'edit_docx_text',
        `문서 «${relPath}»에서 텍스트 ${prepared.total}곳을 바꿉니다.`,
        [
          relPath,
          ...prepared.replaced
            .filter((item) => item.count > 0)
            .map((item) => `«${item.find}» ${item.count}곳`)
        ]
      )) return cancelled('edit_docx_text')

      const backup = backupMaterial(courseFolder(courseId), absPath)
      await prepared.write()
      record(
        context,
        courseId,
        'edit_docx_text',
        'material-edit',
        materialEditTargetId(relPath, backup.backupAbs),
        `자료 «${relPath}» 편집`,
        true
      )
      return {
        relPath,
        replaced: prepared.replaced,
        totalReplacements: prepared.total,
        backup: backup.backupName
      }
    }
  }

  const browser = deps.browser
  if (browser !== undefined) {
    const browserHandlers: Record<
      string,
      (input: Record<string, unknown>) => Promise<unknown> | unknown
    > = {
      lms_course_page: (input) =>
        browser.lms_course_page(stringField(input, 'courseId', { nonEmpty: true })),
      lms_new_items: (input) =>
        browser.lms_new_items(
          stringField(input, 'courseId', { nonEmpty: true }),
          optionalString(input, 'kind') ?? null
        )
    }
    Object.assign(handlers, browserHandlers)
  }

  return {
    definitions:
      browser === undefined
        ? AGENT_TOOL_DEFINITIONS
        : [...AGENT_TOOL_DEFINITIONS, ...BROWSER_TOOL_DEFINITIONS],
    names:
      browser === undefined
        ? AGENT_TOOL_NAMES
        : [...AGENT_TOOL_NAMES, ...BROWSER_TOOL_NAMES],
    async call(name, args = {}) {
      const handler = handlers[name as AgentToolName]
      if (handler === undefined) {
        return failure(name, new ValidationError(`unknown tool "${name}"`))
      }
      try {
        return success(await handler(inputObject(args)))
      } catch (error) {
        return failure(name, error)
      }
    }
  }
}
