import { useCallback, useEffect, useRef, useState } from 'react'
import type { OverlayState } from '../../../../shared/types/overlay'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { requestChatPrompt } from '../chat/chatPromptBus'
import {
  setOverlayState,
  useOverlayState
} from '../overlay/useOverlayState'
import { AssistantOrb } from './AssistantOrb'
import { CharmLayer } from './charms'
import { AssistantPopup } from './AssistantPopup'
import { orbStateForActivity } from './orbActivityState'
import { SelectionOrb } from './SelectionOrb'
import { useAssistantActivity } from './useAssistantActivity'
import { useSelectionAnchor, type AnchoredSelection } from './useSelectionAnchor'
import type { BandalOrbState } from './BandalOrbMark'
import './assistant.css'

const MAX_QUOTE_LENGTH = 2000

export function overlayConversationForCourse(
  selectedCourseId: string | null,
  overlay: Pick<OverlayState, 'courseId' | 'conversationId'>
): string | null {
  return overlay.courseId === selectedCourseId ? overlay.conversationId : null
}

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

interface InAppAssistantProps {
  selectedCourseId: string | null
  popupConversationId: string | null
  selection: AnchoredSelection | null
  clearSelection: () => void
}

function InAppAssistant({
  selectedCourseId,
  popupConversationId,
  selection,
  clearSelection
}: InAppAssistantProps): JSX.Element {
  const [popupOpen, setPopupOpen] = useState(false)
  const pendingPromptRef = useRef<string | null>(null)
  const orbRef = useRef<HTMLButtonElement>(null)
  const activity = useAssistantActivity({
    courseId: selectedCourseId,
    popupOpen,
    observeRoot: '.assistant-popup'
  })

  useEffect(() => {
    if (popupConversationId === null || pendingPromptRef.current === null) return
    const prompt = pendingPromptRef.current
    pendingPromptRef.current = null
    requestChatPrompt(popupConversationId, prompt)
  }, [popupConversationId])

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
      if (popupConversationId === null) pendingPromptRef.current = prompt
      else requestChatPrompt(popupConversationId, prompt)
      window.getSelection()?.removeAllRanges()
      clearSelection()
    },
    [activity, clearSelection, popupConversationId]
  )

  const orbState: BandalOrbState = orbStateForActivity(activity)

  return (
    <>
      <CharmLayer orbRef={orbRef} orbState={orbState} />
      <AssistantPopup
        visible={popupOpen}
        conversationId={popupConversationId}
        onClose={closePopup}
      />
      {selection !== null && (
        <SelectionOrb
          selection={selection}
          courseAvailable={selectedCourseId !== null}
          onPick={pickSelection}
        />
      )}
      <AssistantOrb
        ref={orbRef}
        open={popupOpen}
        state={orbState}
        onToggle={togglePopup}
      />
    </>
  )
}

/** Single shell-level entry point for the persistent assistant experience. */
export function AssistantLayer(): JSX.Element {
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const overlayState = useOverlayState()
  const popupConversationId = overlayConversationForCourse(
    selectedCourseId,
    overlayState
  )
  const { selection, clear } = useSelectionAnchor()

  useEffect(() => {
    if (
      selectedCourseId === null ||
      overlayState.courseId === selectedCourseId
    ) {
      return
    }
    let active = true
    void invoke('overlay:setCourse', { courseId: selectedCourseId })
      .then((state) => {
        if (active) setOverlayState(state)
      })
      .catch((error: unknown) => {
        console.error('[Bandal] 어시스턴트 대화를 과목과 맞추지 못했습니다.', error)
      })
    return () => {
      active = false
    }
  }, [overlayState.courseId, selectedCourseId])

  return (
    <div className="assistant-layer" data-assistant-layer="true">
      <InAppAssistant
        selectedCourseId={selectedCourseId}
        popupConversationId={popupConversationId}
        selection={selection}
        clearSelection={clear}
      />
    </div>
  )
}
