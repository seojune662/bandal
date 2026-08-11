/**
 * Per-group batching of GroupEvents into `group:event-batch` frames.
 *
 * This REUSES `createEventBatcher` from the agent feature rather than
 * reimplementing it: the per-key monotonic seq (which the renderer's gap
 * detection depends on), the debounce/max-wait pair and the flush-on-dispose
 * behaviour are already correct there and tested in
 * tests/main/agent/eventBatcher.test.ts.
 *
 * Only the timings differ. Agent streaming coalesces token deltas, so 40/250ms
 * is right. Group chat has NO deltas — every event is already structural — so
 * a much shorter 16ms/100ms pair just merges the burst that arrives when a
 * catch-up fetch lands, without adding perceptible latency to a single message
 * (docs/phase2-community.md §7 P2-C).
 */

import type { AgentEvent } from '../../../shared/types/agent-events'
import type { GroupEventBatch } from '../../../shared/ipc/events'
import type { GroupEvent } from '../../../shared/types/group-events'
import { createEventBatcher } from '../agent'

export const GROUP_BATCH_DEBOUNCE_MS = 16
export const GROUP_BATCH_MAX_WAIT_MS = 100

export interface GroupEventBatcher {
  push(groupId: string, event: GroupEvent): void
  flush(groupId: string): void
  dispose(): void
}

export interface GroupEventBatcherDeps {
  send: (batch: GroupEventBatch) => void
  debounceMs?: number
  maxWaitMs?: number
}

/**
 * The shared batcher is typed against AgentEvent because that is what it was
 * built for; it treats the payload opaquely apart from the delta-merge check,
 * which no GroupEvent type can satisfy. These two casts are the entire cost of
 * not duplicating the module, and they are contained here.
 */
export function createGroupEventBatcher(
  deps: GroupEventBatcherDeps
): GroupEventBatcher {
  const inner = createEventBatcher({
    debounceMs: deps.debounceMs ?? GROUP_BATCH_DEBOUNCE_MS,
    maxWaitMs: deps.maxWaitMs ?? GROUP_BATCH_MAX_WAIT_MS,
    send: (batch) => {
      deps.send({
        groupId: batch.sessionId,
        seq: batch.seq,
        events: batch.events as unknown as GroupEvent[]
      })
    }
  })

  return {
    push: (groupId, event) => {
      // The shared batcher is conversation-keyed (courseId, sessionId); a
      // group has no such split, so the groupId serves as both.
      inner.push(groupId, groupId, event as unknown as AgentEvent)
    },
    flush: (groupId) => {
      inner.flush(groupId)
    },
    dispose: () => {
      inner.dispose()
    }
  }
}
