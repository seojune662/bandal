import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  isValidNickname,
  NICKNAME_MAX_LENGTH
} from '../../../../shared/group/nickname'
import type { AuthState } from '../../../../shared/types/auth'
import { AccountAvatar } from '../account/AccountAvatar'
import {
  ACCOUNT_AVATAR_COLORS,
  ACCOUNT_AVATAR_EMOJIS
} from '../account/accountOptions'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import './account-panel.css'

type PendingAction = 'nickname' | 'avatar' | 'sign-out'

interface Feedback {
  tone: 'success' | 'error'
  message: string
}

export function AccountPanel(): JSX.Element {
  const t = useT()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [nickname, setNickname] = useState('')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const mountedRef = useRef(true)
  const nicknameInputRef = useRef<HTMLInputElement>(null)
  const nicknameId = useId()
  const emojiGroupId = useId()
  const colorGroupId = useId()

  const readAuth = useCallback(async (): Promise<AuthState> => {
    const next = await invoke('auth:getState', {})
    if (mountedRef.current) {
      setAuth(next)
      setLoadFailed(false)
    }
    return next
  }, [])

  const loadAuth = useCallback((): void => {
    setLoading(true)
    setLoadFailed(false)
    void readAuth()
      .catch(() => {
        if (mountedRef.current) setLoadFailed(true)
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [readAuth])

  useEffect(() => {
    mountedRef.current = true
    loadAuth()
    return () => {
      mountedRef.current = false
    }
  }, [loadAuth])

  const profile = auth?.phase === 'signed-in' ? auth.profile : null
  const email = auth?.email ?? null

  useEffect(() => {
    setNickname(profile?.nickname ?? '')
  }, [profile?.nickname])

  const runMutation = async (
    action: PendingAction,
    mutate: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string
  ): Promise<void> => {
    if (pending !== null) return
    setPending(action)
    setFeedback(null)
    try {
      await mutate()
      await readAuth()
      if (mountedRef.current) {
        setFeedback({ tone: 'success', message: successMessage })
      }
    } catch {
      if (mountedRef.current) {
        setFeedback({ tone: 'error', message: failureMessage })
      }
    } finally {
      if (mountedRef.current) setPending(null)
    }
  }

  if (loading) {
    return (
      <div className="account-panel-state" role="status">
        <span>{t('settings.account.loading')}</span>
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="account-panel-state" role="alert">
        <strong>{t('settings.account.loadFailed')}</strong>
        <button type="button" className="secondary-button" onClick={loadAuth}>
          {t('settings.account.retry')}
        </button>
      </div>
    )
  }

  if (profile === null) {
    return (
      <div className="account-panel-state">
        <strong>{t('settings.account.signedOut')}</strong>
      </div>
    )
  }

  const displayName = profile.nickname ?? t('settings.account.unnamed')
  const trimmedNickname = nickname.trim()
  const nicknameChanged = trimmedNickname !== (profile.nickname ?? '')

  const submitNickname = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!isValidNickname(trimmedNickname)) {
      setFeedback({
        tone: 'error',
        message: t('settings.account.nickname.rule')
      })
      nicknameInputRef.current?.focus()
      return
    }
    if (!nicknameChanged) return
    void runMutation(
      'nickname',
      () => invoke('auth:setNickname', { nickname: trimmedNickname }),
      t('settings.account.nickname.saved'),
      t('settings.account.nickname.saveFailed')
    )
  }

  const setAvatar = (patch: { color?: string; emoji?: string }): void => {
    void runMutation(
      'avatar',
      () => invoke('auth:setAvatar', patch),
      t('settings.account.avatar.saved'),
      t('settings.account.avatar.saveFailed')
    )
  }

  return (
    <div className="settings-stack account-panel">
      <section className="settings-card account-profile-card">
        <AccountAvatar
          color={profile.avatarColor}
          emoji={profile.avatarEmoji}
          nickname={displayName}
          size="lg"
        />
        <div>
          <h2>{displayName}</h2>
          {email !== null && (
            <p className="account-profile-card__email">{email}</p>
          )}
          <p>{t('settings.account.profile.description')}</p>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__header">
          <h2>{t('settings.account.nickname.title')}</h2>
          <p>{t('settings.account.nickname.description')}</p>
        </div>
        <form className="account-nickname-form" onSubmit={submitNickname}>
          <label htmlFor={nicknameId}>{t('settings.account.nickname.label')}</label>
          <div className="account-nickname-form__row">
            <input
              ref={nicknameInputRef}
              id={nicknameId}
              value={nickname}
              placeholder={t('settings.account.nickname.placeholder')}
              maxLength={NICKNAME_MAX_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={pending !== null}
              aria-describedby={`${nicknameId}-rule`}
              onChange={(event) => {
                setNickname(event.target.value)
                if (feedback?.tone === 'error') setFeedback(null)
              }}
            />
            <button
              type="submit"
              className="secondary-button"
              disabled={
                pending !== null ||
                !nicknameChanged ||
                !isValidNickname(trimmedNickname)
              }
            >
              {pending === 'nickname'
                ? t('settings.account.nickname.saving')
                : t('settings.account.nickname.save')}
            </button>
          </div>
          <p id={`${nicknameId}-rule`} className="account-field-help">
            {t('settings.account.nickname.rule')}
          </p>
        </form>
      </section>

      <section className="settings-card">
        <div className="settings-card__header">
          <h2>{t('settings.account.avatar.title')}</h2>
          <p>{t('settings.account.avatar.description')}</p>
        </div>
        <fieldset className="account-avatar-picker" disabled={pending !== null}>
          <legend className="sr-only">{t('settings.account.avatar.title')}</legend>
          <div
            className="account-avatar-picker__group"
            role="group"
            aria-labelledby={emojiGroupId}
          >
            <span id={emojiGroupId} className="account-avatar-picker__label">
              {t('settings.account.avatar.emojiLabel')}
            </span>
            <div className="account-avatar-options">
              {ACCOUNT_AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="account-emoji-option"
                  aria-label={t('settings.account.avatar.emojiOption', { emoji })}
                  aria-pressed={profile.avatarEmoji === emoji}
                  onClick={() => {
                    if (profile.avatarEmoji !== emoji) setAvatar({ emoji })
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div
            className="account-avatar-picker__group"
            role="group"
            aria-labelledby={colorGroupId}
          >
            <span id={colorGroupId} className="account-avatar-picker__label">
              {t('settings.account.avatar.colorLabel')}
            </span>
            <div className="account-avatar-options">
              {ACCOUNT_AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="account-color-option"
                  aria-label={t(`settings.account.avatar.color.${color}`)}
                  aria-pressed={
                    profile.avatarColor === color ||
                    (profile.avatarColor === 'moon' && color === 'gold')
                  }
                  onClick={() => {
                    if (profile.avatarColor !== color) setAvatar({ color })
                  }}
                >
                  <AccountAvatar
                    color={color}
                    emoji={profile.avatarEmoji}
                    nickname={displayName}
                    size="sm"
                  />
                </button>
              ))}
            </div>
          </div>
        </fieldset>
      </section>

      {feedback !== null && (
        <p
          className="account-panel__feedback"
          data-tone={feedback.tone}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}

      <section className="settings-card account-sign-out-card">
        <div>
          <h2>{t('settings.account.signOut.title')}</h2>
          <p>{t('settings.account.signOut.description')}</p>
        </div>
        <button
          type="button"
          className="account-sign-out-button"
          disabled={pending !== null}
          onClick={() => {
            void runMutation(
              'sign-out',
              () => invoke('auth:signOut', {}),
              t('settings.account.signOut.done'),
              t('settings.account.signOut.failed')
            )
          }}
        >
          {pending === 'sign-out'
            ? t('settings.account.signOut.pending')
            : t('settings.account.signOut.button')}
        </button>
      </section>
    </div>
  )
}
