/**
 * [C2] Workspace tab model.
 *
 * A tab is what lives inside a dockview panel. Payloads must stay
 * JSON-serializable — they are persisted as part of the dockview layout
 * (`layout:save`). Designed for Phase-2 extension (e.g. 'group-chat'):
 * add a new kind + payload and extend TabPayloadMap; never repurpose an
 * existing kind.
 */

export type TabKind =
  | 'pdf'
  | 'note'
  | 'browser'
  | 'chat'
  | 'board'
  | 'group-chat'
  | 'group-whiteboard'

export interface PdfTabPayload {
  courseId: string
  /** Path of the PDF relative to the course folder. */
  relPath: string
}

export interface NoteTabPayload {
  courseId: string
  /** Path of the markdown note relative to the course folder. */
  relPath: string
}

export interface BrowserTabPayload {
  /** Stable id linking this tab to its main-process WebContentsView. */
  tabId: string
  initialUrl: string
}

export interface ChatTabPayload {
  courseId: string
}

/** The board is a per-window singleton; it carries no payload. */
export type BoardTabPayload = Record<string, never>

/**
 * [P2 · M11] Remote study-group chat — ONE tab per course.
 *
 * Identity moved from groupId to courseId: keying by group meant N groups
 * opened N tabs, and because dockview layouts are persisted per course the
 * same group could also occupy a tab in every course's layout. The panel now
 * carries its own group switcher instead, matching how the AI tutor tab is a
 * `chat:${courseId}` singleton.
 *
 * `courseId: null` is the "과목 미지정" bucket — a group joined by invite code
 * before it was linked to any course. Joining deliberately does not ask which
 * course (docs/phase2-community §661).
 *
 * NOTE: a group belongs to at most ONE course. `course_group_links` has a
 * UNIQUE `remote_group_id`, so the old "zero or many courses" comment here
 * contradicted the schema.
 */
/** [M13] The group's shared whiteboard. One board per group, one tab per group. */
export interface GroupWhiteboardTabPayload {
  groupId: string
}

export interface GroupChatTabPayload {
  courseId: string | null
  /** Initially selected group; the panel switches among the course's groups. */
  groupId?: string
}

export interface TabPayloadMap {
  pdf: PdfTabPayload
  note: NoteTabPayload
  browser: BrowserTabPayload
  chat: ChatTabPayload
  board: BoardTabPayload
  'group-chat': GroupChatTabPayload
  'group-whiteboard': GroupWhiteboardTabPayload
}

/** Discriminated tab descriptor: { kind, payload } pairs, serializable. */
export type TabDescriptor = {
  [K in TabKind]: { kind: K; payload: TabPayloadMap[K] }
}[TabKind]

/** Stable panel id helper input — how tabs are identified inside dockview. */
export type TabId = string

// -- structural validation -----------------------------------------------
//
// Lives here rather than in the renderer because BOTH processes validate
// descriptors: the renderer when rehydrating a dockview layout, and main
// when storing a favorite. Keeping it renderer-side forced main to import
// across the project boundary (TS6307), which is exactly the kind of
// main→renderer dependency the tsconfig split exists to prevent.

export const TAB_KINDS: readonly TabKind[] = [
  'pdf',
  'note',
  'browser',
  'chat',
  'board',
  'group-chat',
  'group-whiteboard'
]

export function isTabKind(value: unknown): value is TabKind {
  return typeof value === 'string' && (TAB_KINDS as string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Hard structural validation of a persisted tab descriptor. */
export function isTabDescriptor(value: unknown): value is TabDescriptor {
  if (!isRecord(value) || !isTabKind(value['kind'])) return false
  const payload = value['payload']
  if (!isRecord(payload)) return false

  switch (value['kind']) {
    case 'pdf':
    case 'note':
      return (
        isNonEmptyString(payload['courseId']) &&
        isNonEmptyString(payload['relPath'])
      )
    case 'browser':
      return (
        isNonEmptyString(payload['tabId']) &&
        typeof payload['initialUrl'] === 'string'
      )
    case 'chat':
      return isNonEmptyString(payload['courseId'])
    case 'board':
      return true
    case 'group-whiteboard':
      return isNonEmptyString(payload['groupId'])
    case 'group-chat': {
      const courseId = payload['courseId']
      if (courseId !== null && !isNonEmptyString(courseId)) return false
      const groupId = payload['groupId']
      return groupId === undefined || isNonEmptyString(groupId)
    }
  }
}
