/**
 * Realtime channel lifecycle — the sibling of `SessionManager`
 * (docs/phase2-community.md §4.5).
 *
 * A Supabase channel has the same awkward lifetime properties as the Claude
 * CLI processes SessionManager already herds: expensive to hold, cheap to
 * recreate, invisible when leaked, and fatal to a free-tier quota in bulk. So
 * the rules are copied verbatim:
 *
 *  - subscribe ONLY while a `group-chat` tab is open
 *  - closing the tab is a SOFT close: a 2-minute grace period, because
 *    "close then immediately reopen" is the single most common interaction
 *  - hard cap of 5 concurrent channels, LRU eviction — the free tier allows
 *    200 concurrent connections *in total*, and that budget is per app
 *    instance multiplied by every user
 *  - window blurred for 5 minutes → unsubscribe everything (battery, and hand
 *    the connection slot back); resubscribe + catch up on focus
 *  - `before-quit` → dispose()
 *
 * ⚠ `realtime.setAuth()` must have been called before subscribing, or a
 * private channel silently delivers nothing (supabase/README.md §5.3). The
 * owning GroupService does that on every auth change.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type {
  GroupConnectionState,
  GroupMessage
} from '../../../shared/types/group'
import type { GroupEvent } from '../../../shared/types/group-events'

export const SOFT_CLOSE_MS = 2 * 60 * 1000
export const MAX_LIVE_CHANNELS = 5
export const BLUR_UNSUBSCRIBE_MS = 5 * 60 * 1000
/** Fallback cadence once the socket is considered unhealthy (§6.3). */
export const DEGRADED_POLL_MS = 15_000

export interface GroupRealtimeDeps {
  /** null while unconfigured / signed-out → every method becomes a no-op. */
  getClient: () => SupabaseClient | null
  getUserId: () => string | null
  emit: (groupId: string, event: GroupEvent) => void
  /** Fetch `seq > afterSeq` — used on (re)subscribe and by degraded polling. */
  catchUp: (groupId: string, afterSeq: number) => Promise<void>
  localMaxSeq: (groupId: string) => number
  /** Drain the outbox first, then catch up (§4.4 ordering rule). */
  drainOutbox: () => Promise<void>
  softCloseMs?: number
  maxChannels?: number
  blurUnsubscribeMs?: number
  degradedPollMs?: number
}

export interface GroupRealtimeManager {
  /** Idempotent. Returns once the subscription attempt has been kicked off. */
  open(groupId: string): Promise<void>
  /** Soft close — the channel survives `softCloseMs` in case of a reopen. */
  close(groupId: string): void
  connectionState(groupId: string): GroupConnectionState
  /** Window focus/blur from the main window. */
  setWindowFocused(focused: boolean): void
  /** Auth changed → every channel must be rebuilt with the new JWT. */
  resetAll(): void
  /** Close every channel without permanently disposing the manager. */
  closeAll(): void
  disposeAll(): void
}

interface ChannelEntry {
  groupId: string
  channel: RealtimeChannel | null
  subscribing: boolean
  connection: GroupConnectionState
  /** Set while the tab is closed but the grace period has not elapsed. */
  softCloseTimer: NodeJS.Timeout | null
  pollTimer: NodeJS.Timeout | null
  lastUsedAt: number
  /** True while a `group-chat` tab is actually open for this group. */
  tabOpen: boolean
}

/** Shape of the `msg` broadcast payload (see 0008_realtime_broadcast.sql). */
function asGroupMessage(payload: unknown): GroupMessage | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const id = record['id']
  const groupId = record['groupId']
  const seq = record['seq']
  if (typeof id !== 'string' || typeof groupId !== 'string') return null
  if (typeof seq !== 'number') return null
  const author =
    typeof record['author'] === 'object' && record['author'] !== null
      ? (record['author'] as Record<string, unknown>)
      : {}
  return {
    id,
    groupId,
    seq,
    authorId: typeof record['authorId'] === 'string' ? record['authorId'] : '',
    kind: record['kind'] === 'system' ? 'system' : 'text',
    body: typeof record['body'] === 'string' ? record['body'] : null,
    replyTo: typeof record['replyTo'] === 'string' ? record['replyTo'] : null,
    createdAt:
      typeof record['createdAt'] === 'string'
        ? record['createdAt']
        : new Date().toISOString(),
    editedAt: typeof record['editedAt'] === 'string' ? record['editedAt'] : null,
    deleted: record['deleted'] === true,
    author: {
      nickname: typeof author['nickname'] === 'string' ? author['nickname'] : '',
      avatarColor:
        typeof author['avatarColor'] === 'string' ? author['avatarColor'] : 'moon',
      avatarEmoji:
        typeof author['avatarEmoji'] === 'string' ? author['avatarEmoji'] : '🌙'
    }
  }
}

