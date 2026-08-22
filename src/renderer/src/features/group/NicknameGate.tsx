/**
 * The nickname step — the last thing between a fresh account and 함께하기.
 *
 * WHY IT IS A GATE, not a settings field. A brand-new profile is created by the
 * `handle_new_user` trigger with the placeholder handle `user_<8hex>`
 * (docs/phase2-community.md §2.1), which main projects as `nickname: null`.
 * That placeholder is useless to everyone else: invites are addressed BY
 * NICKNAME, and a group full of `user_3f9a21bc` is a group nobody can invite
 * into. So the step runs once, immediately after sign-in — which is the moment
 * the student is expecting a follow-up question anyway, having just clicked
 * 로그인 ten seconds ago.
 *
 * The escape hatch is 로그아웃, deliberately not "나중에": there is no other
 * surface that sets a nickname, so a skip button would promise something the
 * app cannot deliver.
 *
 * Visually it is an onboarding step (same overlay, card, eyebrow/title/desc
 * ladder) because it *is* one — a fifth step that only some accounts see.
 */

import { useEffect, useId, useRef, useState } from 'react'
import {
  isValidNickname,
  NICKNAME_MAX_LENGTH,
  NICKNAME_RULE_TEXT
} from '../../../../shared/group/nickname'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { useAuthStore } from '../../stores/authStore'
import { useFocusTrap } from '../../components/useFocusTrap'
import '../onboarding/onboarding.css'
import './nickname.css'

export function NicknameGate(): JSX.Element {
  const setNickname = useAuthStore((state) => state.setNickname)
  const signOut = useAuthStore((state) => state.signOut)

  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const titleId = useId()

  useFocusTrap(dialogRef, { active: true, initialFocus: inputRef })

  // Webview guests must not eat the pointer while an overlay is up.
  useEffect(() => acquirePointerPassthrough(), [])

  const trimmed = value.trim()
  const ready = isValidNickname(trimmed) && !pending

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!isValidNickname(trimmed)) {
      setError(NICKNAME_RULE_TEXT)
      inputRef.current?.focus()
      return
    }
    setPending(true)
    setError(null)
    try {
      // On success the store swaps in the new profile, `selectNeedsNickname`
      // flips false and this component unmounts. No local "done" state.
      await setNickname(trimmed)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : '닉네임을 저장하지 못했어요. 다시 시도해요.'
      )
      inputRef.current?.focus()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="onboarding-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="onboarding-card nickname-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="onboarding-body">
          <form
            className="onboarding-step nickname-form"
            onSubmit={(event) => void submit(event)}
          >
            <p className="onboarding-eyebrow">NICKNAME</p>
            <h2 id={titleId} className="onboarding-title">
              뭐라고 불러드릴까요?
            </h2>
            <p className="onboarding-desc">
              그룹에서 이 이름으로 보여요. 친구가 초대할 때도 이 이름으로
              찾으니까, 조원들이 알아볼 이름이면 좋아요.
            </p>

            <label className="field-label" htmlFor={inputId}>
              닉네임
            </label>
            <div className="nickname-field">
              <input
                ref={inputRef}
                id={inputId}
                className="text-field nickname-field__input"
                value={value}
                placeholder="예: 서준"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={NICKNAME_MAX_LENGTH}
                disabled={pending}
                aria-invalid={error !== null}
                aria-describedby={`${inputId}-rule`}
                onChange={(event) => {
                  setValue(event.target.value)
                  if (error !== null) setError(null)
                }}
              />
              <span className="nickname-field__count" aria-hidden="true">
                {[...trimmed].length}/{NICKNAME_MAX_LENGTH}
              </span>
            </div>
            <p id={`${inputId}-rule`} className="nickname-rule">
              {NICKNAME_RULE_TEXT}
            </p>

            {error !== null && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="nickname-actions">
              <button
                type="button"
                className="nickname-actions__alt"
                disabled={pending}
                onClick={() => void signOut()}
              >
                다른 계정으로 할게요
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={!ready}
              >
                {pending ? '저장하는 중…' : '시작하기'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
