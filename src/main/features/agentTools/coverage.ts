/**
 * Which of the app's own capabilities the agent can reach — and, for the rest,
 * why not.
 *
 * This file exists because of a real failure. 학기 그룹 shipped in v0.8.2 with
 * a repo, IPC, and drag-and-drop in the sidebar. Eleven releases later the
 * agent still had no tool for it — the word "group" appeared ZERO times in the
 * whole agentTools layer — so a student who asked to change the semester got
 * the assistant clicking around a university website instead, because the
 * browser was the only surface it could see.
 *
 * Nothing detected that. There was no list to be missing from.
 *
 * So: every channel that CHANGES the study workspace must appear here, either
 * mapped to a tool or refused with a reason. A new feature that does neither
 * fails `coverage.test.ts` with the channel name in the message. The point is
 * not the mapping — it is that forgetting becomes loud.
 *
 * Out of scope on purpose: identity and social (`auth:*`, `groups:*`,
 * `friends:*`, `invites:*`, `safety:*`), secrets (`credentials:*`), the
 * assistant's own plumbing (`chat:*`, `agent:*`, `agentTools:*`,
 * `browserAgent:*`), and app/system surfaces (`settings:*`, `update:*`,
 * `window:*`, `shell:*`, `print:*`, `layout:*`, `media:*`, `context:*`). Those
 * are not the study workspace. `overlay:*` is desktop-window plumbing and
 * `mcp:*` manages external tool configuration, so neither prefix belongs in
 * WORKSPACE_PREFIXES either. An agent that could sign the student out or read
 * the credential store is a different product.
 */

/** The prefixes this file governs — the student's study workspace. */
export const WORKSPACE_PREFIXES: readonly string[] = [
  'activity',
  'annotations',
  'board',
  'calendar',
  'canvas',
  'courseGroups',
  'courseLinks',
  'courses',
  'drawings',
  'favorites',
  'link',
  'links',
  'materials',
  'notes',
  'pdf',
  'search',
  'study',
  'whiteboard'
]

/** Channel name → the agent tool that covers it. */
export const AGENT_CHANNEL_TOOLS: Readonly<Record<string, string>> = {
  'courses:create': 'create_course',
  'courses:rename': 'rename_course',
  'courses:archive': 'archive_course',
  'courses:delete': 'delete_course',
  'courses:organize': 'set_course_group',
  'courseGroups:create': 'create_course_group',
  'courseGroups:rename': 'rename_course_group',
  'courseGroups:delete': 'delete_course_group',
  'courseLinks:create': 'create_course_link',
  'courseLinks:update': 'update_course_link',
  'courseLinks:delete': 'delete_course_link',
  'materials:move': 'move_material',
  'materials:rename': 'rename_material',
  'materials:delete': 'delete_material',
  'materials:duplicate': 'duplicate_material',
  'materials:writeFile': 'write_file',
  'materials:createFolder': 'create_folder',
  'notes:create': 'create_note',
  'notes:write': 'overwrite_note',
  'notes:rename': 'rename_material',
  'board:createTask': 'create_task',
  'board:updateTask': 'update_task',
  'board:reorderTasks': 'update_task',
  'board:deleteTask': 'delete_task',
  'favorites:add': 'add_favorite',
  'favorites:rename': 'rename_favorite',
  'favorites:remove': 'remove_favorite',
  'links:create': 'link_materials',
  'search:query': 'search_course',
  'canvas:create': 'create_board',
  'canvas:rename': 'rename_board',
  'canvas:remove': 'delete_board',
  'canvas:setPageCount': 'add_page',
  'canvas:putShape': 'add_shapes',
  'canvas:removeShapes': 'remove_shapes',
  'link:sendHighlightToNote': 'send_highlight_to_note',
  'link:sendWebClipToNote': 'send_web_clip_to_note'
}

/**
 * App tools that can mutate the study workspace.
 *
 * Workflow-pack runs derive their runtime allowlist gate from this set so the
 * security boundary stays coupled to the capability coverage map above. A
 * newly mapped mutation therefore becomes restricted automatically instead
 * of relying on a second hand-maintained list.
 */
export const AGENT_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(AGENT_CHANNEL_TOOLS)
)

/**
 * Channels the agent deliberately cannot reach, and why.
 *
 * A reason is required. "We did not get to it" is not one — that is the state
 * this file exists to make visible, so leave such a channel out entirely and
 * let the test fail.
 */
