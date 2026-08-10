import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const string = (description: string): object => ({ type: 'string', description })
const boolean = (description: string): object => ({ type: 'boolean', description })
const integer = (description: string, minimum = 1): object => ({
  type: 'integer',
  minimum,
  description
})
const nullableString = (description: string): object => ({
  type: ['string', 'null'],
  description
})

function objectSchema(
  properties: Record<string, object>,
  required: string[] = []
): Tool['inputSchema'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

const courseId = string('과목 ID. list_courses 결과의 id를 사용합니다.')
const boardId = string('화이트보드 ID. list_boards 결과의 id를 사용합니다.')
const relPath = string('과목 폴더 기준 상대 경로. 절대 경로와 폴더 밖 경로는 금지됩니다.')

const shapeSchema = {
  type: 'object',
  description: '좌표가 페이지 기준 0..1인 도형 한 개',
  properties: {
    id: string('선택적인 도형 ID. 생략하면 안전한 랜덤 ID가 생성됩니다.'),
    kind: {
      type: 'string',
      enum: ['ink', 'highlighter', 'rect', 'ellipse', 'arrow', 'line', 'textbox', 'clip', 'image']
    },
    data: {
      type: 'object',
      description: 'points, box, text, clip 또는 image. kind별 필수 필드를 포함해야 합니다.',
      properties: {
        points: {
          type: 'array',
          items: objectSchema(
            {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              p: { type: 'number', minimum: 0, maximum: 1 }
            },
            ['x', 'y', 'p']
          )
        },
        box: objectSchema(
          {
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', minimum: 0, maximum: 1 },
            height: { type: 'number', minimum: 0, maximum: 1 }
          },
          ['x', 'y', 'width', 'height']
        ),
        text: { type: 'string' },
        clip: objectSchema(
          {
            relPath,
            page: integer('원본 PDF의 1부터 시작하는 페이지'),
            label: string('원본을 표시할 이름'),
            crop: { type: 'object', description: '선택적인 원본 페이지의 0..1 영역' }
          },
          ['relPath', 'page', 'label']
        ),
        image: objectSchema(
          { relPath, label: string('이미지를 표시할 이름') },
          ['relPath', 'label']
        )
      },
      additionalProperties: false
    },
    style: objectSchema(
      {
        color: {
          type: 'string',
          enum: ['ink', 'red', 'orange', 'yellow', 'green', 'blue', 'violet']
        },
        width: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        fontScale: { type: 'number', exclusiveMinimum: 0, maximum: 10 }
      },
      ['color', 'width', 'opacity']
    )
  },
  required: ['kind', 'data', 'style'],
  additionalProperties: false
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
}
const creates = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
}
const mutates = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
}
const confirms = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
}

