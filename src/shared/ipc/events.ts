/**
 * Push events: main → renderer, one-way, delivered via webContents.send and
 * subscribed through `window.bandal.on(channel, cb)`.
 */

import type { AgentEvent } from '../types/agent-events'
import type { AgentConfirmRequest } from '../types/agentTools'
import type { Settings } from '../types/settings'
import type { AuthState } from '../types/auth'
import type { GroupsInvalidationReason } from '../types/group'
import type { GroupEvent } from '../types/group-events'
import type { UpdateStatus } from '../types/update'

/** Ordered batch of streaming agent events for ONE conversation. */
export interface ChatEventBatch {
  /** Kept alongside sessionId — AssistantLayer filters on the course. */
  courseId: string
  /** Conversation id (agent_sessions.id) this batch belongs to. */
  sessionId: string
  /** Monotonic per-conversation sequence number for ordering / gap detection. */
  seq: number
  events: AgentEvent[]
}

/**
 * Progress lines from a provider CLI installer (`agent:install`). `done`
 * marks the terminal frame; `ok` is only meaningful once done is true.
 */
export interface AgentInstallProgress {
  provider: string
  line: string
  done: boolean
  ok: boolean
}

/**
 * [M13] A shape someone else drew on the group whiteboard, or a removal.
 * The payload carries the whole shape so the receiver draws it without a
 * follow-up query.
 */
export interface WhiteboardChanged {
  groupId: string
  event: unknown
}

/** Fired when the course folder changed on disk (watcher). */
export interface MaterialsChanged {
  courseId: string
}

/**
 * [M3-F] A browser guest asked for a new window (window.open / target=_blank).
 * Main denies the native window and forwards the URL here; the renderer opens
 * it as a new Bandal browser tab.
 */
export interface BrowserOpenUrl {
  url: string
}

/** Fired after settings change from any window. */
export interface SettingsChanged {
  settings: Settings
}

/**
 * [M6-A] A browser guest swallowed a workspace shortcut (⌘T / ⌘W). Main
 * intercepts it via `before-input-event` and forwards it here so the
 * shortcuts hook can run the same action as a host-window keydown.
 */
/**
 * The glass box: what the agent is doing in a tab, right now.
 *
 * Pushed on every step so the student can watch a real page move, and stop it.
 */
export interface BrowserAgentRunState {
  runId: string
  courseId: string
  tabId: string
  status: 'running' | 'waiting' | 'stopped' | 'done'
  /** One short line, in the student's language. */
  action: string
  url: string
}

/** One browser download's lifecycle, throttled while progressing. */
export interface BrowserDownloadUpdate {
  id: string
  webContentsId: number | null
  fileName: string
  receivedBytes: number
  /** 0 when the server sends no Content-Length. */
  totalBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  /** Course-relative path, once the file is in the course folder. */
  relPath: string | null
  courseId: string | null
  /** The transfer worked but filing it did not. */
  failureReason: string | null
}

export interface ShortcutPassthrough {
  action:
    | 'new-tab'
    | 'close-tab'
    | 'activate-last-tab'
    | 'reload'
    | 'reload-hard'
    | 'focus-address'
    | 'find'
    | 'bookmark'
    | 'reopen-tab'
    | 'prev-tab'
    | 'next-tab'
    | 'zoom-in'
    | 'zoom-out'
    | 'zoom-reset'
  /**
   * The guest that swallowed the chord, so the renderer can act on ITS tab.
   * Guests live in a fixed layer outside the dockview panel DOM and focusing
   * one does not make its panel active, so without this ⌘W in a split closes
   * whichever tab dockview happens to consider active — not the one the
   * student is typing into.
   */
  webContentsId: number
}

/**
 * [P2-C / C8] Ordered batch of group-chat events for ONE group.
 *
 * Structurally identical to ChatEventBatch on purpose: the renderer reuses
 * the same seq-gap → rehydrate strategy (§4.3).
 */
export interface GroupEventBatch {
  groupId: string
  /** Monotonic per-group sequence number for ordering / gap detection. */
  seq: number
  events: GroupEvent[]
}

/**
 * [P2-C] Something changed that invalidates a cached list in the renderer
 * (membership, pending invites, unread badges, profiles). Carries no payload
 * by design — the renderer refetches the affected slice, which keeps the
 * local cache the single projection of truth.
 */
export interface GroupsInvalidated {
  reason: GroupsInvalidationReason
}

export interface PushEvents {
  'chat:event-batch': ChatEventBatch
  /** A course was created, renamed, archived or removed. */
  'courses:changed': { }
  /** Board tasks changed outside the board panel. */
  'board:changed': { courseId: string }
  /** A personal whiteboard or its shapes changed. */
  'canvas:changed': { courseId: string }
  /** A destructive assistant tool is waiting for the student. */
  'agentTools:confirm': AgentConfirmRequest
  /** One request finished changing things; show the change list. */
  'agentTools:changed': { courseId: string; turnId: string }
  'materials:changed': MaterialsChanged
  'browser:open-url': BrowserOpenUrl
  /**
   * A guest tried to reach a login origin Google blocks inside embedded
   * webviews; main opened it in the system browser — show the user why.
   */
  'browser:external-auth': BrowserOpenUrl
  'settings:changed': SettingsChanged
  /** Open the in-app settings overlay (app menu ⌘, or legacy callers). */
  'ui:openSettings': { }
  'browser:download': BrowserDownloadUpdate
  'browserAgent:run-state': BrowserAgentRunState
  'shortcut:passthrough': ShortcutPassthrough
  // -- groups (P2-C) --------------------------------------------------------
  'auth:changed': AuthState
  'group:event-batch': GroupEventBatch
  'groups:invalidated': GroupsInvalidated
  // -- auto update ----------------------------------------------------------
  /**
   * Every auto-update state transition, including ones the renderer never
   * asked for (the periodic background check). Broadcast to all windows so the
   * workspace toast and the Settings panel cannot disagree.
   */
  'update:changed': UpdateStatus
  // -- agent setup ----------------------------------------------------------
  'agent:install-progress': AgentInstallProgress
  // -- group whiteboard -----------------------------------------------------
  'whiteboard:changed': WhiteboardChanged
}

export type PushChannel = keyof PushEvents
export type PushPayload<K extends PushChannel> = PushEvents[K]
