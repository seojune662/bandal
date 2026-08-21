import { useCallback, useEffect, useRef, useState } from 'react'
import type { AssistantMode } from '../../../../shared/types/settings'
import { invoke, onPush } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { requestChatPrompt } from '../chat/chatPromptBus'
import { AssistantOrb } from './AssistantOrb'
import { CharmLayer } from './charms'
import { AssistantPopup } from './AssistantPopup'
import { SelectionOrb } from './SelectionOrb'
import { useAssistantActivity } from './useAssistantActivity'
import { useSelectionAnchor, type AnchoredSelection } from './useSelectionAnchor'
import type { BandalOrbState } from './BandalOrbMark'
import './assistant.css'

const MAX_QUOTE_LENGTH = 2000
const popupConversationIds = new Map<string, string>()

function popupConversationIdFor(courseId: string): string {
  const existing = popupConversationIds.get(courseId)
  if (existing !== undefined) return existing
  const conversationId = crypto.randomUUID()
  popupConversationIds.set(courseId, conversationId)
  return conversationId
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

function useAssistantMode(): AssistantMode | null {
  const [mode, setMode] = useState<AssistantMode | null>(null)

  useEffect(() => {
    let active = true
    let receivedPush = false
    const unsubscribe = onPush('settings:changed', ({ settings }) => {
      receivedPush = true
      setMode(settings.assistantMode)
    })
    void invoke('settings:get', {})
      .then((settings) => {
        if (active && !receivedPush) setMode(settings.assistantMode)
      })
      .catch((error: unknown) => {
        console.error('[Bandal] 어시스턴트 표시 설정을 불러오지 못했습니다.', error)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return mode
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

  const orbState: BandalOrbState = activity.busy
    ? 'busy'
    : activity.alert
      ? 'alert'
      : 'idle'

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
  const popupConversationId =
    selectedCourseId === null
      ? null
      : popupConversationIdFor(selectedCourseId)
  const assistantMode = useAssistantMode()
  const { selection, clear } = useSelectionAnchor()

  const pickDesktopSelection = useCallback(
    (picked: AnchoredSelection): void => {
      const prompt = quotePrompt(picked)
      void invoke('overlay:prompt', { prompt }).catch((error: unknown) => {
        console.error('[Bandal] 선택한 내용을 데스크톱 대화로 보내지 못했습니다.', error)
      })
      window.getSelection()?.removeAllRanges()
      clear()
    },
    [clear]
  )

  return (
    <div className="assistant-layer" data-assistant-layer="true">
      {assistantMode === 'in-app' && (
        <InAppAssistant
          selectedCourseId={selectedCourseId}
          popupConversationId={popupConversationId}
          selection={selection}
          clearSelection={clear}
        />
      )}
      {assistantMode === 'desktop' && selection !== null && (
        <SelectionOrb
          selection={selection}
          courseAvailable={selectedCourseId !== null}
          onPick={pickDesktopSelection}
        />
      )}
    </div>
  )
}
