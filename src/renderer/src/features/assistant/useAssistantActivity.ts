import { useCallback, useEffect, useRef, useState } from 'react'
import { onPush } from '../../lib/ipc'
import {
  recordAgentConfirmation,
  useAgentToolActivityStore
} from '../chat/agentToolActivityStore'
import { useChatSessionStore } from '../chat/chatSessionStore'

export interface AssistantActivityOptions {
  courseId: string | null
  popupOpen: boolean
  observeRoot?: string
}

export interface AssistantActivity {
  busy: boolean
  alert: boolean
  needsApproval: boolean
  clearAlert: () => void
}

export function useAssistantActivity({
  courseId,
  popupOpen,
  observeRoot
}: AssistantActivityOptions): AssistantActivity {
  const popupOpenRef = useRef(popupOpen)
  const answerWhileClosedRef = useRef(false)
  const pendingPermissionSessionsRef = useRef(new Map<string, string>())
  const storeObservedPermissionSessionsRef = useRef(new Set<string>())
  const [eventBusy, setEventBusy] = useState(false)
  const [surfaceBusy, setSurfaceBusy] = useState(false)
  const [alert, setAlert] = useState(false)
  const [needsV1Approval, setNeedsV1Approval] = useState(false)
  const [needsV2Approval, setNeedsV2Approval] = useState(false)
  popupOpenRef.current = popupOpen

  useEffect(() => {
    if (popupOpen) setAlert(false)
  }, [popupOpen])

  useEffect(() => {
    setEventBusy(false)
    setAlert(false)
    setNeedsV1Approval(false)
    pendingPermissionSessionsRef.current.clear()
    storeObservedPermissionSessionsRef.current.clear()
    answerWhileClosedRef.current = false
    if (courseId === null) return

    const updateFromStore = (): void => {
      let approvalStateChanged = false
      for (const [sessionId, requestId] of
        pendingPermissionSessionsRef.current) {
        const pendingPermissionId =
          useChatSessionStore.getState().sessions[sessionId]?.state
            .pendingPermissionId
        if (pendingPermissionId === requestId) {
          storeObservedPermissionSessionsRef.current.add(sessionId)
        } else if (
          storeObservedPermissionSessionsRef.current.delete(sessionId)
        ) {
          pendingPermissionSessionsRef.current.delete(sessionId)
          approvalStateChanged = true
        }
      }
      if (approvalStateChanged) {
        setNeedsV1Approval(pendingPermissionSessionsRef.current.size > 0)
      }
    }
    const unsubscribeStore = useChatSessionStore.subscribe(updateFromStore)
    const unsubscribeEvents = onPush('chat:event-batch', (batch) => {
      if (batch.courseId !== courseId) return
      let startsActivity = false
      let endsActivity = false
      let containsAnswer = false
      let approvalStateChanged = false

      for (const event of batch.events) {
        if (
          event.type === 'text-delta' ||
          event.type === 'text-final' ||
          event.type === 'thinking-delta' ||
          event.type === 'tool-start' ||
          event.type === 'permission-request'
        ) {
          startsActivity = true
        }
        if (event.type === 'permission-request') {
          const previousRequest =
            pendingPermissionSessionsRef.current.get(batch.sessionId)
          pendingPermissionSessionsRef.current.set(
            batch.sessionId,
            event.requestId
          )
          if (previousRequest !== event.requestId) {
            storeObservedPermissionSessionsRef.current.delete(batch.sessionId)
          }
          approvalStateChanged =
            approvalStateChanged ||
            previousRequest !== event.requestId
        }
        if (event.type === 'text-delta' || event.type === 'text-final') {
          containsAnswer = true
        }
        if (
          event.type === 'turn-complete' ||
          (event.type === 'error' && event.fatal)
        ) {
          endsActivity = true
          approvalStateChanged =
            pendingPermissionSessionsRef.current.delete(batch.sessionId) ||
            approvalStateChanged
          storeObservedPermissionSessionsRef.current.delete(batch.sessionId)
        }
      }

      if (startsActivity) setEventBusy(true)
      if (approvalStateChanged) {
        setNeedsV1Approval(pendingPermissionSessionsRef.current.size > 0)
      }
      if (containsAnswer && !popupOpenRef.current) {
        answerWhileClosedRef.current = true
      }
      if (endsActivity) {
        setEventBusy(false)
        if (answerWhileClosedRef.current && !popupOpenRef.current) {
          setAlert(true)
        }
        answerWhileClosedRef.current = false
      }
    })
    updateFromStore()
    return () => {
      unsubscribeEvents()
      unsubscribeStore()
    }
  }, [courseId])

  useEffect(() => {
    setNeedsV2Approval(false)
    if (courseId === null) return

    const updateFromStore = (): void => {
      const hasPending = Object.values(
        useAgentToolActivityStore.getState().conversations
      ).some((snapshot) =>
        snapshot.items.some(
          (item) =>
            item.kind === 'confirmation' &&
            item.request.courseId === courseId &&
            item.response === null
        )
      )
      setNeedsV2Approval(hasPending)
    }
    const unsubscribeStore = useAgentToolActivityStore.subscribe(
      updateFromStore
    )
    const unsubscribeConfirm = onPush('agentTools:confirm', (request) => {
      if (request.courseId !== courseId) return
      recordAgentConfirmation(request)
    })
    updateFromStore()
    return () => {
      unsubscribeConfirm()
      unsubscribeStore()
    }
  }, [courseId])

  useEffect(() => {
    setSurfaceBusy(false)
    if (observeRoot === undefined) return

    const root = document.querySelector(observeRoot)
    if (root === null) return
    const update = (): void => {
      setSurfaceBusy(
        root.querySelector('[data-streaming]:not([data-streaming="false"])') !==
          null
      )
    }
    const observer = new MutationObserver(update)
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-streaming']
    })
    update()
    return () => observer.disconnect()
  }, [courseId, observeRoot])

  const clearAlert = useCallback((): void => setAlert(false), [])
  return {
    busy: eventBusy || surfaceBusy,
    alert,
    needsApproval: needsV1Approval || needsV2Approval,
    clearAlert
  }
}
