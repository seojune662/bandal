/**
 * [C1] The single source of truth for request/response IPC.
 *
 * Every invokable channel is declared here as `channel → { req; res }`.
 * Main registers a handler per channel (src/main/ipc/registerHandlers.ts),
 * the preload bridge and renderer client (src/renderer/src/lib/ipc.ts) are
 * typed against this interface. FROZEN for M1+ workstreams — extend, don't
 * mutate existing shapes.
 */

import type {
  AddCourseFromFolderInput,
  Course,
  CourseFolderResult,
  CreateCourseInput,
  PickedFolder,
  RelinkCourseInput,
  RenameCourseInput
} from '../types/course'
import type {
  ImportResult,
  MaterialFileContent,
  MaterialNode,
  MaterialSearchHit
} from '../types/materials'
import type {
  CreateNoteInput,
  NoteContent,
  NoteRef,
  WriteNoteInput
} from '../types/note'
import type {
  Annotation,
  CreateAnnotationInput,
  UpdateAnnotationInput
} from '../types/annotation'
import type {
  BoardTask,
  CreateTaskInput,
  ListTasksInput,
  UpdateTaskInput
} from '../types/board'
import type {
  CourseLink,
  CreateCourseLinkInput,
  UpdateCourseLinkInput
} from '../types/courseLink'
import type {
  AgentModelOption,
  ChatOpenResult,
  ChatSendInput
} from '../types/chat'
import type {
  CreateDrawingInput,
  Drawing,
  ExportAnnotatedPdfInput,
  ExportAnnotatedPdfResult,
  UpdateDrawingInput
} from '../types/drawing'
import type {
  AgentAvailability,
  AgentProvider,
  PermissionResponse
} from '../types/agent-events'
import type { Settings, SettingsPatch } from '../types/settings'
import type { UpdateStatus } from '../types/update'
import type {
  AuthProvider,
  AuthSignInResult,
  AuthState,
  MyProfile
} from '../types/auth'
import type {
  FriendEntry,
  GroupChatOpenResult,
  GroupCreateResult,
  GroupMember,
  GroupMessage,
  GroupSummary,
  InviteByNicknameResult,
  InviteCodeInfo,
  JoinGroupResult,
  PendingGroupInvite,
  ProfileLookupResult,
  ReportTargetType
} from '../types/group'

export interface IpcContract {
  // -- courses --------------------------------------------------------------
  'courses:list': {
    req: { includeArchived?: boolean }
    res: Course[]
  }
  /**
   * Creates the course row AND a managed folder under <dataRoot>/<slug>.
   * For an existing folder on disk use `courses:addFromFolder`.
   */
  'courses:create': {
    req: CreateCourseInput
    res: Course
  }
  /**
   * Opens the native folder picker (main process). Resolves to `null` when
   * the user cancels.
   */
  'courses:pickFolder': {
    req: Record<string, never>
    res: PickedFolder | null
  }
  /**
   * Registers an existing folder on disk as a course (source: 'linked').
   * Nothing on disk is created or moved.
   */
  'courses:addFromFolder': {
    req: AddCourseFromFolderInput
    res: CourseFolderResult
  }
  /** Points an existing course at another folder (연결 끊김 복구). */
  'courses:relink': {
    req: RelinkCourseInput
    res: CourseFolderResult
  }
  'courses:rename': {
    req: RenameCourseInput
    res: Course
  }
  'courses:archive': {
    req: { courseId: string; archived: boolean }
    res: Course
  }
  /** Soft-deletes the course; the folder on disk is left untouched. */
  'courses:delete': {
    req: { courseId: string }
    res: { ok: true }
  }

