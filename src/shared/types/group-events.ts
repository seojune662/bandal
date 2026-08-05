/**
 * [C8] The group-chat event union pushed main → renderer inside
 * `group:event-batch` (docs/phase2-community.md §4.8).
 *
 * Deliberately the same SHAPE of contract as AgentEvent: a discriminated
 * union folded by a pure reducer, delivered in ordered per-group batches with
 * a monotonic `seq` so the renderer can detect a dropped frame and rehydrate.
 */

import type {
  GroupConnectionState,
  GroupMember,
  GroupMessage
} from './group'

/** Someone currently subscribed to this group's realtime channel. */
export interface GroupPresenceEntry {
  userId: string
}

export type LocalEchoFailureReason = 'network' | 'rate-limit' | 'rejected'

export type GroupEvent =
  /** A committed message (from broadcast or from a catch-up fetch). */
  | { type: 'message'; message: GroupMessage }
  /** Edit or soft delete of an already-known message. */
  | {
      type: 'message-updated'
      messageId: string
      body: string | null
      deleted: boolean
    }
  /** Optimistic bubble: queued locally, no `seq` yet → always rendered last. */
  | {
      type: 'local-echo'
      localId: string
      body: string
      createdAt: string
    }
  /** The server accepted it; the echo is replaced by the real message id. */
  | {
      type: 'local-echo-settled'
      localId: string
      messageId: string
      seq: number
    }
  | {
      type: 'local-echo-failed'
      localId: string
      reason: LocalEchoFailureReason
      /** Seconds until a retry is allowed (rate-limit only). */
      retryAfter?: number
    }
  | { type: 'presence'; online: GroupPresenceEntry[] }
  | { type: 'member-joined'; member: GroupMember }
  | { type: 'member-left'; userId: string }
  | { type: 'connection'; state: GroupConnectionState }

export type GroupEventType = GroupEvent['type']
