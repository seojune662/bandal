/**
 * What the assistant did to the app, and how the student takes it back.
 *
 * The agent reads third-party lecture PDFs, so giving it app-mutating tools
 * widens the blast radius of prompt injection. Three things keep that in
 * check and all three are visible here: destructive tools ask first, every
 * successful call is journalled, and creations can be undone in one gesture.
 */

/** What a tool touched. Used to pick the right undo. */
export type AgentActionTarget =
  | 'course'
  | 'material'
  | 'note'
  | 'task'
  | 'board'
  | 'shape'
  /**
   * 기존 문서의 제자리 편집(edit_sheet / edit_docx_text). targetId 는
   * `relPath\u0000backupAbs` — 되돌리기는 백업을 원래 경로로 복사한다.
   */
  | 'material-edit'

export interface AgentAction {
  id: string
  courseId: string
  /** Groups everything one request changed, so undo is one gesture. */
  turnId: string
  tool: string
  targetKind: AgentActionTarget
  targetId: string
  /** Human-readable, e.g. "과목 «고체역학»". Shown in the change list. */
  label: string
  /** False for deletes and overwrites — there is nothing to restore. */
  undoable: boolean
  undoneAt: string | null
  createdAt: string
}

export interface AgentTurnChanges {
  turnId: string
  actions: AgentAction[]
}

/**
 * A destructive tool waiting on the student.
 *
 * Deliberately NOT the CLI's own permission flow: Codex has no interactive
 * approval at all (`respondPermission` is a no-op there), so relying on it
 * would leave that provider unguarded.
 */
export interface AgentConfirmRequest {
  requestId: string
  courseId: string
  tool: string
  /** One line describing exactly what will happen, in the student's language. */
  summary: string
  /** Extra detail — the paths or names involved. */
  details: string[]
}

export interface AgentConfirmResponse {
  requestId: string
  approved: boolean
}