  // -- course links (M8: per-course LMS shortcuts) --------------------------
  /** Shortcuts pinned under one course, in sidebar order. */
  'courseLinks:list': {
    req: { courseId: string }
    res: CourseLink[]
  }
  /**
   * Stores a pasted URL as a shortcut. The renderer classifies it against the
   * school's CourseLinkSpec first; main re-validates that `url` is http(s).
   */
  'courseLinks:create': {
    req: CreateCourseLinkInput
    res: CourseLink
  }
  'courseLinks:update': {
    req: UpdateCourseLinkInput
    res: CourseLink
  }
  'courseLinks:delete': {
    req: { id: string }
    res: { ok: true }
  }

  // -- shell ----------------------------------------------------------------
  /**
   * [M8] Opens an http(s) URL in the system browser. Used for the services
   * that structurally cannot work inside the embedded browser — Google /
   * Microsoft federated login, UA-sniffing 학사 포털, native security plugins
   * (docs/university-sites.md §5.2). Any other scheme is rejected.
   */
  'shell:openExternal': {
    req: { url: string }
    res: { ok: true }
  }

  // -- materials ------------------------------------------------------------
  'materials:tree': {
    req: { courseId: string }
    res: MaterialNode[]
  }
  'materials:search': {
    req: { courseId: string; query: string }
    res: MaterialSearchHit[]
  }
  /** Copies absolute paths into the course folder. */
  'materials:import': {
    req: { courseId: string; paths: string[] }
    res: ImportResult
  }
  /** Reveals the file in Finder / file manager. */
  'materials:reveal': {
    req: { courseId: string; relPath: string }
    res: { ok: true }
  }
  /** Reads a material file; binary files come back base64-encoded. */
  'materials:readFile': {
    req: { courseId: string; relPath: string }
    res: MaterialFileContent
  }
  /**
   * [M5] Starts watching the course folder on disk. Changes are debounced and
   * pushed as `materials:changed { courseId }`. Idempotent per course.
   */
  'materials:watch': {
    req: { courseId: string }
    res: { ok: true }
  }
  'materials:unwatch': {
    req: { courseId: string }
    res: { ok: true }
  }

  // -- notes ----------------------------------------------------------------
  'notes:read': {
    req: NoteRef
    res: NoteContent
  }
  'notes:write': {
    req: WriteNoteInput
    res: { mtime: number }
  }
  'notes:create': {
    req: CreateNoteInput
    res: NoteRef
  }

  // -- annotations ----------------------------------------------------------
  'annotations:listForFile': {
    req: { courseId: string; relPath: string }
    res: Annotation[]
  }
  'annotations:create': {
    req: CreateAnnotationInput
    res: Annotation
  }
  'annotations:update': {
    req: UpdateAnnotationInput
    res: Annotation
  }
  'annotations:delete': {
    req: { id: string }
    res: { ok: true }
  }

  // -- board ----------------------------------------------------------------
  'board:listTasks': {
    req: ListTasksInput
    res: BoardTask[]
  }
  'board:createTask': {
    req: CreateTaskInput
    res: BoardTask
  }
  /** Handles content edits plus status / sort_order moves. */
  'board:updateTask': {
    req: UpdateTaskInput
    res: BoardTask
  }
  'board:deleteTask': {
    req: { id: string }
    res: { ok: true }
  }

  // -- chat -----------------------------------------------------------------
  /** Opens (or resumes) the chat for a course. */
  'chat:open': {
    req: { courseId: string }
    res: ChatOpenResult
  }
  /** Sends a user message; streaming arrives via `chat:event-batch`. */
  'chat:send': {
    req: ChatSendInput
    res: { turnSeq: number }
  }
  'chat:cancel': {
    req: { courseId: string }
    res: { ok: true }
  }
  'chat:respondPermission': {
    req: { courseId: string; requestId: string; response: PermissionResponse }
    res: { ok: true }
  }
  'chat:close': {
    req: { courseId: string }
    res: { ok: true }
  }
  /**
   * Pins the model for a course. Drops the warm CLI process so the next send
   * respawns with `--model`; history and the resumable CLI session id survive.
   */
  'chat:setModel': {
    req: { courseId: string; model: string }
    res: { ok: true }
  }

