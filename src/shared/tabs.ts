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
 * [P2] Remote study-group chat. `groupId` is the REMOTE `study_groups.id`,
 * never a local courseId — a group can be linked to zero or many courses, and
 * the remote side knows nothing about your folders (docs/phase2-community
 * §2.2 / §3.1).
 */
export interface GroupChatTabPayload {
  groupId: string
}

export interface TabPayloadMap {
  pdf: PdfTabPayload
  note: NoteTabPayload
  browser: BrowserTabPayload
  chat: ChatTabPayload
  board: BoardTabPayload
  'group-chat': GroupChatTabPayload
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
  'group-chat'
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
    case 'group-chat':
      return isNonEmptyString(payload['groupId'])
  }
}
