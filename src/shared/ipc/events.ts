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

/** Ordered batch of streaming agent events for a course chat. */
export interface ChatEventBatch {
  courseId: string
  /** Monotonic per-course sequence number for ordering / gap detection. */
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
export interface ShortcutPassthrough {
  action: 'new-tab' | 'close-tab'
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
  'settings:changed': SettingsChanged
  /** Open the in-app settings overlay (app menu ⌘, or legacy callers). */
  'ui:openSettings': { }
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