  // -- agent ----------------------------------------------------------------
  'agent:availability': {
    req: { provider: AgentProvider }
    res: AgentAvailability
  }
  /** Models the installed CLI reports. Cached in main for the process lifetime. */
  'agent:models': {
    req: { provider: AgentProvider }
    res: { models: AgentModelOption[] }
  }

  // -- pdf drawings (free-form markup: pen, shapes, text boxes) --------------
  'drawings:listForFile': {
    req: { courseId: string; relPath: string }
    res: Drawing[]
  }
  'drawings:create': {
    req: CreateDrawingInput
    res: Drawing
  }
  'drawings:update': {
    req: UpdateDrawingInput
    res: Drawing
  }
  'drawings:delete': {
    req: { ids: string[] }
    res: { ok: true }
  }
  /** Burns highlights + drawings into a NEW pdf; the original is never touched. */
  'pdf:exportAnnotated': {
    req: ExportAnnotatedPdfInput
    res: ExportAnnotatedPdfResult
  }

  // -- settings -------------------------------------------------------------
  'settings:get': {
    req: Record<string, never>
    res: Settings
  }
  'settings:set': {
    req: SettingsPatch
    res: Settings
  }

  // -- layout (dockview persistence per course) -----------------------------
  'layout:get': {
    req: { courseId: string }
    res: { layout: unknown | null }
  }
  'layout:save': {
    req: { courseId: string; layout: unknown }
    res: { ok: true }
  }

  // == Phase 2 (P2-C) — auth / groups / group chat / safety =================
  // ADDITIVE ONLY. Everything above is Phase 1 and must keep working with
  // `phase: 'unconfigured'` or 'signed-out' (docs/phase2-community.md §1.4).
  // Every handler below is served by the LAZILY constructed GroupService —
  // nothing here runs on the boot path.

  // -- auth -----------------------------------------------------------------
  /** Projected auth state. Never contains a token or an e-mail address. */
  'auth:getState': {
    req: Record<string, never>
    res: AuthState
  }
  /**
   * Opens the system browser and returns immediately (§1.1). `{ ok: true }`
   * means the browser opened, NOT that the user is signed in — the session
   * arrives later over `auth:changed`, once `bandal://auth/callback` comes
   * back. Refusals are typed values, never thrown errors.
   */
  'auth:signIn': {
    req: { provider: AuthProvider }
    res: AuthSignInResult
  }
  'auth:signOut': {
    req: Record<string, never>
    res: { ok: true }
  }
  /** Globally unique, 2–16 chars of `[가-힣a-zA-Z0-9_]` (§2.1). */
  'auth:setNickname': {
    req: { nickname: string }
    res: MyProfile
  }
  'auth:setAvatar': {
    req: { color?: string; emoji?: string }
    res: MyProfile
  }

  // -- groups ---------------------------------------------------------------
  // Local-cache-first: these succeed offline, serving `course_group_links`
  // and friends, then reconcile in the background (§3.1).
  'groups:list': {
    req: Record<string, never>
    res: GroupSummary[]
  }
  /**
   * §5.1 one-step creation: no dialog. `name`/`color` default to the course's
   * on the renderer side; the invite code comes back in the same round trip so
   * it can be copied to the clipboard immediately.
   */
  'groups:create': {
    req: { name: string; color: string; courseId?: string }
    res: GroupCreateResult
  }
  /**
   * ⚠ Returns `{ ok: false }` for rejections — it does NOT throw
   * (supabase/README.md §8-②). Check `ok`, not try/catch.
   */
  'groups:joinWithCode': {
    req: { code: string }
    res: JoinGroupResult
  }
  /** Admin-only. `null` when the live code expired → offer regeneration. */
  'groups:currentCode': {
    req: { groupId: string }
    res: InviteCodeInfo | null
  }
  'groups:regenerateCode': {
    req: { groupId: string; maxUses?: number }
    res: InviteCodeInfo
  }
  /** Pins (or unpins, with `courseId: null`) a group under a local course. */
  'groups:linkCourse': {
    req: { groupId: string; courseId: string | null }
    res: GroupSummary
  }
  'groups:leave': {
    req: { groupId: string }
    res: { ok: true }
  }
  'groups:members': {
    req: { groupId: string }
    res: GroupMember[]
  }
  'groups:kick': {
    req: { groupId: string; userId: string }
    res: { ok: true }
  }