interface MessageUpdatePayload {
  messageId: string
  body: string | null
  deleted: boolean
}

function asMessageUpdate(payload: unknown): MessageUpdatePayload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const messageId = record['messageId']
  if (typeof messageId !== 'string') return null
  return {
    messageId,
    body: typeof record['body'] === 'string' ? record['body'] : null,
    deleted: record['deleted'] === true
  }
}

export function createGroupRealtimeManager(
  deps: GroupRealtimeDeps
): GroupRealtimeManager {
  const softCloseMs = deps.softCloseMs ?? SOFT_CLOSE_MS
  const maxChannels = deps.maxChannels ?? MAX_LIVE_CHANNELS
  const blurMs = deps.blurUnsubscribeMs ?? BLUR_UNSUBSCRIBE_MS
  const pollMs = deps.degradedPollMs ?? DEGRADED_POLL_MS

  const entries = new Map<string, ChannelEntry>()
  let blurTimer: NodeJS.Timeout | null = null
  let suspended = false
  let disposed = false

  function entryFor(groupId: string): ChannelEntry {
    let entry = entries.get(groupId)
    if (entry === undefined) {
      entry = {
        groupId,
        channel: null,
        subscribing: false,
        connection: 'offline',
        softCloseTimer: null,
        pollTimer: null,
        lastUsedAt: Date.now(),
        tabOpen: false
      }
      entries.set(groupId, entry)
    }
    return entry
  }

  function setConnection(
    entry: ChannelEntry,
    state: GroupConnectionState
  ): void {
    if (entry.connection === state) return
    entry.connection = state
    deps.emit(entry.groupId, { type: 'connection', state })
  }

  function stopPolling(entry: ChannelEntry): void {
    if (entry.pollTimer !== null) {
      clearInterval(entry.pollTimer)
      entry.pollTimer = null
    }
  }

  /**
   * Degraded mode: the websocket is unusable, so fall back to a 15s poll
   * instead of pretending to be live. The banner is accent-muted, not danger —
   * the app still works, it is just slower (§6.3).
   */
  function startPolling(entry: ChannelEntry): void {
    if (entry.pollTimer !== null || disposed) return
    setConnection(entry, 'degraded-polling')
    const timer = setInterval(() => {
      void deps
        .catchUp(entry.groupId, deps.localMaxSeq(entry.groupId))
        .catch(() => {
          // Still offline; the next tick tries again.
        })
    }, pollMs)
    timer.unref?.()
    entry.pollTimer = timer
  }

  function teardown(entry: ChannelEntry): void {
    stopPolling(entry)
    if (entry.softCloseTimer !== null) {
      clearTimeout(entry.softCloseTimer)
      entry.softCloseTimer = null
    }
    const channel = entry.channel
    entry.channel = null
    entry.subscribing = false
    if (channel !== null) {
      const client = deps.getClient()
      try {
        void channel.unsubscribe()
        client?.removeChannel(channel)
      } catch (error) {
        console.error('[group] failed to unsubscribe channel', error)
      }
    }
    setConnection(entry, 'offline')
  }

  /** Evicts the least-recently-used channel once the cap is reached. */
  function evictLruIfNeeded(current: ChannelEntry): void {
    const live = [...entries.values()].filter(
      (entry) => entry.channel !== null && entry !== current
    )
    if (live.length < maxChannels) return
    live.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    // Prefer evicting a group whose tab is already closed.
    const victim = live.find((entry) => !entry.tabOpen) ?? live[0]
    if (victim !== undefined) teardown(victim)
  }

  async function subscribe(entry: ChannelEntry): Promise<void> {
    const client = deps.getClient()
    if (client === null || deps.getUserId() === null || suspended || disposed) {
      return
    }
    if (entry.channel !== null || entry.subscribing) return

    entry.subscribing = true
    evictLruIfNeeded(entry)
    setConnection(entry, 'reconnecting')

    const channel = client.channel(`group:${entry.groupId}`, {
      config: {
        private: true,
        presence: { key: deps.getUserId() ?? 'anonymous' }
      }
    })

    channel
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        const message = asGroupMessage(payload)
        if (message !== null) deps.emit(entry.groupId, { type: 'message', message })
      })
      .on('broadcast', { event: 'msg_update' }, ({ payload }) => {
        const update = asMessageUpdate(payload)
        if (update !== null) {
          deps.emit(entry.groupId, {
            type: 'message-updated',
            messageId: update.messageId,
            body: update.body,
            deleted: update.deleted
          })
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const online = Object.keys(state).map((userId) => ({ userId }))
        deps.emit(entry.groupId, { type: 'presence', online })
      })

    entry.channel = channel

    channel.subscribe((status) => {
      if (entry.channel !== channel) return
      entry.subscribing = false
      if (status === 'SUBSCRIBED') {
        stopPolling(entry)
        setConnection(entry, 'connected')
        const userId = deps.getUserId()
        if (userId !== null) {
          void channel.track({ user_id: userId }).catch(() => {
            // Presence is decorative; never let it break the channel.
          })
        }
        // ★ Outbox first, THEN catch-up — otherwise our own messages sort
        // after everyone else's and read as lost (§4.4).
        void deps
          .drainOutbox()
          .then(() => deps.catchUp(entry.groupId, deps.localMaxSeq(entry.groupId)))
          .catch((error: unknown) => {
            console.error('[group] catch-up after subscribe failed', error)
          })
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        startPolling(entry)
        return
      }
      if (status === 'CLOSED') {
        setConnection(entry, entry.tabOpen ? 'reconnecting' : 'offline')
      }
    })
    await Promise.resolve()
  }

  return {
    async open(groupId) {
      if (disposed) return
      const entry = entryFor(groupId)
      entry.tabOpen = true
      entry.lastUsedAt = Date.now()
      if (entry.softCloseTimer !== null) {
        // Reopened inside the grace period — the channel is still warm.
        clearTimeout(entry.softCloseTimer)
        entry.softCloseTimer = null
      }
      await subscribe(entry)
    },

    close(groupId) {
      const entry = entries.get(groupId)
      if (entry === undefined) return
      entry.tabOpen = false
      if (entry.softCloseTimer !== null) return
      const timer = setTimeout(() => {
        entry.softCloseTimer = null
        if (!entry.tabOpen) {
          teardown(entry)
          entries.delete(groupId)
        }
      }, softCloseMs)
      timer.unref?.()
      entry.softCloseTimer = timer
    },

    connectionState(groupId) {
      return entries.get(groupId)?.connection ?? 'offline'
    },

    setWindowFocused(focused) {
      if (disposed) return
      if (focused) {
        if (blurTimer !== null) {
          clearTimeout(blurTimer)
          blurTimer = null
        }
        if (!suspended) return
        suspended = false
        for (const entry of entries.values()) {
          if (entry.tabOpen) void subscribe(entry)
        }
        return
      }
      if (blurTimer !== null || suspended) return
      const timer = setTimeout(() => {
        blurTimer = null
        suspended = true
        // Give the connection slots back; the state stays so focus restores it.
        for (const entry of entries.values()) teardown(entry)
      }, blurMs)
      timer.unref?.()
      blurTimer = timer
    },

    resetAll() {
      const open = [...entries.values()].filter((entry) => entry.tabOpen)
      for (const entry of entries.values()) teardown(entry)
      if (disposed || suspended) return
      for (const entry of open) void subscribe(entry)
    },

    closeAll() {
      if (disposed) return
      for (const entry of entries.values()) teardown(entry)
    },

    disposeAll() {
      disposed = true
      if (blurTimer !== null) {
        clearTimeout(blurTimer)
        blurTimer = null
      }
      for (const entry of entries.values()) teardown(entry)
      entries.clear()
    }
  }
}
