import { useCallback, useEffect } from 'react'
import { BandalOrbMark } from '../assistant/BandalOrbMark'
import { ChatSurface } from '../chat/ChatSurface'
import { requestChatPrompt } from '../chat/chatPromptBus'
import { invoke, onPush } from '../../lib/ipc'
import { CourseChip } from './CourseChip'
import { ScreenPermissionChip } from './ScreenPermissionChip'
import { useOverlayState } from './useOverlayState'

function reportPopupError(error: unknown): void {
  console.error('[Bandal] 데스크톱 팝업 동작을 처리하지 못했습니다.', error)
}

export function OverlayPopupApp(): JSX.Element {
  const state = useOverlayState()

  const closePopup = useCallback((): void => {
    void invoke('overlay:togglePopup', { open: false }).catch(reportPopupError)
  }, [])

  const openPermissionSettings = useCallback((): void => {
    void invoke('desktopAgent:openPermissionSettings', {}).catch(reportPopupError)
  }, [])

  const openConversationInApp = useCallback(
    (conversationId: string): void => {
      if (state.courseId === null) return
      void invoke('overlay:openInApp', {
        courseId: state.courseId,
        conversationId
      }).catch(reportPopupError)
    },
    [state.courseId]
  )

  useEffect(() => {
    return onPush('overlay:prompt', ({ conversationId, prompt }) => {
      requestChatPrompt(conversationId, prompt)
    })
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePopup()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closePopup])

  const openInApp = (): void => {
    if (state.courseId === null) return
    void invoke('overlay:openInApp', {
      courseId: state.courseId,
      conversationId: state.conversationId
    }).catch(reportPopupError)
  }

  return (
    <section className="overlay-popup" aria-label="반달 AI 채팅">
      <header className="overlay-popup__header">
        <div className="overlay-popup__identity">
          <BandalOrbMark />
          <strong>반달 AI</strong>
        </div>
        <CourseChip courseId={state.courseId} />
        <ScreenPermissionChip
          state={state.screenPermission}
          onClick={openPermissionSettings}
        />
        <div className="overlay-popup__actions">
          <button
            type="button"
            className="overlay-popup__open-app"
            aria-label="앱에서 열기"
            title="앱에서 열기"
            disabled={state.courseId === null}
            onClick={openInApp}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5H3.5v9h9V10M8.5 3.5h4v4m0-4-6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="overlay-popup__close"
            aria-label="반달 AI 닫기"
            title="닫기"
            onClick={closePopup}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8m0-8-8 8" />
            </svg>
          </button>
        </div>
      </header>

      <div className="overlay-popup__body">
        {state.courseId === null || state.conversationId === null ? (
          <div className="overlay-popup__empty" role="status">
            <BandalOrbMark />
            <p>과목을 먼저 고르세요</p>
          </div>
        ) : (
          <ChatSurface
            courseId={state.courseId}
            conversationId={state.conversationId}
            variant="overlay"
            surface="desktop"
            onOpenConversation={openConversationInApp}
          />
        )}
      </div>
    </section>
  )
}
