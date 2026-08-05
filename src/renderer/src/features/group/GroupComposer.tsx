/**
 * Group chat composer.
 *
 * ★ THE INPUT STAYS ALIVE OFFLINE. That is a product decision, not an
 * oversight (§6.3): messages queue into the outbox and go out on reconnect,
 * exactly like KakaoTalk. Disabling the box when the socket drops would throw
 * away work the student already did.
 *
 * The only state that genuinely disables sending is a rate limit, and even
 * then the text is preserved and a countdown is shown.
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent
} from 'react'
import type { GroupConnectionState } from '../../../../shared/types/group'
import { GroupIcon } from './groupIcons'

const MAX_BODY_LENGTH = 4000
const MAX_ROWS_PX = 160

export interface GroupComposerHandle {
  focus: () => void
}

interface GroupComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  connection: GroupConnectionState
  /** Seconds left on a send rate limit; 0 = unrestricted. */
  cooldown: number
  disabled?: boolean
}

function placeholderFor(
  connection: GroupConnectionState,
  cooldown: number
): string {
  if (cooldown > 0) return `조금만 천천히 보내요 · ${cooldown}초`
  if (connection === 'offline') return '오프라인이에요 · 연결되면 전송돼요'
  return '메시지 보내기'
}

export const GroupComposer = forwardRef<GroupComposerHandle, GroupComposerProps>(
  function GroupComposer(
    { value, onChange, onSend, connection, cooldown, disabled = false },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus()
    }))

    // Auto-grow. Height is set imperatively rather than animated — height is a
    // layout-bound property and must never be transitioned.
    useLayoutEffect(() => {
      const node = textareaRef.current
      if (node === null) return
      node.style.height = 'auto'
      node.style.height = `${Math.min(node.scrollHeight, MAX_ROWS_PX)}px`
    }, [value])

    const blocked = disabled || cooldown > 0

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends, Shift+Enter breaks the line. IME composition must be
        // left alone or Korean input commits a half-typed 글자.
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
          return
        }
        event.preventDefault()
        if (!blocked) onSend()
      },
      [blocked, onSend]
    )

    return (
      <div className="group-composer" data-blocked={blocked || undefined}>
        <label className="sr-only" htmlFor="group-composer-input">
          메시지 입력
        </label>
        <textarea
          id="group-composer-input"
          ref={textareaRef}
          className="group-composer__input"
          rows={1}
          maxLength={MAX_BODY_LENGTH}
          placeholder={placeholderFor(connection, cooldown)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="group-composer__send"
          aria-label="보내기"
          disabled={blocked || value.trim() === ''}
          onClick={onSend}
        >
          <GroupIcon name="send" />
        </button>
      </div>
    )
  }
)
