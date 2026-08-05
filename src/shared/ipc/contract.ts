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
  Course,
  CreateCourseInput,
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
import type { ChatOpenResult, ChatSendInput } from '../types/chat'
import type {
  AgentAvailability,
  AgentProvider,
  PermissionResponse
} from '../types/agent-events'
import type { Settings, SettingsPatch } from '../types/settings'

export interface IpcContract {
  // -- courses --------------------------------------------------------------
  'courses:list': {
    req: { includeArchived?: boolean }
    res: Course[]
  }
  /** Creates the course row AND its folder under <dataRoot>/<slug>. */
  'courses:create': {
    req: CreateCourseInput
    res: Course
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

  // -- agent ----------------------------------------------------------------
  'agent:availability': {
    req: { provider: AgentProvider }
    res: AgentAvailability
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
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<K extends IpcChannel> = IpcContract[K]['req']
export type IpcResponse<K extends IpcChannel> = IpcContract[K]['res']
