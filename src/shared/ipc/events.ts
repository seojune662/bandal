/**
 * Push events: main → renderer, one-way, delivered via webContents.send and
 * subscribed through `window.bandal.on(channel, cb)`.
 */

import type { AgentEvent } from '../types/agent-events'
import type { Settings } from '../types/settings'

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

export interface PushEvents {
  'chat:event-batch': ChatEventBatch
  'materials:changed': MaterialsChanged
  'browser:open-url': BrowserOpenUrl
  'settings:changed': SettingsChanged
  'shortcut:passthrough': ShortcutPassthrough
}

export type PushChannel = keyof PushEvents
export type PushPayload<K extends PushChannel> = PushEvents[K]