export const NOT_FOR_AGENT: Readonly<Record<string, string>> = {
  // -- irreversible or outside the app's own data ---------------------------
  'courses:purge':
    '휴지통 비우기는 되돌릴 수 없고 디스크의 실제 폴더를 지운다. 학생이 직접 누른다.',
  'courses:pickFolder': 'OS 폴더 선택 창. 사람이 서 있어야 하는 자리다.',
  'courses:addFromFolder':
    '폴더 선택 창의 결과를 받는 짝. pickFolder 없이는 의미가 없다.',
  'courses:relink':
    '끊긴 과목을 다른 폴더에 다시 붙이는 일. 잘못 붙이면 남의 과목 자료를 그 과목 것으로 만든다.',
  'materials:reveal': 'Finder 를 여는 일. 앱 밖의 동작이다.',
  'links:remove':
    '링크 해제는 학생이 화면에서 한 번 누르면 되고, 에이전트가 자료 그래프를 지울 이유가 없다.',

  // -- internal plumbing, not capabilities ----------------------------------
  'materials:watch': '파일 감시자 수명. 렌더러가 패널을 열고 닫으며 관리한다.',
  'materials:unwatch': '파일 감시자를 떼는 짝. 위와 같은 이유로 렌더러 소관이다.',
  'activity:record': '텔레메트리. 에이전트가 자기 활동을 위조할 자리가 아니다.',
  'whiteboard:open': '공유 화이트보드 세션 수명. 렌더러가 관리한다.',
  'whiteboard:close': '공유 세션을 닫는 짝. 위와 같은 이유로 렌더러 소관이다.',
  'whiteboard:sync': '실시간 동기화 배관.',
  'canvas:open': '캔버스 세션 수명. 렌더러가 관리한다.',
  'search:indexPdfPages': '색인 배관. 검색이 알아서 부른다.',
  'study:tools': '학습 계획 러너의 내부 표면.',
  'study:run': '위와 같음 — 에이전트가 자기를 재귀 호출할 자리다.',

  // -- shared/group surfaces, which are a different product ------------------
  'whiteboard:addShape': '공유 화이트보드는 다른 사람과 같이 쓰는 면이다. 개인 보드는 add_shapes 가 있다.',
  'whiteboard:removeShapes': '공유 화이트보드는 다른 사람과 같이 쓰는 면이다.',
  'whiteboard:updateShape': '공유 화이트보드는 다른 사람과 같이 쓰는 면이다.',

  // -- the agent cannot compute what these need -----------------------------
  'annotations:create':
    '하이라이트는 PDF 페이지 위의 좌표 사각형이다. 에이전트는 그걸 계산할 수단이 없고, 짐작해서 그으면 엉뚱한 문단이 칠해진다. 이미 있는 하이라이트를 필기로 보내는 건 link:sendHighlightToNote 가 한다.',
  'annotations:update': '위와 같은 이유 — 좌표를 다루는 일이다.',
  'annotations:delete':
    '학생이 자기 손으로 그은 표시다. 지우는 건 본인이 판단할 일이고, 되돌릴 수도 없다.',
  'drawings:create':
    '자유 필기(잉크)는 점의 궤적이다. 에이전트가 만들 만한 것이 아니다.',
  'drawings:update': '자유 필기의 궤적을 고치는 일이다. 위와 같은 이유로 사람 몫이다.',
  'drawings:delete': '학생이 손으로 그린 것이다. 지우는 건 본인 몫이다.',
  'canvas:setBackground': '보드 배경은 취향이다. 시켜서 바꿀 일이 아니다.',
  'favorites:reorder':
    '순서는 취향이고, 에이전트에겐 학생이 무엇을 자주 쓰는지 알 근거가 없다.',

  // -- already covered by a better path --------------------------------------
  'materials:downloadFromUrl':
    '주소에서 자료를 받는 일은 browser_download 가 한다. 그쪽은 학생의 로그인 세션을 쓰고 사이트 권한 게이트를 지난다.',
  'materials:import':
    'OS 파일 선택 창이 짝인 경로다. 에이전트가 부를 자리가 없고, 파일을 만드는 일은 write_file 이 한다.',
  'pdf:exportAnnotated':
    '저장 위치를 묻는 OS 창이 뜬다. 사람이 서 있어야 하는 자리다.',
  'canvas:exportPdf': '위와 같음 — 저장 창이 뜬다.'
}
