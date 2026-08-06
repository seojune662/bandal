import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent
} from 'react'
import type { ChatAttachment } from '../../../../shared/types/chat'
import type { MaterialSearchHit } from '../../../../shared/types/materials'
import { invoke } from '../../lib/ipc'
import type { LimitInfo } from './chatModel'
import './composer.css'

const MAX_TEXTAREA_HEIGHT_PX = 200
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_COUNT = 5
const MENTION_DEBOUNCE_MS = 160
const MAX_MENTION_RESULTS = 8

interface MentionRange {
  start: number
  end: number
  query: string
}

export interface ComposerHandle {
  focus: () => void
}

export interface ComposerProps {
  courseId: string
  value: string
  onChange: (value: string) => void
  onSend: (attachments: ChatAttachment[]) => void
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

function mentionAt(text: string, caret: number): MentionRange | null {
  const prefix = text.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix)
  if (match === null) {
    return null
  }
  const atOffset = match[0].lastIndexOf('@')
  const start = match.index + atOffset
  return { start, end: caret, query: match[1] ?? '' }
}

function readImage(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const comma = reader.result.indexOf(',')
      if (comma < 0) {
        reject(new Error('invalid data URL'))
        return
      }
      resolve({ mediaType: file.type, dataBase64: reader.result.slice(comma + 1) })
    }
    reader.readAsDataURL(file)
  })
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      courseId,
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
    const mentionSequenceRef = useRef(0)
    const [attachments, setAttachments] = useState<ChatAttachment[]>([])
    const [attachmentError, setAttachmentError] = useState<string | null>(null)
    const [mention, setMention] = useState<MentionRange | null>(null)
    const [mentionHits, setMentionHits] = useState<MaterialSearchHit[]>([])
    const [mentionIndex, setMentionIndex] = useState(0)
    const [isSearching, setIsSearching] = useState(false)

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

    const updateMention = useCallback((text: string, caret: number) => {
      setMention(mentionAt(text, caret))
      setMentionIndex(0)
    }, [])

    useEffect(() => {
      const sequence = ++mentionSequenceRef.current
      if (mention === null) {
        setMentionHits([])
        setIsSearching(false)
        return
      }
      const query = mention.query.trim()
      if (query === '') {
        setMentionHits([])
        setIsSearching(false)
        return
      }
      setIsSearching(true)
      const timeout = window.setTimeout(() => {
        void invoke('materials:search', { courseId, query })
          .then((hits) => {
            if (sequence !== mentionSequenceRef.current) {
              return
            }
            setMentionHits(hits.slice(0, MAX_MENTION_RESULTS))
            setMentionIndex(0)
          })
          .catch(() => {
            if (sequence === mentionSequenceRef.current) {
              setMentionHits([])
            }
          })
          .finally(() => {
            if (sequence === mentionSequenceRef.current) {
              setIsSearching(false)
            }
          })
      }, MENTION_DEBOUNCE_MS)
      return () => window.clearTimeout(timeout)
    }, [courseId, mention])

    const selectMention = useCallback(
      (hit: MaterialSearchHit) => {
        if (mention === null) {
          return
        }
        const inserted = `@${hit.relPath} `
        const next =
          value.slice(0, mention.start) + inserted + value.slice(mention.end)
        const caret = mention.start + inserted.length
        onChange(next)
        setMention(null)
        setMentionHits([])
        window.requestAnimationFrame(() => {
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(caret, caret)
          resize()
        })
      },
      [mention, onChange, resize, value]
    )

    const submit = useCallback(() => {
      if (
        isStreaming ||
        disabled ||
        (value.trim() === '' && attachments.length === 0)
      ) {
        return
      }
      onSend(attachments)
      setAttachments([])
      setAttachmentError(null)
      setMention(null)
      window.requestAnimationFrame(resize)
    }, [attachments, disabled, isStreaming, onSend, resize, value])

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.nativeEvent.isComposing) {
        return
      }
      if (mention !== null) {
        const clamped = Math.min(
          mentionIndex,
          Math.max(mentionHits.length - 1, 0)
        )
        if (event.key === 'Escape') {
          event.preventDefault()
          setMention(null)
          setMentionHits([])
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setMentionIndex((index) =>
            Math.min(index + 1, Math.max(mentionHits.length - 1, 0))
          )
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setMentionIndex((index) => Math.max(index - 1, 0))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const selected = mentionHits[clamped]
          if (selected !== undefined) {
            selectMention(selected)
          }
          return
        }
        if (event.key === 'Tab' && mentionHits[clamped] !== undefined) {
          event.preventDefault()
          selectMention(mentionHits[clamped]!)
          return
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    }

    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
      const images = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith('image/')
      )
      if (images.length === 0) {
        return
      }
      event.preventDefault()
      const remaining = MAX_IMAGE_COUNT - attachments.length
      const sized = images.filter((file) => file.size <= MAX_IMAGE_BYTES)
      const accepted = sized.slice(0, Math.max(remaining, 0))

      if (images.some((file) => file.size > MAX_IMAGE_BYTES)) {
        setAttachmentError('이미지는 한 장당 5MB까지 첨부할 수 있어요.')
      } else if (images.length > remaining) {
        setAttachmentError('이미지는 한 메시지에 최대 5장까지 첨부할 수 있어요.')
      } else {
        setAttachmentError(null)
      }

      if (accepted.length === 0) {
        return
      }
      void Promise.allSettled(accepted.map(readImage)).then((results) => {
        const read = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        )
        setAttachments((current) =>
          [...current, ...read].slice(0, MAX_IMAGE_COUNT)
        )
        if (read.length !== accepted.length) {
          setAttachmentError('일부 이미지를 읽지 못했어요. 다시 붙여넣어 주세요.')
        }
      })
    }

    const removeAttachment = (index: number): void => {
      setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
      setAttachmentError(null)
    }

    const canSend =
      !isStreaming &&
      !disabled &&
      (value.trim() !== '' || attachments.length > 0)
    const resetTime = formatResetTime(limit?.resetsAt)
    const clampedMentionIndex = Math.min(
      mentionIndex,
      Math.max(mentionHits.length - 1, 0)
    )

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
        {attachments.length > 0 && (
          <div className="chat-attachments" aria-label="첨부 이미지">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.mediaType}:${index}`}
                className="chat-attachment"
              >
                <img
                  src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
                  alt={`첨부 이미지 ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  aria-label={`첨부 이미지 ${index + 1} 제거`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError !== null && (
          <p className="chat-attachment-error" role="alert">
            {attachmentError}
          </p>
        )}
        <div className="chat-composer" data-streaming={isStreaming || undefined}>
          {mention !== null && (
            <div className="chat-mention" role="listbox" aria-label="과목 파일">
              {mention.query.trim() === '' ? (
                <p className="chat-mention__status">파일 이름을 입력하세요.</p>
              ) : isSearching && mentionHits.length === 0 ? (
                <p className="chat-mention__status">찾는 중…</p>
              ) : mentionHits.length === 0 ? (
                <p className="chat-mention__status">일치하는 파일이 없어요.</p>
              ) : (
                mentionHits.map((hit, index) => (
                  <button
                    key={hit.relPath}
                    id={`chat-mention-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === clampedMentionIndex}
                    data-highlighted={index === clampedMentionIndex || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => selectMention(hit)}
                  >
                    <span>{hit.name}</span>
                    <small>{hit.relPath}</small>
                  </button>
                ))
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="chat-composer__input"
            rows={1}
            placeholder="무엇이든 물어보세요 · @로 파일 언급"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
              updateMention(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length
              )
              resize()
            }}
            onSelect={(event) => {
              updateMention(
                value,
                event.currentTarget.selectionStart ?? value.length
              )
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            aria-label="메시지 입력"
            aria-expanded={mention !== null}
            aria-activedescendant={
              mention !== null && mentionHits.length > 0
                ? `chat-mention-${clampedMentionIndex}`
                : undefined
            }
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
              onClick={submit}
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
