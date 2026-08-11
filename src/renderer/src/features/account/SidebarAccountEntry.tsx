import { useEffect, useId, useRef, useState } from 'react'
import {
  isValidNickname,
  NICKNAME_MAX_LENGTH,
  NICKNAME_RULE_TEXT
} from '../../../../shared/group/nickname'
import { Icon } from '../../app/icons'
import { useAuthStore } from '../../stores/authStore'
import { GroupIcon } from '../group/groupIcons'
import { AccountAvatar } from './AccountAvatar'

export function SidebarAccountEntry(): JSX.Element | null {
  const auth = useAuthStore((state) => state.auth)
  const setNickname = useAuthStore((state) => state.setNickname)
  const signOut = useAuthStore((state) => state.signOut)
  const [open, setOpen] = useState(false)
  const [nickname, setNicknameDraft] = useState('')
  const [pending, setPending] = useState<'nickname' | 'sign-out' | null>(null)
  const [error, setError] = useState<{
    target: 'nickname' | 'sign-out'
    message: string
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverId = useId()
  const nicknameId = useId()
  const profile = auth.phase === 'signed-in' ? auth.profile : null

  useEffect(() => {
    if (!open) return
    setNicknameDraft(profile?.nickname ?? '')
    setError(null)
    inputRef.current?.focus()
  }, [open, profile?.nickname])

  useEffect(() => {
    if (!open) return

    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (profile === null) setOpen(false)
  }, [profile])

  if (profile === null) return null

  const displayName = profile.nickname ?? '닉네임 설정 전'
  const trimmedNickname = nickname.trim()
  const nicknameChanged = trimmedNickname !== (profile.nickname ?? '')

  const saveNickname = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!isValidNickname(trimmedNickname)) {
      setError({ target: 'nickname', message: NICKNAME_RULE_TEXT })
      inputRef.current?.focus()
      return
    }
    if (!nicknameChanged || pending !== null) return

    setPending('nickname')
    setError(null)
    try {
      await setNickname(trimmedNickname)
    } catch (saveError) {
      setError({
        target: 'nickname',
        message:
          saveError instanceof Error
            ? saveError.message
            : '닉네임을 저장하지 못했어요. 다시 시도해요.'
      })
      inputRef.current?.focus()
    } finally {
      setPending(null)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    if (pending !== null) return
    setPending('sign-out')
    setError(null)
    try {
      await signOut()
    } catch {
      setError({
        target: 'sign-out',
        message: '로그아웃하지 못했어요. 다시 시도해요.'
      })
      setPending(null)
    }
  }

  return (
    <div className="sidebar-account" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="sidebar-account__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <AccountAvatar
          color={profile.avatarColor}
          emoji={profile.avatarEmoji}
          nickname={displayName}
          size="sm"
        />
        <span className="sidebar-account__name">{displayName}</span>
        <Icon name="chevronRight" className="sidebar-account__chevron" />
      </button>

      {open && (
        <div
          id={popoverId}
          className="sidebar-account__popover"
          role="dialog"
          aria-label="계정 관리"
        >
          <div className="sidebar-account__profile">
            <AccountAvatar
              color={profile.avatarColor}
              emoji={profile.avatarEmoji}
              nickname={displayName}
            />
            <div>
              <strong>{displayName}</strong>
              <span>내 계정</span>
            </div>
          </div>

          <form
            className="sidebar-account__form"
            onSubmit={(event) => void saveNickname(event)}
          >
            <label htmlFor={nicknameId}>닉네임</label>
            <div className="sidebar-account__field-row">
              <input
                ref={inputRef}
                id={nicknameId}
                value={nickname}
                maxLength={NICKNAME_MAX_LENGTH}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={pending !== null}
                aria-invalid={error?.target === 'nickname'}
                aria-describedby={
                  error?.target === 'nickname' ? `${nicknameId}-error` : undefined
                }
                onChange={(event) => {
                  setNicknameDraft(event.target.value)
                  if (error?.target === 'nickname') setError(null)
                }}
              />
              <button
                type="submit"
                disabled={
                  pending !== null ||
                  !nicknameChanged ||
                  !isValidNickname(trimmedNickname)
                }
              >
                {pending === 'nickname' ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>

          {error !== null && (
            <p id={`${nicknameId}-error`} className="sidebar-account__error" role="alert">
              {error.message}
            </p>
          )}

          <button
            type="button"
            className="sidebar-account__sign-out"
            disabled={pending !== null}
            onClick={() => void handleSignOut()}
          >
            <GroupIcon name="logOut" />
            {pending === 'sign-out' ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </div>
  )
}
