/**
 * Renderer-side chat session hook: opens the course chat, subscribes to
 * `chat:event-batch` (filtered by courseId), folds batches through the pure
 * reducer inside requestAnimationFrame + startTransition, detects seq gaps
 * (→ rehydrate via chat:open), and echoes the user's own messages locally.
 */

import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentAvailability,
  AgentEvent,
  PermissionResponse
} from '../../../../shared/types/agent-events'
import { invoke, onPush } from '../../lib/ipc'
import {
  appendLocalUserMessage,
  applyAgentEvents,
  applyLocalPermissionResponse,
  checkBatchSeq,
  clearNotice,
  hydrateFromHistory,
  initialChatViewState,
  markSendFailed,
  type ChatViewState
} from './chatModel'

export type ChatPhase = 'loading' | 'ready' | 'error'

export interface ChatSessionApi {
  state: ChatViewState
  phase: ChatPhase
  availability: AgentAvailability | null
  openError: string | null
  send: (content: string) => void
  cancel: () => void
  respondPermission: (requestId: string, response: PermissionResponse) => void
  /** Re-runs chat:open — availability 재확인 and history refresh. */
  refresh: () => void
  dismissNotice: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '채팅을 여는 중 문제가 발생했습니다.'
}

export function useChatSession(courseId: string): ChatSessionApi {
  const [state, setState] = useState<ChatViewState>(initialChatViewState)
  const [phase, setPhase] = useState<ChatPhase>('loading')
  const [availability, setAvailability] = useState<AgentAvailability | null>(
    null
  )
  const [openError, setOpenError] = useState<string | null>(null)

  const lastSeqRef = useRef<number | null>(null)
  const queueRef = useRef<AgentEvent[]>([])
  const rafRef = useRef<number | null>(null)
  const hydratingRef = useRef(false)
  const aliveRef = useRef(true)

  const flushQueue = useCallback(() => {
    rafRef.current = null
    if (hydratingRef.current || queueRef.current.length === 0) {
      return
    }
    const events = queueRef.current
    queueRef.current = []
    startTransition(() => {
      setState((current) => applyAgentEvents(current, events))
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) {
      return
    }
    rafRef.current = requestAnimationFrame(flushQueue)
  }, [flushQueue])

  const open = useCallback(
    async (opts: { discardQueue: boolean }): Promise<void> => {
      hydratingRef.current = true
      if (opts.discardQueue) {
        queueRef.current = []
      }
      try {
        const result = await invoke('chat:open', { courseId })
        if (!aliveRef.current) {
          return
        }
        setAvailability(result.availability)
        setOpenError(null)
        setState(
          hydrateFromHistory(
            result.history,
            result.sessionInfo?.model ?? null
          )
        )
        setPhase('ready')
      } catch (error) {
        if (!aliveRef.current) {
          return
        }
        setOpenError(errorMessage(error))
        setPhase('error')
      } finally {
        hydratingRef.current = false
        if (aliveRef.current) {
          scheduleFlush()
        }
      }
    },
    [courseId, scheduleFlush]
  )

  useEffect(() => {
    aliveRef.current = true
    lastSeqRef.current = null
    queueRef.current = []
    setState(initialChatViewState)
    setPhase('loading')

    void open({ discardQueue: false })

    const unsubscribe = onPush('chat:event-batch', (batch) => {
      if (batch.courseId !== courseId) {
        return
      }
      const check = checkBatchSeq(lastSeqRef.current, batch.seq)
      if (check === 'stale') {
        return
      }
      lastSeqRef.current = batch.seq
      if (check === 'gap') {
        // Missed a frame — the committed history is the source of truth.
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
    }
  }, [courseId, open, scheduleFlush])

  const send = useCallback(
    (content: string) => {
      const text = content.trim()
      if (text === '') {
        return
      }
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setState((current) => appendLocalUserMessage(current, localId, text))
      invoke('chat:send', { courseId, content: text }).catch(() => {
        // The fatal error event arrives via the stream; this is the fallback
        // for failures before the stream produced anything.
        if (aliveRef.current) {
          setState((current) => markSendFailed(current))
        }
      })
    },
    [courseId]
  )

  const cancel = useCallback(() => {
    void invoke('chat:cancel', { courseId }).catch(() => {
      // Cancel is best-effort; turn-complete(interrupted) confirms it.
    })
  }, [courseId])

  const respondPermission = useCallback(
    (requestId: string, response: PermissionResponse) => {
      setState((current) =>
        applyLocalPermissionResponse(current, requestId, response.behavior)
      )
      void invoke('chat:respondPermission', {
        courseId,
        requestId,
        response
      }).catch(() => {
        // The CLI treats a dropped response as still-pending; the stream will
        // surface the outcome either way.
      })
    },
    [courseId]
  )

  const refresh = useCallback(() => {
    void open({ discardQueue: false })
  }, [open])

  const dismissNotice = useCallback(() => {
    setState((current) => clearNotice(current))
  }, [])

  return {
    state,
    phase,
    availability,
    openError,
    send,
    cancel,
    respondPermission,
    refresh,
    dismissNotice
  }
}
