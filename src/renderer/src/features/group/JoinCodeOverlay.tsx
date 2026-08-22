/**
 * 6-box invite code overlay — the "2 steps, or 1 with the clipboard" flow
 * (docs/phase2-community.md §5.2).
 *
 * Three things make it fast, and all three are load-bearing:
 *  1. CLIPBOARD PREFILL on open. The code almost always arrives via KakaoTalk,
 *     so it is already on the clipboard — reading it removes an entire step.
 *  2. AUTO-SUBMIT on the sixth character. There is no button, because a button
 *     is another step for zero information.
 *  3. CROCKFORD NORMALIZATION as you type: `O`→`0`, `I`/`L`→`1`, uppercase,
 *     punctuation dropped. People read codes aloud and mistype exactly these.
 *
 * Failure copy is deliberately undifferentiated — "만료됨" vs "없음" would leak
 * a signal an attacker can use to map the code space (supabase/README.md §8-⑩).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent
} from 'react'
import type { JoinGroupResult } from '../../../../shared/types/group'
import {
  INVITE_CODE_LENGTH,
  inviteCodeFromClipboard,
  toInviteCodeInput
} from '../../../../shared/group/inviteCode'
import { Icon } from '../../app/icons'
import { useFocusTrap } from '../../components/useFocusTrap'

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }

interface JoinCodeOverlayProps {
  open: boolean
  onClose: () => void
  onJoin: (code: string) => Promise<JoinGroupResult>
  onJoined: (groupId: string, alreadyMember: boolean) => void
}

function failureMessage(result: Extract<JoinGroupResult, { ok: false }>): string {
  switch (result.error) {
    case 'rate_limited': {
      const seconds = result.retryAfter ?? 60
      const minutes = Math.ceil(seconds / 60)
      return `잠시 후 다시 시도해요 · ${minutes}분 남음`
    }
    case 'offline':
      return '오프라인이에요. 연결한 뒤 다시 시도해요.'
    case 'not-signed-in':
      return '로그인이 필요해요.'
    case 'unconfigured':
      return '지금은 함께하기를 쓸 수 없어요.'
    default:
      return '코드를 찾을 수 없어요. 다시 확인해 주세요.'
  }
}

export function JoinCodeOverlay({
  open,
  onClose,
  onJoin,
  onJoined
}: JoinCodeOverlayProps): JSX.Element | null {
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittedRef = useRef<string | null>(null)

  useFocusTrap(dialogRef, {
    active: open,
    initialFocus: inputRef,
    onEscape: onClose
  })

  const submit = useCallback(
    async (candidate: string) => {
      // Guard against the effect and the change handler racing to submit the
      // same code — every attempt costs a rate-limit slot.
      if (submittedRef.current === candidate) return
      submittedRef.current = candidate
      setStatus({ kind: 'submitting' })
      try {
        const result = await onJoin(candidate)
        if (result.ok) {
          onJoined(result.group.id, result.alreadyMember)
          return
        }
        setStatus({ kind: 'error', message: failureMessage(result) })
        setCode('')
        submittedRef.current = null
        inputRef.current?.focus()
      } catch (error) {
        setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : '문제가 생겼어요.'
        })
        submittedRef.current = null
      }
    },
    [onJoin, onJoined]
  )

  // Open → focus, and prefill from the clipboard when it holds a valid code.
  useEffect(() => {
    if (!open) {
      setCode('')
      setStatus({ kind: 'idle' })
      submittedRef.current = null
      return
    }
    let cancelled = false
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (cancelled) return
        const prefill = inviteCodeFromClipboard(text)
        if (prefill !== null) {
          setCode(prefill)
          void submit(prefill)
        }
      })
      .catch(() => {
        // Clipboard permission is not guaranteed; typing still works.
      })
    return () => {
      cancelled = true
    }
  }, [open, submit])

  const handleChange = useCallback(
    (raw: string) => {
      const next = toInviteCodeInput(raw)
      setCode(next)
      if (status.kind === 'error') setStatus({ kind: 'idle' })
      if (next.length === INVITE_CODE_LENGTH) void submit(next)
    },
    [status.kind, submit]
  )

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault()
      handleChange(event.clipboardData.getData('text'))
    },
    [handleChange]
  )

  if (!open) return null

  const boxes = Array.from({ length: INVITE_CODE_LENGTH }, (_, index) => index)

  return (
    <div
      ref={dialogRef}
      className="group-join-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-join-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="group-join">
        <button
          type="button"
          className="group-join__close"
          aria-label="닫기"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
        <p className="eyebrow">함께하기</p>
        <h2 id="group-join-title" className="group-join__title">
          초대 코드 입력
        </h2>
        <p className="group-join__desc">
          6자를 입력하면 바로 들어가요. 붙여넣기도 돼요.
        </p>

        {/* One real input behind the boxes: native selection, IME, paste and
            screen readers all keep working, which a 6-input grid breaks. The
            wrapper bounds the invisible input to the boxes so it never
            swallows clicks meant for the close button. */}
        <div className="group-join__field">
          <div className="group-join__boxes" aria-hidden="true">
            {boxes.map((index) => (
              <span
                key={index}
                className="group-join__box"
                data-filled={index < code.length || undefined}
                data-active={index === code.length || undefined}
              >
                {code[index] ?? ''}
              </span>
            ))}
          </div>
          <label className="sr-only" htmlFor="group-join-input">
            초대 코드 6자
          </label>
          <input
            id="group-join-input"
            ref={inputRef}
            className="group-join__input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={INVITE_CODE_LENGTH}
            value={code}
            disabled={status.kind === 'submitting'}
            onChange={(event) => handleChange(event.target.value)}
            onPaste={handlePaste}
          />
        </div>

        <p className="group-join__status" role="status" aria-live="polite">
          {status.kind === 'submitting'
            ? '들어가는 중…'
            : status.kind === 'error'
              ? status.message
              : ''}
        </p>
      </div>
    </div>
  )
}
