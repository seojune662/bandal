import { useCallback, useEffect, useRef, useState } from 'react'
import { onPush } from '../../lib/ipc'

export interface AssistantActivityOptions {
  courseId: string | null
  popupOpen: boolean
  observeRoot?: string
}

export interface AssistantActivity {
  busy: boolean
  alert: boolean
  clearAlert: () => void
}

export function useAssistantActivity({
  courseId,
  popupOpen,
  observeRoot
}: AssistantActivityOptions): AssistantActivity {
  const popupOpenRef = useRef(popupOpen)
  const answerWhileClosedRef = useRef(false)
  const [eventBusy, setEventBusy] = useState(false)
  const [surfaceBusy, setSurfaceBusy] = useState(false)
  const [alert, setAlert] = useState(false)
  popupOpenRef.current = popupOpen

  useEffect(() => {
    if (popupOpen) setAlert(false)
  }, [popupOpen])

  useEffect(() => {
    setEventBusy(false)
    setAlert(false)
    answerWhileClosedRef.current = false
    if (courseId === null) return

    return onPush('chat:event-batch', (batch) => {
      if (batch.courseId !== courseId) return
      let startsActivity = false
      let endsActivity = false
      let containsAnswer = false

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
        if (event.type === 'text-delta' || event.type === 'text-final') {
          containsAnswer = true
        }
        if (
          event.type === 'turn-complete' ||
          (event.type === 'error' && event.fatal)
        ) {
          endsActivity = true
        }
      }

      if (startsActivity) setEventBusy(true)
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
  return { busy: eventBusy || surfaceBusy, alert, clearAlert }
}
