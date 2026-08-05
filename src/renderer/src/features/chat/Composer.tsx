/**
 * Chat composer: multiline auto-growing textarea (Enter 전송 / Shift+Enter
 * 줄바꿈), streaming stop button, permission-waiting state and the
 * usage-limit banner (input stays enabled).
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type KeyboardEvent
} from 'react'
import type { LimitInfo } from './chatModel'

const MAX_TEXTAREA_HEIGHT_PX = 200

export interface ComposerHandle {
  focus: () => void
}

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onCancel: () => void
  isStreaming: boolean
  isWaitingPermission: boolean
  limit: LimitInfo | null
  disabled: boolean
}

function formatResetTime(resetsAt: string | undefined): string | null {
  if (resetsAt === undefined) {
    return null
  }
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toLocaleTimeString('ko-KR', {
    hour: 'numeric',
    minute: '2-digit'
  })
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      value,
      onChange,
      onSend,
      onCancel,
      isStreaming,
      isWaitingPermission,
      limit,
      disabled
    },
    ref
  ): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus()
    }))

    const resize = useCallback(() => {
      const textarea = textareaRef.current
      if (textarea === null) {
        return
      }
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(
        textarea.scrollHeight,
        MAX_TEXTAREA_HEIGHT_PX
      )}px`
    }, [])

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        if (!isStreaming && !disabled) {
          onSend()
        }
      }
    }

    const canSend = !isStreaming && !disabled && value.trim() !== ''
    const resetTime = formatResetTime(limit?.resetsAt)

    return (
      <div className="chat-composer-zone">
        {limit !== null && (
          <div className="chat-limit" role="status">
            <span className="chat-limit__title">사용 한도에 도달했어요.</span>
            <span>
              {resetTime !== null
                ? `${resetTime}에 다시 이용할 수 있어요.`
                : limit.message}
            </span>
          </div>
        )}
        <div className="chat-composer" data-streaming={isStreaming || undefined}>
          <textarea
            ref={textareaRef}
            className="chat-composer__input"
            rows={1}
            placeholder="무엇이든 물어보세요"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
              resize()
            }}
            onKeyDown={handleKeyDown}
            aria-label="메시지 입력"
          />
          {isStreaming ? (
            <button
              type="button"
              className="chat-composer__action chat-composer__action--stop"
              onClick={onCancel}
              aria-label="응답 중단"
              title="응답 중단"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="chat-composer__action chat-composer__action--send"
              onClick={onSend}
              disabled={!canSend}
              aria-label="메시지 보내기"
              title="보내기 (Enter)"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="chat-composer__hint">
          {isWaitingPermission ? (
            <span className="chat-composer__hint-waiting">
              도구 실행 허용을 기다리는 중이에요 — 위 카드에서 응답해 주세요.
            </span>
          ) : isStreaming ? (
            <span>답변을 작성하고 있어요…</span>
          ) : (
            <span>Enter로 전송 · Shift+Enter로 줄바꿈</span>
          )}
        </div>
      </div>
    )
  }
)
