import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createBoardRepo } from '../../../src/main/features/board/boardRepo'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import {
  AGENT_TURN_LIMITS,
  createAgentTools,
  type AgentJournalEntry,
  type AgentTools,
  type AgentToolsDeps
} from '../../../src/main/features/agentTools/tools'
import { createTestDb, type TestDb } from '../helpers/testDb'

const HOST_COURSE_NAME = '도구 테스트 과목'

interface Harness {
  ctx: TestDb
  courseId: string
  courseFolder: string
  tools: AgentTools
  deps: AgentToolsDeps
  actions: AgentJournalEntry[]
  /** Advances the turn, the way a new `send()` does in production. */
  nextTurn: () => void
}

function makeHarness(): Harness {
  const ctx = createTestDb()
  const dataRoot = join(ctx.dir, 'courses')
  mkdirSync(dataRoot)
  const coursesRepo = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
  const hostCourse = coursesRepo.create({ name: HOST_COURSE_NAME, color: 'blue' })
  const materialsRepo = createMaterialsRepo({
    db: ctx.db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    revealItem: () => undefined,
    trashItem: async () => undefined
  })
  const notesRepo = createNotesRepo({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const boardRepo = createBoardRepo(ctx.db)
  const canvasRepo = createCanvasRepo(ctx.db)
  const actions: AgentJournalEntry[] = []
  let turnSeq = 1
  const deps: AgentToolsDeps = {
    courseId: hostCourse.id,
    getTurnId: () => `turn-${turnSeq}`,
    coursesRepo,
    materialsRepo,
    notesRepo,
    boardRepo,
    canvasRepo,
    confirm: async () => true,
    journal: { record: (entry) => actions.push(entry) }
  }
  return {
    ctx,
    courseId: hostCourse.id,
    courseFolder: hostCourse.folderPath,
    tools: createAgentTools(deps),
    deps,
    actions,
    nextTurn: () => {
      turnSeq += 1
    }
  }
}

function message(result: CallToolResult): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected a text tool result')
  return block.text
}

function validRect() {
  return {
    kind: 'rect',
    data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
    style: { color: 'blue', width: 0.01, opacity: 1 }
  }
}

describe('agent app tools', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  afterEach(() => {
    harness.ctx.cleanup()
  })

  test('exposes only the contracted app tools', () => {
    expect(harness.tools.names).toEqual([
      'list_courses',
      'list_materials',
      'list_boards',
      'read_material',
      'list_tasks',
      'create_course',
      'create_note',
      'write_file',
      'create_folder',
      'create_task',
      'update_task',
      'create_board',
      'add_page',
      'add_shapes',
      'rename_material',
      'rename_course',
      'rename_board',
      'delete_material',
      'delete_task',
      'delete_board',
      'delete_course',
      'overwrite_note',
      'edit_sheet',
      'edit_docx_text'
    ])
  })

  describe('read_material', () => {
    test('reads a text material through the tool call path', async () => {
      writeFileSync(
        join(harness.courseFolder, 'week1.md'),
        '# 1주차\n강의 요약',
        'utf8'
      )

      const result = await harness.tools.call('read_material', {
        courseId: harness.courseId,
        relPath: 'week1.md'
      })

      expect(result.isError).toBeUndefined()
      const payload = JSON.parse(message(result)) as {
        supported: boolean
        text: string
      }
      expect(payload.supported).toBe(true)
      expect(payload.text).toBe('# 1주차\n강의 요약')
    })

    test('answers unsupported formats with a clear message, not an error', async () => {
      writeFileSync(
        join(harness.courseFolder, 'clip.mp4'),
        Buffer.from([0, 1, 2])
      )

      const result = await harness.tools.call('read_material', {
        courseId: harness.courseId,
        relPath: 'clip.mp4'
      })

      expect(result.isError).toBeUndefined()
      const payload = JSON.parse(message(result)) as {
        supported: boolean
        message: string
      }
      expect(payload.supported).toBe(false)
      expect(payload.message).toContain('지원하지 않는 형식')
    })

    test('points PDF callers at reading the file directly', async () => {
      writeFileSync(join(harness.courseFolder, 'slides.pdf'), '%PDF-1.4', 'utf8')

      const result = await harness.tools.call('read_material', {
        courseId: harness.courseId,
        relPath: 'slides.pdf'
      })

      const payload = JSON.parse(message(result)) as {
        supported: boolean
        message: string
      }
      expect(payload.supported).toBe(false)
      expect(payload.message).toContain('직접 읽으세요')
    })

    test('honors maxChars with a truncation marker', async () => {
      writeFileSync(
        join(harness.courseFolder, 'long.txt'),
        'b'.repeat(100),
        'utf8'
      )

      const result = await harness.tools.call('read_material', {
        courseId: harness.courseId,
        relPath: 'long.txt',
        maxChars: 10
      })

      const payload = JSON.parse(message(result)) as { text: string }
      expect(payload.text).toContain('b'.repeat(10))
      expect(payload.text).not.toContain('b'.repeat(11))
      expect(payload.text).toContain('잘림')
    })

    test('rejects paths that escape the course folder', async () => {
      const result = await harness.tools.call('read_material', {
        courseId: harness.courseId,
        relPath: '../outside.txt'
      })

      expect(result.isError).toBe(true)
      expect(message(result)).toContain('read_material')
    })
  })

  describe('add_shapes geometry validation', () => {
    test.each([
      {
        label: 'a coordinate outside 0..1',
        shape: {
          ...validRect(),
          data: { box: { x: 0.9, y: 0.1, width: 0.2, height: 0.2 } }
        },
        reason: 'stay inside the normalized page'
      },
      {
        label: 'an empty stroke',
        shape: {
          kind: 'ink',
          data: { points: [] },
          style: { color: 'ink', width: 0.01, opacity: 1 }
        },
        reason: 'needs at least one point'
      },
      {
        label: 'a missing kind-specific field',
        shape: {
          kind: 'textbox',
          data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
          style: { color: 'ink', width: 0.01, opacity: 1 }
        },
        reason: 'textbox data needs text'
      }
    ])('rejects $label without storing any shape', async ({ shape, reason }) => {
      const board = harness.deps.canvasRepo.createBoard({
        courseId: harness.courseId,
        title: '검증'
      })

      const result = await harness.tools.call('add_shapes', {
        boardId: board.id,
        shapes: [validRect(), shape]
      })

      expect(result.isError).toBe(true)
      expect(message(result)).toContain('shapes[1]')
      expect(message(result)).toContain(reason)
      expect(message(result)).toContain('아무 도형도 저장하지 않았습니다')
      expect(harness.deps.canvasRepo.open(board.id).shapes).toEqual([])
    })
  })

  test('create_course returns the live course with the same name instead of duplicating it', async () => {
    const first = await harness.tools.call('create_course', {
      name: '고체역학',
      color: 'orange'
    })
    const second = await harness.tools.call('create_course', {
      name: '고체역학',
      color: 'violet'
    })

    expect(first.isError).not.toBe(true)
    expect(second.isError).not.toBe(true)
    expect(JSON.parse(message(second))).toMatchObject({
      created: false,
      duplicate: true
    })
    expect(
      harness.deps.coursesRepo
        .list({ includeArchived: true })
        .filter((course) => course.name === '고체역학')
    ).toHaveLength(1)
    expect(harness.actions.filter((action) => action.tool === 'create_course'))
      .toHaveLength(1)
  })

  test('rejects course creations beyond the per-turn limit', async () => {
    for (let index = 0; index < AGENT_TURN_LIMITS.courses; index += 1) {
      const result = await harness.tools.call('create_course', {
        name: `시간표 과목 ${index}`,
        color: 'blue'
      })
      expect(result.isError).not.toBe(true)
    }

    const overflow = await harness.tools.call('create_course', {
      name: '시간표 과목 초과',
      color: 'blue'
    })
    expect(overflow.isError).toBe(true)
    expect(message(overflow)).toContain('상한은 20개')
  })

  test('frees the per-turn budget once the turn advances', async () => {
    // Regression: `getTurnId` used to be backed by a module-level counter in
    // registerHandlers that was never incremented, so it returned the same id
    // for the life of the process. `used` only resets when the id changes,
    // which made every budget cumulative — once a student's agent had created
    // 20 courses across a whole session, `create_course` stayed dead until the
    // app restarted, with no message explaining why.
    for (let index = 0; index < AGENT_TURN_LIMITS.courses; index += 1) {
      const result = await harness.tools.call('create_course', {
        name: `1턴 과목 ${index}`,
        color: 'blue'
      })
      expect(result.isError).not.toBe(true)
    }
    expect(
      (
        await harness.tools.call('create_course', {
          name: '1턴 초과',
          color: 'blue'
        })
      ).isError
    ).toBe(true)

    harness.nextTurn()

    const afterTurn = await harness.tools.call('create_course', {
      name: '2턴 과목',
      color: 'blue'
    })
    expect(afterTurn.isError).not.toBe(true)
  })

  test('groups a turn\u2019s journal rows under that turn', async () => {
    // The same frozen id lumped every action ever taken into one undo group.
    await harness.tools.call('create_course', { name: '저널 1턴', color: 'blue' })
    harness.nextTurn()
    await harness.tools.call('create_course', { name: '저널 2턴', color: 'blue' })

    const turnIds = harness.actions
      .filter((action) => action.tool === 'create_course')
      .map((action) => action.turnId)
    expect(new Set(turnIds).size).toBe(2)
  })

  test('rejects file creations beyond the per-turn limit', async () => {
    for (let index = 0; index < AGENT_TURN_LIMITS.files; index += 1) {
      const result = await harness.tools.call('write_file', {
        courseId: harness.courseId,
        dirRelPath: '',
        fileName: `자료-${index}.txt`,
        data: 'safe'
      })
      expect(result.isError).not.toBe(true)
    }

    const overflow = await harness.tools.call('create_folder', {
      courseId: harness.courseId,
      dirRelPath: '',
      name: '초과 폴더'
    })
    expect(overflow.isError).toBe(true)
    expect(message(overflow)).toContain('상한은 50개')
  })

  test('rejects task creations beyond the per-turn limit', async () => {
    for (let index = 0; index < AGENT_TURN_LIMITS.tasks; index += 1) {
      const result = await harness.tools.call('create_task', {
        courseId: harness.courseId,
        title: `할 일 ${index}`
      })
      expect(result.isError).not.toBe(true)
    }

    const overflow = await harness.tools.call('create_task', {
      courseId: harness.courseId,
      title: '초과 할 일'
    })
    expect(overflow.isError).toBe(true)
    expect(message(overflow)).toContain('상한은 50개')
  })

  test('rejects shape creations beyond the per-turn limit', async () => {
    const board = harness.deps.canvasRepo.createBoard({ courseId: harness.courseId })
    const atLimit = await harness.tools.call('add_shapes', {
      boardId: board.id,
      shapes: Array.from({ length: AGENT_TURN_LIMITS.shapes }, validRect)
    })
    expect(atLimit.isError).not.toBe(true)

    const overflow = await harness.tools.call('add_shapes', {
      boardId: board.id,
      shapes: [validRect()]
    })
    expect(overflow.isError).toBe(true)
    expect(message(overflow)).toContain('상한은 500개')
    expect(harness.deps.canvasRepo.open(board.id).shapes).toHaveLength(500)
  })

  test('blocks file paths outside the course folder through resolveInside', async () => {
    const parentEscape = await harness.tools.call('write_file', {
      courseId: harness.courseId,
      dirRelPath: '..',
      fileName: 'escape.txt',
      data: 'unsafe'
    })
    const nameEscape = await harness.tools.call('write_file', {
      courseId: harness.courseId,
      dirRelPath: '',
      fileName: '../../escape.txt',
      data: 'unsafe'
    })

    expect(parentEscape.isError).toBe(true)
    expect(nameEscape.isError).toBe(true)
    expect(message(parentEscape)).toContain('[path-traversal]')
    expect(message(nameEscape)).toContain('[path-traversal]')
    expect(existsSync(join(harness.ctx.dir, 'courses', 'escape.txt'))).toBe(false)
  })

  test('routes every destructive tool through confirmation and makes denial a no-op', async () => {
    const requested: string[] = []
    harness.deps.confirm = async (request) => {
      requested.push(request.tool)
      return false
    }
    harness.deps.materialsRepo.writeFile({
      courseId: harness.courseId,
      dirRelPath: '',
      fileName: '자료.txt',
      encoding: 'utf8',
      data: 'original'
    })
    const note = harness.deps.notesRepo.create({
      courseId: harness.courseId,
      dirRelPath: '',
      title: '필기'
    })
    const task = harness.deps.boardRepo.create({
      courseId: harness.courseId,
      title: '할 일'
    })
    const board = harness.deps.canvasRepo.createBoard({
      courseId: harness.courseId,
      title: '보드'
    })
    const calls: Array<[string, object]> = [
      ['rename_material', { courseId: harness.courseId, relPath: '자료.txt', newName: '새 자료.txt' }],
      ['rename_course', { courseId: harness.courseId, name: '새 과목명' }],
      ['rename_board', { id: board.id, title: '새 보드명' }],
      ['delete_material', { courseId: harness.courseId, relPath: '자료.txt' }],
      ['delete_task', { id: task.id }],
      ['delete_board', { id: board.id }],
      ['delete_course', { courseId: harness.courseId }],
      ['overwrite_note', { courseId: harness.courseId, relPath: note.relPath, markdown: 'changed' }]
    ]

    for (const [name, args] of calls) {
      const result = await harness.tools.call(name, args)
      expect(result.isError).not.toBe(true)
      expect(JSON.parse(message(result))).toMatchObject({ cancelled: true })
    }

    expect(requested).toEqual(calls.map(([name]) => name))
    expect(harness.deps.coursesRepo.getById(harness.courseId).name).toBe(HOST_COURSE_NAME)
    expect(harness.deps.canvasRepo.open(board.id).board.title).toBe('보드')
    expect(harness.deps.boardRepo.list({ includeDone: true })).toHaveLength(1)
    expect(harness.deps.notesRepo.read(note).markdown).toContain('# 필기')
    expect(harness.actions).toEqual([])
  })

  test('returns repository and validation errors as readable tool results instead of throwing', async () => {
    const promise = harness.tools.call('list_materials', { courseId: 'missing' })

    await expect(promise).resolves.toMatchObject({ isError: true })
    const result = await promise
    expect(message(result)).toContain('도구 "list_materials" 실행 실패')
    expect(message(result)).toContain('[not-found]')
    expect(message(result)).toContain('다시 호출하세요')
  })
})
