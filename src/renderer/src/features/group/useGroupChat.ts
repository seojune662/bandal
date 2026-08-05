/**
 * Renderer-side group-chat session hook.
 *
 * Modelled directly on `features/chat/useChatSession.ts`, because the problem
 * is the same one: a high-frequency push stream folded into React state
 * without dropping frames or tearing.
 *
 *  - `groupChat:open` hydrates from the LOCAL cache → first paint costs zero
 *    network round trips (§4.3)
 *  - `group:event-batch` is filtered by groupId, checked for a seq gap, and
 *    queued
 *  - the queue drains inside `requestAnimationFrame` + `startTransition`, so a
 *    burst of catch-up messages never blocks typing
 *  - a seq gap means a frame was missed → rehydrate with `discardQueue`, the
 *    same recovery `useChatSession` uses
 *  - `markRead` is debounced and only ever moves forward
 */

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type { GroupMember, GroupSummary } from '../../../../shared/types/group'
import type { GroupEvent } from '../../../../shared/types/group-events'
import { invoke, onPush } from '../../lib/ipc'
import {
  applyGroupEvents,
  checkBatchSeq,
  hydrateGroupChat,
  initialGroupChatState,
  prependOlder,
  setMembers,
  tickCooldown,
  type GroupChatViewState
} from './groupModel'

export type GroupChatPhase = 'loading' | 'ready' | 'error' | 'unknown-group'

const MARK_READ_DEBOUNCE_MS = 800

export interface GroupChatApi {
  state: GroupChatViewState
  phase: GroupChatPhase
  group: GroupSummary | null
  myUserId: string | null
  openError: string | null
  isLoadingOlder: boolean
  hasMoreOlder: boolean
  send: (body: string) => void
  retry: (localId: string) => void
  loadOlder: () => void
  deleteMessage: (messageId: string) => void
  refreshMembers: () => void
  refresh: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '그룹 채팅을 여는 중 문제가 발생했습니다.'
}