  // -- invites / friends ----------------------------------------------------
  /** Any member may invite — narrowing this to admins would kill §5.3. */
  'groups:inviteByNickname': {
    req: { groupId: string; nickname: string }
    res: InviteByNicknameResult
  }
  /** Exact-match only; prefix autocomplete is served from the local cache. */
  'groups:findProfile': {
    req: { nickname: string }
    res: ProfileLookupResult | null
  }
  'invites:listPending': {
    req: Record<string, never>
    res: PendingGroupInvite[]
  }
  'invites:respond': {
    req: { inviteId: string; accept: boolean }
    res: { status: 'accepted' | 'declined' }
  }
  'friends:list': {
    req: Record<string, never>
    res: FriendEntry[]
  }
  'friends:request': {
    req: { nickname: string }
    res: { status: 'pending' | 'accepted'; userId: string }
  }
  'friends:respond': {
    req: { requesterId: string; accept: boolean }
    res: { status: 'accepted' | 'declined' }
  }

  // -- group chat -----------------------------------------------------------
  /**
   * Hydrates from the SQLite mirror (network 0), subscribes the realtime
   * channel, then reconciles in the background via `group:event-batch`.
   */
  'groupChat:open': {
    req: { groupId: string }
    res: GroupChatOpenResult
  }
  /** Enqueues into the outbox and echoes locally; returns the outbox id. */
  'groupChat:send': {
    req: { groupId: string; body: string; replyTo?: string }
    res: { localId: string }
  }
  /** Keyset pagination — `seq < beforeSeq`, newest-first window (§4.3). */
  'groupChat:loadOlder': {
    req: { groupId: string; beforeSeq: number; limit?: number }
    res: GroupMessage[]
  }
  'groupChat:markRead': {
    req: { groupId: string; seq: number }
    res: { ok: true }
  }
  /** Re-arms a `failed` outbox row (the 빨간 느낌표 retry). */
  'groupChat:retry': {
    req: { localId: string }
    res: { ok: true }
  }
  /** Author or group admin; soft delete via the `delete_message()` RPC. */
  'groupChat:deleteMessage': {
    req: { messageId: string }
    res: { ok: true }
  }
  'groupChat:close': {
    req: { groupId: string }
    res: { ok: true }
  }

  // -- safety ---------------------------------------------------------------
  /** `blocked: false` unblocks. Blocking is never revealed to the blockee. */
  'safety:block': {
    req: { userId: string; blocked: boolean }
    res: { ok: true }
  }
  /** Accepted and stored; there is no moderation queue in P2 (§6.4). */
  'safety:report': {
    req: { targetType: ReportTargetType; targetId: string; reason: string }
    res: { ok: true }
  }

  // -- auto update ----------------------------------------------------------
  /** Current state, for a freshly mounted UI. Never triggers a network call. */
  'update:status': {
    req: Record<string, never>
    res: UpdateStatus
  }
  /**
   * Explicit "check for updates" from Settings → About. Resolves once the
   * check settles; progress also arrives on the `update:changed` push channel.
   */
  'update:check': {
    req: Record<string, never>
    res: UpdateStatus
  }
  /** Starts the download. No-op unless the phase is `available` or `error`. */
  'update:download': {
    req: Record<string, never>
    res: UpdateStatus
  }
  /**
   * Quits and installs a staged update. Returns only if the install could not
   * start — on success the process is already gone.
   */
  'update:install': {
    req: Record<string, never>
    res: { ok: boolean }
  }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<K extends IpcChannel> = IpcContract[K]['req']
export type IpcResponse<K extends IpcChannel> = IpcContract[K]['res']
