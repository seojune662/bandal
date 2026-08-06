import { useCallback, useEffect, useRef, useState } from 'react'
import { onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { requestChatPrompt } from '../chat/chatPromptBus'
import { AssistantOrb } from './AssistantOrb'
import { AssistantPopup } from './AssistantPopup'
import { SelectionOrb } from './SelectionOrb'
import { useSelectionAnchor, type AnchoredSelection } from './useSelectionAnchor'
import type { BandalOrbState } from './BandalOrbMark'
import './assistant.css'

const MAX_QUOTE_LENGTH = 2000

function shortenQuote(text: string): string {
  if (text.length <= MAX_QUOTE_LENGTH) return text
  const remaining = MAX_QUOTE_LENGTH - 1
  const headLength = Math.ceil(remaining / 2)
  const tailLength = remaining - headLength
  return `${text.slice(0, headLength)}…${text.slice(-tailLength)}`
}

function quotePrompt(selection: AnchoredSelection): string {
  const text = shortenQuote(selection.text.trim())
  const source = shortenQuote(selection.source.replace(/\s+/g, ' ').trim())
  const quote = text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quote}\n>\n> (${source}에서)`
}

function useAssistantActivity(
  courseId: string | null,
  popupOpen: boolean
): { busy: boolean; alert: boolean; clearAlert: () => void } {
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
    const popup = document.querySelector('.assistant-popup')
    if (popup === null) return
    const update = (): void => {
      setSurfaceBusy(
        popup.querySelector('[data-streaming]:not([data-streaming="false"])') !==
          null
      )
    }
    const observer = new MutationObserver(update)
    observer.observe(popup, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-streaming']
    })
    update()
    return () => observer.disconnect()
  }, [courseId])

  const clearAlert = useCallback((): void => setAlert(false), [])
  return { busy: eventBusy || surfaceBusy, alert, clearAlert }
}

/** Single shell-level entry point for the persistent assistant experience. */
export function AssistantLayer(): JSX.Element {
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const [popupOpen, setPopupOpen] = useState(false)
  const pendingPromptRef = useRef<string | null>(null)
  const { selection, clear } = useSelectionAnchor()
  const activity = useAssistantActivity(selectedCourseId, popupOpen)

  useEffect(() => {
    if (selectedCourseId === null || pendingPromptRef.current === null) return
    const prompt = pendingPromptRef.current
    pendingPromptRef.current = null
    requestChatPrompt(selectedCourseId, prompt)
  }, [selectedCourseId])

  const togglePopup = useCallback((): void => {
    activity.clearAlert()
    setPopupOpen((open) => !open)
  }, [activity])

  const closePopup = useCallback((): void => setPopupOpen(false), [])

  const pickSelection = useCallback(
    (picked: AnchoredSelection): void => {
      setPopupOpen(true)
      activity.clearAlert()
      const prompt = quotePrompt(picked)
      if (selectedCourseId === null) pendingPromptRef.current = prompt
      else requestChatPrompt(selectedCourseId, prompt)
      window.getSelection()?.removeAllRanges()
      clear()
    },
    [activity, clear, selectedCourseId]
  )

  const orbState: BandalOrbState = activity.busy
    ? 'busy'
    : activity.alert
      ? 'alert'
      : 'idle'

  return (
    <div className="assistant-layer" data-assistant-layer="true">
      <AssistantPopup visible={popupOpen} onClose={closePopup} />
      {selection !== null && (
        <SelectionOrb
          selection={selection}
          courseAvailable={selectedCourseId !== null}
          onPick={pickSelection}
        />
      )}
      <AssistantOrb open={popupOpen} state={orbState} onToggle={togglePopup} />
    </div>
  )
}