export const AGENT_TOOL_DEFINITIONS = [
  {
    name: 'list_courses',
    description: '살아있는 과목 목록을 조회합니다.',
    inputSchema: objectSchema({ includeArchived: boolean('보관된 과목도 포함할지 여부') }),
    annotations: readOnly
  },
  {
    name: 'list_materials',
    description: '과목 폴더 안의 자료와 하위 폴더를 조회합니다.',
    inputSchema: objectSchema({ courseId }, ['courseId']),
    annotations: readOnly
  },
  {
    name: 'list_boards',
    description: '과목의 개인 화이트보드 목록을 조회합니다.',
    inputSchema: objectSchema({ courseId }, ['courseId']),
    annotations: readOnly
  },
  {
    name: 'list_tasks',
    description: '할 일 목록을 조회합니다. courseId를 생략하면 전체를 조회합니다.',
    inputSchema: objectSchema({
      courseId: nullableString('과목 ID, null이면 전역 할 일, 생략하면 전체'),
      includeDone: boolean('완료한 할 일도 포함할지 여부')
    }),
    annotations: readOnly
  },
  {
    name: 'create_course',
    description: '과목을 만듭니다. 같은 이름의 살아있는 과목이 있으면 기존 과목을 반환합니다.',
    inputSchema: objectSchema(
      { name: string('과목 이름'), color: string('과목 색상. 생략하면 blue') },
      ['name']
    ),
    annotations: creates
  },
  {
    name: 'create_note',
    description: '과목 폴더 안에 새 Markdown 필기를 만듭니다.',
    inputSchema: objectSchema(
      {
        courseId,
        dirRelPath: string('만들 디렉터리의 과목 기준 상대 경로. 루트는 빈 문자열'),
        title: string('필기 제목'),
        markdown: string('선택적인 초기 Markdown 본문')
      },
      ['courseId', 'dirRelPath', 'title']
    ),
    annotations: creates
  },
  {
    name: 'write_file',
    description: '과목 폴더 안에 새 파일을 씁니다. 같은 이름이 있으면 새 이름을 골라 덮어쓰지 않습니다.',
    inputSchema: objectSchema(
      {
        courseId,
        dirRelPath: string('대상 디렉터리의 과목 기준 상대 경로. 루트는 빈 문자열'),
        fileName: string('경로 구분자가 없는 파일 이름'),
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        data: string('파일 내용')
      },
      ['courseId', 'dirRelPath', 'fileName', 'data']
    ),
    annotations: creates
  },
  {
    name: 'create_folder',
    description: '과목 폴더 안에 새 폴더를 만듭니다.',
    inputSchema: objectSchema(
      {
        courseId,
        dirRelPath: string('부모 디렉터리의 과목 기준 상대 경로. 루트는 빈 문자열'),
        name: string('경로 구분자가 없는 폴더 이름')
      },
      ['courseId', 'dirRelPath', 'name']
    ),
    annotations: creates
  },
  {
    name: 'create_task',
    description: '새 할 일, 과제, 시험 또는 수업 일정을 만듭니다.',
    inputSchema: objectSchema(
      {
        courseId: nullableString('과목 ID. 전역 할 일은 null'),
        title: string('제목'),
        notes: string('설명'),
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'] },
        kind: { type: 'string', enum: ['task', 'assignment', 'exam', 'class'] },
        dueAt: nullableString('ISO 날짜/시간 또는 null'),
        allDay: boolean('종일 일정인지 여부')
      },
      ['courseId', 'title']
    ),
    annotations: creates
  },
  {
    name: 'update_task',
    description: '기존 할 일의 제목, 상태, 종류, 기한 등을 수정합니다.',
    inputSchema: objectSchema(
      {
        id: string('할 일 ID'),
        courseId: nullableString('새 과목 ID 또는 전역으로 옮길 때 null'),
        title: string('새 제목'),
        notes: string('새 설명'),
        status: { type: 'string', enum: ['todo', 'in-progress', 'done'] },
        kind: { type: 'string', enum: ['task', 'assignment', 'exam', 'class'] },
        dueAt: nullableString('ISO 날짜/시간 또는 null'),
        allDay: boolean('종일 일정인지 여부'),
        sortOrder: integer('0부터 시작하는 정렬 순서', 0)
      },
      ['id']
    ),
    annotations: mutates
  },
  {
    name: 'create_board',
    description: '과목에 개인 화이트보드를 만듭니다.',
    inputSchema: objectSchema(
      {
        courseId,
        title: string('화이트보드 제목'),
        background: { type: 'string', enum: ['grid', 'dots', 'lines', 'blank'] },
        surface: { type: 'string', enum: ['dark', 'light'] }
      },
      ['courseId']
    ),
    annotations: creates
  },
  {
    name: 'add_page',
    description: '화이트보드 끝에 빈 페이지 한 장을 추가합니다.',
    inputSchema: objectSchema({ boardId }, ['boardId']),
    annotations: creates
  },
  {
    name: 'add_shapes',
    description: '화이트보드 페이지에 검증된 0..1 좌표 도형을 추가합니다. 한 호출의 도형은 모두 검증된 뒤 저장됩니다.',
    inputSchema: objectSchema(
      {
        boardId,
        page: integer('화이트보드의 1부터 시작하는 페이지. 생략하면 1'),
        shapes: { type: 'array', minItems: 1, items: shapeSchema }
      },
      ['boardId', 'shapes']
    ),
    annotations: creates
  },
  {
    name: 'rename_material',
    description: '확인을 받은 뒤 자료 파일이나 폴더의 이름을 바꿉니다.',
    inputSchema: objectSchema(
      { courseId, relPath, newName: string('경로 구분자가 없는 새 이름') },
      ['courseId', 'relPath', 'newName']
    ),
    annotations: confirms
  },
  {
    name: 'rename_course',
    description: '확인을 받은 뒤 과목 이름을 바꿉니다.',
    inputSchema: objectSchema(
      { courseId, name: string('새 과목 이름') },
      ['courseId', 'name']
    ),
    annotations: confirms
  },
  {
    name: 'rename_board',
    description: '확인을 받은 뒤 화이트보드 이름을 바꿉니다.',
    inputSchema: objectSchema(
      { id: boardId, title: string('새 화이트보드 제목') },
      ['id', 'title']
    ),
    annotations: confirms
  },
  {
    name: 'delete_material',
    description: '확인을 받은 뒤 자료 파일이나 폴더를 휴지통으로 보냅니다.',
    inputSchema: objectSchema({ courseId, relPath }, ['courseId', 'relPath']),
    annotations: confirms
  },
  {
    name: 'delete_task',
    description: '확인을 받은 뒤 할 일을 삭제합니다.',
    inputSchema: objectSchema({ id: string('할 일 ID') }, ['id']),
    annotations: confirms
  },
  {
    name: 'delete_board',
    description: '확인을 받은 뒤 화이트보드와 그 도형을 삭제합니다.',
    inputSchema: objectSchema({ id: boardId }, ['id']),
    annotations: confirms
  },
  {
    name: 'delete_course',
    description: '확인을 받은 뒤 과목을 앱에서 삭제합니다. 과목 폴더는 디스크에 남습니다.',
    inputSchema: objectSchema({ courseId }, ['courseId']),
    annotations: confirms
  },
  {
    name: 'overwrite_note',
    description: '확인을 받은 뒤 기존 Markdown 필기의 전체 내용을 덮어씁니다.',
    inputSchema: objectSchema(
      {
        courseId,
        relPath,
        markdown: string('새 Markdown 전체 내용'),
        expectedMtime: integer('알고 있는 기존 수정 시각(epoch ms)', 0)
      },
      ['courseId', 'relPath', 'markdown']
    ),
    annotations: confirms
  }
] as const satisfies readonly Tool[]

export type AgentToolName = (typeof AGENT_TOOL_DEFINITIONS)[number]['name']

export const AGENT_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.map(
  (tool) => tool.name
) as readonly AgentToolName[]