export function useGroupChat(groupId: string): GroupChatApi {
  const [state, setState] = useState<GroupChatViewState>(initialGroupChatState)
  const [phase, setPhase] = useState<GroupChatPhase>('loading')
  const [group, setGroup] = useState<GroupSummary | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)

  const lastSeqRef = useRef<number | null>(null)
  const queueRef = useRef<GroupEvent[]>([])
  const rafRef = useRef<number | null>(null)
  const hydratingRef = useRef(false)
  const aliveRef = useRef(true)
  const markReadTimerRef = useRef<number | null>(null)
  const markedSeqRef = useRef(0)

  const flushQueue = useCallback(() => {
    rafRef.current = null
    if (hydratingRef.current || queueRef.current.length === 0) return
    const events = queueRef.current
    queueRef.current = []
    startTransition(() => {
      setState((current) => applyGroupEvents(current, events))
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(flushQueue)
  }, [flushQueue])

  const open = useCallback(
    async (opts: { discardQueue: boolean }): Promise<void> => {
      hydratingRef.current = true
      if (opts.discardQueue) queueRef.current = []
      try {
        const result = await invoke('groupChat:open', { groupId })
        if (!aliveRef.current) return
        setGroup(result.group)
        setMyUserId(result.myUserId)
        setOpenError(null)
        setState(
          hydrateGroupChat({
            messages: result.messages,
            members: result.members,
            pending: result.pending,
            connection: result.connection
          })
        )
        markedSeqRef.current = result.lastReadSeq
        // A stale tab pointing at a group we are no longer in resolves to
        // null: the panel drops itself rather than showing an empty room.
        setPhase(result.group === null ? 'unknown-group' : 'ready')
      } catch (error) {
        if (!aliveRef.current) return
        setOpenError(errorMessage(error))
        setPhase('error')
      } finally {
        hydratingRef.current = false
        if (aliveRef.current) scheduleFlush()
      }
    },
    [groupId, scheduleFlush]
  )

  useEffect(() => {
    aliveRef.current = true
    lastSeqRef.current = null
    queueRef.current = []
    setState(initialGroupChatState)
    setPhase('loading')
    setHasMoreOlder(true)

    void open({ discardQueue: false })

    const unsubscribe = onPush('group:event-batch', (batch) => {
      if (batch.groupId !== groupId) return
      const check = checkBatchSeq(lastSeqRef.current, batch.seq)
      if (check === 'stale') return
      lastSeqRef.current = batch.seq
      if (check === 'gap') {
        // Dropped a frame — the cache in main is the source of truth.
        void open({ discardQueue: true })
        return
      }
      queueRef.current.push(...batch.events)
      scheduleFlush()
    })

    return () => {
      aliveRef.current = false
      unsubscribe()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current)
        markReadTimerRef.current = null
      }
      void invoke('groupChat:close', { groupId }).catch(() => {
        // Closing is best effort: the manager's soft-close timer reaps it.
      })
    }
  }, [groupId, open, scheduleFlush])

  // Read receipts: debounced, monotonic, and never sent while hydrating.
  useEffect(() => {
    if (phase !== 'ready' || state.lastSeq <= markedSeqRef.current) return
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current)
    }
    const seq = state.lastSeq
    markReadTimerRef.current = window.setTimeout(() => {
      markReadTimerRef.current = null
      markedSeqRef.current = seq
      void invoke('groupChat:markRead', { groupId, seq }).catch(() => {
        // Convergent: the server takes greatest(), so a lost call self-heals.
      })
    }, MARK_READ_DEBOUNCE_MS)
  }, [groupId, phase, state.lastSeq])

  // Rate-limit countdown for the composer's "조금만 천천히 보내요" hint.
  useEffect(() => {
    if (state.sendCooldown <= 0) return
    const timer = window.setInterval(() => {
      setState((current) => tickCooldown(current))
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [state.sendCooldown])

  const send = useCallback(
    (body: string) => {
      const text = body.trim()
      if (text === '') return
      // The optimistic bubble arrives as a `local-echo` event from main, so
      // there is exactly ONE code path that creates pending messages.
      void invoke('groupChat:send', { groupId, body: text }).catch(
        (error: unknown) => {
          console.error('[Bandal] 메시지를 보내지 못했습니다.', error)
        }
      )
    },
    [groupId]
  )

  const retry = useCallback((localId: string) => {
    void invoke('groupChat:retry', { localId }).catch(() => {
      // The outbox re-emits an echo; nothing to do locally on failure.
    })
  }, [])

  const loadOlder = useCallback(() => {
    const oldest = state.messages[0]
    if (oldest === undefined || isLoadingOlder || !hasMoreOlder) return
    setIsLoadingOlder(true)
    void invoke('groupChat:loadOlder', { groupId, beforeSeq: oldest.seq })
      .then((older) => {
        if (!aliveRef.current) return
        if (older.length === 0) setHasMoreOlder(false)
        else setState((current) => prependOlder(current, older))
      })
      .catch((error: unknown) => {
        console.error('[Bandal] 이전 메시지를 불러오지 못했습니다.', error)
      })
      .finally(() => {
        if (aliveRef.current) setIsLoadingOlder(false)
      })
  }, [groupId, hasMoreOlder, isLoadingOlder, state.messages])

  const deleteMessage = useCallback((messageId: string) => {
    void invoke('groupChat:deleteMessage', { messageId }).catch(
      (error: unknown) => {
        console.error('[Bandal] 메시지를 삭제하지 못했습니다.', error)
      }
    )
  }, [])

  const refreshMembers = useCallback(() => {
    void invoke('groups:members', { groupId })
      .then((members: GroupMember[]) => {
        if (aliveRef.current) {
          setState((current) => setMembers(current, members))
        }
      })
      .catch(() => {
        // The cached member list stays on screen.
      })
  }, [groupId])

  const refresh = useCallback(() => {
    void open({ discardQueue: false })
  }, [open])

  return {
    state,
    phase,
    group,
    myUserId,
    openError,
    isLoadingOlder,
    hasMoreOlder,
    send,
    retry,
    loadOlder,
    deleteMessage,
    refreshMembers,
    refresh
  }
}
