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
