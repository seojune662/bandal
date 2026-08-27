import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createBoardRepo } from '../../../src/main/features/board/boardRepo'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createCourseGroupsRepo } from '../../../src/main/features/courses/courseGroupsRepo'
import { createCourseLinksRepo } from '../../../src/main/features/courses/courseLinksRepo'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createFavoritesRepo } from '../../../src/main/features/favorites'
import { createLinkService } from '../../../src/main/features/link/linkService'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import { createSearchIndex } from '../../../src/main/features/search/searchIndex'
import {
  AGENT_TURN_LIMITS,
  createAgentTools,
  type AgentJournalEntry,
  type AgentTools,
  type AgentToolsDeps
} from '../../../src/main/features/agentTools/tools'
import { RawToolResult } from '../../../src/main/features/agentTools/toolHandlers/context'
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
  const courseGroupsRepo = createCourseGroupsRepo(ctx.db)
  const courseLinksRepo = createCourseLinksRepo(ctx.db)
  const favoritesRepo = createFavoritesRepo(ctx.db)
  const searchIndex = createSearchIndex(ctx.db, {
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const linkService = createLinkService({
    notes: notesRepo,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const actions: AgentJournalEntry[] = []
  let turnSeq = 1
  const deps: AgentToolsDeps = {
    courseId: hostCourse.id,
    getTurnId: () => `turn-${turnSeq}`,
    coursesRepo,
    courseGroupsRepo,
    materialsRepo,
    courseLinksRepo,
    favoritesRepo,
    searchIndex,
    linkService,
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

async function callOk<T>(tools: AgentTools, name: string, args: object): Promise<T> {
  const result = await tools.call(name, args)
  expect(result.isError).not.toBe(true)
  return JSON.parse(message(result)) as T
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
      'app_state',
      'list_courses',
      'list_course_groups',
      'create_course_group',
      'rename_course_group',
      'delete_course_group',
      'set_course_group',
      'archive_course',
      'list_materials',
      'link_materials',
      'list_links',
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
      'edit_docx_text',
      'list_course_links',
      'create_course_link',
      'update_course_link',
      'delete_course_link',
      'move_material',
      'duplicate_material',
      'list_favorites',
      'add_favorite',
      'rename_favorite',
      'remove_favorite',
      'search_course',
      'remove_shapes',
      'send_highlight_to_note',
      'send_web_clip_to_note'
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

  test('wraps course-link create, list, update, and delete', async () => {
    const created = await callOk<{ id: string }>(harness.tools, 'create_course_link', {
      courseId: harness.courseId,
      label: '강의실',
      rawUrl: 'https://lms.example/courses/42',
      kind: 'lms-course',
      lmsCourseId: '42'
    })
    expect(await callOk<unknown[]>(harness.tools, 'list_course_links', {
      courseId: harness.courseId
    })).toHaveLength(1)
    expect(await callOk<{ label: string }>(harness.tools, 'update_course_link', {
      id: created.id, label: '새 강의실', sortOrder: 2
    })).toMatchObject({ label: '새 강의실' })
    await callOk(harness.tools, 'delete_course_link', { id: created.id })
    expect(harness.deps.courseLinksRepo.list({ courseId: harness.courseId })).toEqual([])
  })

  test('moves and duplicates materials inside the course folder', async () => {
    mkdirSync(join(harness.courseFolder, '2주차'))
    writeFileSync(join(harness.courseFolder, '강의.md'), '본문')
    const moved = await callOk<{ relPath: string }>(harness.tools, 'move_material', {
      courseId: harness.courseId, fromRelPath: '강의.md', toDirRelPath: '2주차'
    })
    const copied = await callOk<{ relPath: string }>(harness.tools, 'duplicate_material', {
      courseId: harness.courseId, relPath: moved.relPath
    })
    expect(existsSync(join(harness.courseFolder, moved.relPath))).toBe(true)
    expect(existsSync(join(harness.courseFolder, copied.relPath))).toBe(true)
  })

  test('wraps favorite add, list, rename, and remove', async () => {
    const favorite = await callOk<{ id: string }>(harness.tools, 'add_favorite', {
      courseId: harness.courseId,
      label: '필기',
      descriptor: { kind: 'note', payload: { courseId: harness.courseId, relPath: '필기.md' } }
    })
    expect(await callOk<unknown[]>(harness.tools, 'list_favorites', {
      courseId: harness.courseId
    })).toHaveLength(1)
    expect(await callOk<{ label: string }>(harness.tools, 'rename_favorite', {
      id: favorite.id, label: '중요 필기'
    })).toMatchObject({ label: '중요 필기' })
    await callOk(harness.tools, 'remove_favorite', { id: favorite.id })
    expect(harness.deps.favoritesRepo.list(harness.courseId)).toEqual([])
  })

  test('searches indexed course text', async () => {
    writeFileSync(join(harness.courseFolder, '검색.md'), '# 정리\n라그랑주 승수법')
    const result = await callOk<{ hits: { relPath: string }[] }>(
      harness.tools, 'search_course',
      { courseId: harness.courseId, query: '라그랑주', limit: 5 }
    )
    expect(result.hits[0]?.relPath).toBe('검색.md')
  })

  test('removes personal-board shapes', async () => {
    const board = harness.deps.canvasRepo.createBoard({ courseId: harness.courseId })
    harness.deps.canvasRepo.putShape({ boardId: board.id, id: 'shape-1', shape: validRect() })
    await callOk(harness.tools, 'remove_shapes', { boardId: board.id, ids: ['shape-1'] })
    expect(harness.deps.canvasRepo.open(board.id).shapes).toEqual([])
  })

  test('sends material highlights and web clips to notes', async () => {
    writeFileSync(join(harness.courseFolder, '강의.pdf'), '%PDF')
    const note = harness.deps.notesRepo.create({
      courseId: harness.courseId, dirRelPath: '', title: '연결 필기'
    })
    await callOk(harness.tools, 'send_highlight_to_note', {
      courseId: harness.courseId, relPath: '강의.pdf', page: 3,
      quote: '핵심 문장', comment: null, annotationId: 'annotation-1', noteRelPath: note.relPath
    })
    await callOk(harness.tools, 'send_web_clip_to_note', {
      courseId: harness.courseId, url: 'https://example.com/post', title: '참고 글',
      quote: '웹 인용문', comment: '메모', noteRelPath: note.relPath
    })
    const markdown = harness.deps.notesRepo.read(note).markdown
    expect(markdown).toContain('bandal://material')
    expect(markdown).toContain('https://example.com/post')
  })

  test('new confirmed tools make denial a no-op', async () => {
    const link = harness.deps.courseLinksRepo.create({
      courseId: harness.courseId, label: '강의실', rawUrl: 'https://lms.example/1',
      kind: 'lms-course'
    })
    writeFileSync(join(harness.courseFolder, '이동.md'), '그대로')
    mkdirSync(join(harness.courseFolder, '대상'))
    const favorite = harness.deps.favoritesRepo.add({
      courseId: harness.courseId, label: '필기',
      descriptor: { kind: 'note', payload: { courseId: harness.courseId, relPath: '필기.md' } }
    })
    const board = harness.deps.canvasRepo.createBoard({ courseId: harness.courseId })
    harness.deps.canvasRepo.putShape({ boardId: board.id, id: 'shape-1', shape: validRect() })
    harness.deps.confirm = async () => false
    const calls: Array<[string, object]> = [
      ['delete_course_link', { id: link.id }],
      ['move_material', { courseId: harness.courseId, fromRelPath: '이동.md', toDirRelPath: '대상' }],
      ['remove_favorite', { id: favorite.id }],
      ['remove_shapes', { boardId: board.id, ids: ['shape-1'] }]
    ]
    for (const [name, args] of calls) {
      expect(await callOk<{ cancelled: boolean }>(harness.tools, name, args))
        .toMatchObject({ cancelled: true })
    }
    expect(harness.deps.courseLinksRepo.list({ courseId: harness.courseId })).toHaveLength(1)
    expect(existsSync(join(harness.courseFolder, '이동.md'))).toBe(true)
    expect(harness.deps.favoritesRepo.list(harness.courseId)).toHaveLength(1)
    expect(harness.deps.canvasRepo.open(board.id).shapes).toHaveLength(1)
  })

  test.each([
    ['move_material', { courseId: 'COURSE', fromRelPath: '../밖.md', toDirRelPath: '' }],
    ['move_material', { courseId: 'COURSE', fromRelPath: '안.md', toDirRelPath: '/tmp' }],
    ['duplicate_material', { courseId: 'COURSE', relPath: '../밖.md' }],
    ['duplicate_material', { courseId: 'COURSE', relPath: '/tmp/밖.md' }],
    ['send_highlight_to_note', { courseId: 'COURSE', relPath: '../밖.pdf', page: 1, quote: '문구', comment: null, annotationId: 'a' }],
    ['send_highlight_to_note', { courseId: 'COURSE', relPath: '/tmp/밖.pdf', page: 1, quote: '문구', comment: null, annotationId: 'a' }],
    ['send_web_clip_to_note', { courseId: 'COURSE', url: 'https://x.test', title: 'x', quote: '문구', comment: null, noteRelPath: '../밖.md' }],
    ['send_web_clip_to_note', { courseId: 'COURSE', url: 'https://x.test', title: 'x', quote: '문구', comment: null, noteRelPath: '/tmp/밖.md' }]
  ])('%s rejects course-folder path escapes', async (name, rawArgs) => {
    const args = { ...rawArgs, courseId: harness.courseId }
    const result = await harness.tools.call(name, args)
    expect(result.isError).toBe(true)
    expect(message(result)).toContain('[path-traversal]')
  })

  describe('browser tools registration', () => {
    test('are absent when the caller supplies none', () => {
      // The optionality is for tests and for any future caller that genuinely
      // has no browser. The APP always supplies them — see
      // registerHandlers.browserToolsFor.
      expect(harness.tools.names).not.toContain('lms_new_items')
      expect(
        harness.tools.definitions.some((d) => d.name === 'lms_new_items')
      ).toBe(false)
    })

    test('browser_tabs is registered and callable', async () => {
      // The regression this locks: browser tools used to be gated on the
      // course having a classroom linked, so a student looking at their
      // university portal was told the assistant had no way to read a
      // browser. That was true, and it was the bug.
      const tools = createAgentTools({
        ...harness.deps,
        browser: {
          browser_tabs: () => ({
            status: 'ok',
            tabs: [{ tabId: 't1', title: '포털', url: 'https://x/', active: true, asleep: false }],
            activeTabId: 't1'
          }),
          lms_course_page: () => ({}),
          lms_new_items: async () => ({})
        }
      })
      expect(tools.names).toContain('browser_tabs')
      const result = await tools.call('browser_tabs', {})
      expect(result.isError).not.toBe(true)
    })

    test('appear only when the session is given them', async () => {
      const tools = createAgentTools({
        ...harness.deps,
        browser: {
          lms_course_page: () => ({ url: 'https://x/courses/1' }),
          lms_new_items: async () => ({ status: 'ok', items: [] })
        }
      })
      expect(tools.names).toContain('lms_new_items')
      expect(tools.names).toContain('lms_course_page')

      const result = await tools.call('lms_new_items', { courseId: 'c' })
      expect(result.isError).not.toBe(true)
    })

    test('an unknown tool is still refused when browser tools are on', async () => {
      const tools = createAgentTools({
        ...harness.deps,
        browser: {
          lms_course_page: () => ({}),
          lms_new_items: async () => ({})
        }
      })
      expect((await tools.call('lms_delete_everything', {})).isError).toBe(true)
    })

    test('courseId is required', async () => {
      const tools = createAgentTools({
        ...harness.deps,
        browser: {
          lms_course_page: () => ({}),
          lms_new_items: async () => ({})
        }
      })
      expect((await tools.call('lms_new_items', {})).isError).toBe(true)
      expect(
        (await tools.call('lms_new_items', { courseId: '  ' })).isError
      ).toBe(true)
    })
  })

  describe('desktop tools registration', () => {
    test('desktop names are absent without desktop deps', () => {
      expect(
        harness.tools.names.some((name) => name.startsWith('desktop_'))
      ).toBe(false)
      expect(
        harness.tools.definitions.some(({ name }) =>
          name.startsWith('desktop_')
        )
      ).toBe(false)
    })

    test('registers all four tools and preserves RawToolResult', async () => {
      const raw: CallToolResult = {
        content: [{ type: 'text', text: 'raw desktop result' }]
      }
      const desktopScreenshot = vi.fn(async () => new RawToolResult(raw))
      const tools = createAgentTools({
        ...harness.deps,
        desktop: {
          desktop_screenshot: desktopScreenshot,
          desktop_windows: async () => ({ windows: [] }),
          desktop_frontmost: async () => ({ app: 'Finder' }),
          desktop_clipboard_read: async () => ({ text: 'copied' })
        }
      })

      expect(
        tools.names.filter((name) => name.startsWith('desktop_'))
      ).toEqual([
        'desktop_screenshot',
        'desktop_windows',
        'desktop_frontmost',
        'desktop_clipboard_read'
      ])
      expect(
        tools.definitions
          .map(({ name }) => name)
          .filter((name) => name.startsWith('desktop_'))
      ).toEqual([
        'desktop_screenshot',
        'desktop_windows',
        'desktop_frontmost',
        'desktop_clipboard_read'
      ])

      const result = await tools.call('desktop_screenshot', { window: 'w1' })
      expect(result).toBe(raw)
      expect(desktopScreenshot).toHaveBeenCalledWith({ window: 'w1' })
    })
  })

})
