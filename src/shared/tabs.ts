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
  | 'whiteboard'
  | 'image'
  | 'file'
  | 'plugin-panel'

export interface PdfTabPayload {
  courseId: string
  /** Path of the PDF relative to the course folder. */
  relPath: string
}

export interface ImageTabPayload {
  courseId: string
  /** Path of the image relative to the course folder. */
  relPath: string
}

export interface NoteTabPayload {
  courseId: string
  /** Path of the markdown note relative to the course folder. */
  relPath: string
}

/**
 * What a fresh browser tab carries. It is not navigated to — the app shows its
 * own start page instead — but it stays a real URL so older saved layouts and
 * favorites keep resolving.
 */
export const NEW_TAB_URL = 'https://www.google.com'

export interface BrowserTabPayload {
  /** Stable id linking this tab to its main-process WebContentsView. */
  tabId: string
  initialUrl: string
  /** Non-persistent browsing session for this tab. */
  isPrivate?: boolean
}

export interface ChatTabPayload {
  courseId: string
  /**
   * Conversation id (renderer-minted uuid, becomes agent_sessions.id on the
   * first send). OPTIONAL for legacy persisted layouts/favorites: a payload
   * without one is normalized by ChatTab to the course's newest conversation
   * (or a fresh uuid) on mount.
   */
  conversationId?: string
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
/**
 * [M14] A personal whiteboard — the student's own canvas for organising ideas
 * or sketching a mind map. Local only: it never leaves the machine, so it
 * needs no account and works offline.
 *
 * A course can hold several, unlike the group board which is one per group.
 */
export interface WhiteboardTabPayload {
  courseId: string
  boardId: string
}

export interface GroupChatTabPayload {
  courseId: string | null
  /** Initially selected group; the panel switches among the course's groups. */
  groupId?: string
  /**
   * [M14] Which surface to show. 함께하기 is ONE tab per course that switches
   * between talking and drawing — a second tab per group is exactly the
   * proliferation the single-tab rule exists to prevent.
   */
  view?: 'chat' | 'whiteboard'
}

export interface TabPayloadMap {
  pdf: PdfTabPayload
  note: NoteTabPayload
  browser: BrowserTabPayload
  chat: ChatTabPayload
  board: BoardTabPayload
  'group-chat': GroupChatTabPayload
  whiteboard: WhiteboardTabPayload
  image: ImageTabPayload
  file: FileTabPayload
  'plugin-panel': PluginPanelTabPayload
}

/**
 * Generic in-app viewer for formats without a dedicated tab (docx, xlsx, csv,
 * plain text, …). The FileTab component routes by extension; unsupported
 * extensions never get a descriptor — openMaterial falls back to Finder.
 */
export interface FileTabPayload {
  courseId: string
  relPath: string
}

/**
 * A panel contributed by an installed extension, rendered in a sandboxed
 * `<webview>` on `bandal-plugin://<pluginId>/ui/…`. Survives layout restore
 * even when the plugin is gone — the tab then shows a placeholder.
 */
export interface PluginPanelTabPayload {
  pluginId: string
  panelId: string
}

/** Discriminated tab descriptor: { kind, payload } pairs, serializable. */
export type TabDescriptor = {
  [K in TabKind]: { kind: K; payload: TabPayloadMap[K] }
}[TabKind]

// -- structural validation -----------------------------------------------
//
// Lives here rather than in the renderer because BOTH processes validate
// descriptors: the renderer when rehydrating a dockview layout, and main
// when storing a favorite. Keeping it renderer-side forced main to import
// across the project boundary (TS6307), which is exactly the kind of
// main→renderer dependency the tsconfig split exists to prevent.

/**
 * Runtime witness for `TabKind`. It has to be exhaustive, and a hand-kept copy
 * is not: `image` was added to the union and forgotten here, so `isTabKind`
 * rejected every image descriptor and the tab silently refused to open. The
 * same drift already cost us IPC channels and drawing kinds — the assignment
 * below stops compiling when a kind is missing.
 */
export const TAB_KINDS = [
  'pdf',
  'note',
  'browser',
  'chat',
  'board',
  'group-chat',
  'whiteboard',
  'image',
  'file',
  'plugin-panel'
] as const satisfies readonly TabKind[]

type MissingTabKind = Exclude<TabKind, (typeof TAB_KINDS)[number]>
const _allTabKindsListed: MissingTabKind extends never ? true : never = true
void _allTabKindsListed

export function isTabKind(value: unknown): value is TabKind {
  return typeof value === 'string' && (TAB_KINDS as readonly string[]).includes(value)
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
        typeof payload['initialUrl'] === 'string' &&
        (payload['isPrivate'] === undefined || typeof payload['isPrivate'] === 'boolean')
      )
    case 'chat':
      return (
        isNonEmptyString(payload['courseId']) &&
        (payload['conversationId'] === undefined ||
          isNonEmptyString(payload['conversationId']))
      )
    case 'board':
      return true
    case 'whiteboard':
      return (
        isNonEmptyString(payload['courseId']) &&
        isNonEmptyString(payload['boardId'])
      )
    case 'image':
    case 'file':
      return (
        isNonEmptyString(payload['courseId']) &&
        isNonEmptyString(payload['relPath'])
      )
    case 'plugin-panel':
      return (
        isNonEmptyString(payload['pluginId']) &&
        isNonEmptyString(payload['panelId'])
      )
    case 'group-chat': {
      const courseId = payload['courseId']
      if (courseId !== null && !isNonEmptyString(courseId)) return false
      const groupId = payload['groupId']
      if (groupId !== undefined && !isNonEmptyString(groupId)) return false
      const view = payload['view']
      return view === undefined || view === 'chat' || view === 'whiteboard'
    }
  }
}
