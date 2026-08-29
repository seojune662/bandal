import { useEffect, useId, useRef, useState } from 'react'
import { Tooltip } from '../../components/Tooltip'
import { useT } from '../../i18n'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { GroupIcon } from '../group/groupIcons'
import { AccountAvatar } from './AccountAvatar'

/**
 * Nickname editing intentionally lives in Settings only — the nickname is the
 * identifier friends invite by, so changing it deserves the settings surface
 * with its confirmation step, not a quick inline field.
 */
export function SidebarAccountEntry(): JSX.Element | null {
  const t = useT()
  const auth = useAuthStore((state) => state.auth)
  const signOut = useAuthStore((state) => state.signOut)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const profile = auth.phase === 'signed-in' ? auth.profile : null

  useEffect(() => {
    if (!open) return
    setError(null)

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

  const openAccountSettings = (): void => {
    setOpen(false)
    useUiStore.getState().openSettings()
    const categoryLabel = t('settings.category.account.label')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const category = [
          ...document.querySelectorAll<HTMLButtonElement>('.settings-nav__item')
        ].find((button) => button.textContent?.trim() === categoryLabel)
        category?.click()
      })
    })
  }

  const handleSignOut = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await signOut()
    } catch {
      setError('로그아웃하지 못했어요. 다시 시도해요.')
      setPending(false)
    }
  }

  return (
    <div className="sidebar-account" ref={rootRef}>
      <Tooltip label={displayName} placement="top">
        <button
          ref={triggerRef}
          type="button"
          className="rail-nav__item sidebar-account__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          aria-label={`계정: ${displayName}`}
          onClick={() => setOpen((current) => !current)}
        >
          <AccountAvatar
            color={profile.avatarColor}
            emoji={profile.avatarEmoji}
            nickname={displayName}
            size="sm"
          />
        </button>
      </Tooltip>

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
              {auth.email !== null && (
                <span className="sidebar-account__email">{auth.email}</span>
              )}
              <span>내 계정</span>
            </div>
          </div>

          <button
            type="button"
            className="sidebar-account__manage"
            onClick={openAccountSettings}
          >
            설정에서 프로필 변경
          </button>

          {error !== null && (
            <p className="sidebar-account__error" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            className="sidebar-account__sign-out"
            disabled={pending}
            onClick={() => void handleSignOut()}
          >
            <GroupIcon name="logOut" />
            {pending ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      )}
    </div>
  )
}
