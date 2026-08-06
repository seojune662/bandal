/**
 * Push events: main → renderer, one-way, delivered via webContents.send and
 * subscribed through `window.bandal.on(channel, cb)`.
 */

import type { AgentEvent } from '../types/agent-events'
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
  'materials:changed': MaterialsChanged
  'browser:open-url': BrowserOpenUrl
  'settings:changed': SettingsChanged
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
}

export type PushChannel = keyof PushEvents
export type PushPayload<K extends PushChannel> = PushEvents[K]
