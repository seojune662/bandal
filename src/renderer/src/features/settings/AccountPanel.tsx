import { useCallback, useEffect, useRef, useState } from 'react'
import { LogIn } from 'lucide-react'

import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { isValidNickname } from '../../../../shared/account/nickname'
import type { AuthState } from '../../../../shared/types/auth'
import { AccountAvatar } from '../account/AccountAvatar'
import { prepareUpdateInstall } from '../updates/prepareUpdateInstall'
import { useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { BillingSyncPanel } from './BillingSyncPanel'
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsStack,
  SettingsTextRow
} from './kit/SettingsKit'

type PendingAction = 'nickname' | 'sign-out' | 'sign-in' | 'link' | 'delete' | 'profile'

interface Feedback {
  tone: 'success' | 'error'
  message: string
}

const PROVIDERS = ['apple', 'google'] as const
const PROVIDER_NAME: Record<(typeof PROVIDERS)[number], string> = { apple: 'Apple', google: 'Google' }

export function AccountPanel(): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  /** Bumped to throw away a nickname draft the user declined to save. */
  const [nicknameReset, setNicknameReset] = useState(0)
  const mountedRef = useRef(true)
  const authRevision = useRef(0)
  const pendingRef = useRef<PendingAction | null>(null)
  const nicknameCommit = useRef<Promise<string | undefined> | null>(null)

  const readAuth = useCallback(async (): Promise<AuthState> => {
    const revision = authRevision.current
    const next = await invoke('auth:getState', {})
    if (mountedRef.current && revision === authRevision.current) {
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
    const off = onPush('auth:changed', next => {
      authRevision.current += 1
      setAuth(next)
      setLoadFailed(false)
      setLoading(false)
    })
    loadAuth()
    return () => {
      mountedRef.current = false
      authRevision.current += 1
      off()
    }
  }, [loadAuth])

  const profile = auth?.phase === 'signed-in' ? auth.profile : null
  const email = auth?.email ?? null

  /**
   * Runs one account mutation at a time. Resolves true on success. With
   * `inlineError`, a failure is returned to the caller (the nickname field
   * shows it) instead of the panel feedback line.
   */
  const runMutation = async (
    action: PendingAction,
    mutate: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
    options: { inlineError?: boolean } = {}
  ): Promise<boolean> => {
    if (pendingRef.current !== null) return false
    pendingRef.current = action
    setPending(action)
    setFeedback(null)
    try {
      const result = await mutate()
      if (result && typeof result === 'object' && 'cancelled' in result && result.cancelled === true) {
        if (mountedRef.current) setFeedback({ tone: 'success', message: t('settings.account.backup.cancelled') })
        return true
      }
      await readAuth()
      if (mountedRef.current) setFeedback({ tone: 'success', message: successMessage })
      return true
    } catch (error) {
      if (mountedRef.current && options.inlineError !== true) {
        setFeedback({
          tone: 'error',
          message: action === 'delete' && error instanceof Error ? error.message : failureMessage
        })
      }
      return false
    } finally {
      pendingRef.current = null
      if (mountedRef.current) setPending(null)
    }
  }

  const backupAll = (): void => {
    void runMutation(
      'profile',
      async () => {
        await prepareUpdateInstall()
        return invoke('profile:backup', {})
      },
      t('settings.account.backup.done'),
      t('settings.account.backup.failed')
    )
  }

  const backupThenNewProfile = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.account.backup.newProfile.confirmTitle'),
      description: t('settings.account.backup.newProfile.confirmDescription'),
      confirmLabel: t('settings.account.backup.newProfile.confirmAction'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) return
    void runMutation(
      'profile',
      async () => {
        await prepareUpdateInstall()
        return invoke('profile:new', {})
      },
      t('settings.account.backup.newProfile.done'),
      t('settings.account.backup.newProfile.failed')
    )
  }

  const signIn = (provider: (typeof PROVIDERS)[number]): void => {
    void runMutation(
      'sign-in',
      async () => {
        const result = await invoke('auth:signIn', { provider })
        if (!result.ok) throw new Error('sign-in-failed')
      },
      t('settings.account.signIn.started'),
      t('settings.account.signIn.failed')
    )
  }

  const linkProvider = (provider: (typeof PROVIDERS)[number]): void => {
    void runMutation(
      'link',
      async () => {
        const result = await invoke('auth:linkProvider', { provider })
        if (!result.ok) throw new Error('identity-link-failed')
      },
      t('settings.account.link.started'),
      t('settings.account.link.failed')
    )
  }

  const deleteAccount = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.account.delete.confirmTitle'),
      description: t('settings.account.delete.confirmDescription'),
      confirmLabel: t('settings.account.delete.confirmAction'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) return
    void runMutation(
      'delete',
      async () => {
        await prepareUpdateInstall()
        const result = await invoke('auth:deleteAccount', { confirm: true })
        if (!result.ok) throw new Error('deletion-incomplete')
        if (result.appleRevocation === 'manual_required') {
          await confirm({
            title: t('settings.account.delete.appleTitle'),
            description: t('settings.account.delete.appleDescription'),
            acknowledgeOnly: true
          })
        }
      },
      t('settings.account.delete.done'),
      t('settings.account.delete.failed')
    )
  }

  const signOut = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.account.signOut.confirmTitle'),
      description: t('settings.account.signOut.confirmDescription'),
      confirmLabel: t('settings.account.signOut.button'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) return
    void runMutation(
      'sign-out',
      async () => {
        await prepareUpdateInstall()
        return invoke('auth:signOut', {})
      },
      t('settings.account.signOut.done'),
      t('settings.account.signOut.failed')
    )
  }

  if (loading) {
    return (
      <p role="status" className="px-1 py-6 text-sm text-muted-foreground">
        {t('settings.account.loading')}
      </p>
    )
  }

  if (loadFailed) {
    return (
      <SettingsNotice
        tone="danger"
        action={
          <Button variant="secondary" size="sm" onClick={loadAuth}>
            {t('settings.account.retry')}
          </Button>
        }
      >
        {t('settings.account.loadFailed')}
      </SettingsNotice>
    )
  }

  const busy = pending !== null
  const feedbackNotice =
    feedback === null ? null : (
      <SettingsNotice tone={feedback.tone === 'error' ? 'danger' : 'info'}>{feedback.message}</SettingsNotice>
    )

  const backupGroup = (
    <SettingsGroup searchId="account.backup">
      <SettingsRow
        searchId="account.backup.full"
        control={
          <Button variant="secondary" size="sm" disabled={busy} onClick={backupAll}>
            {t('settings.account.backup.full.action')}
          </Button>
        }
      />
      <SettingsRow
        searchId="account.backup.newProfile"
        control={
          <Button variant="destructive-outline" size="sm" disabled={busy} onClick={() => void backupThenNewProfile()}>
            {t('settings.account.backup.newProfile.action')}
          </Button>
        }
      />
    </SettingsGroup>
  )

  if (profile === null) {
    const configured = auth?.phase !== 'unconfigured'
    return (
      <SettingsStack>
        <SettingsGroup searchId="account.signIn" bare>
          <SettingsEmptyState
            icon={<LogIn />}
            title={t('settings.account.signedOut')}
            description={t(configured ? 'settings.account.signIn.description' : 'settings.account.signIn.unconfigured')}
            {...(configured
              ? {
                  action: (
                    <div className="flex flex-wrap justify-center gap-2">
                      {PROVIDERS.map(provider => (
                        <Button
                          key={provider}
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => signIn(provider)}
                        >
                          {t('settings.account.signIn.with', { provider: PROVIDER_NAME[provider] })}
                        </Button>
                      ))}
                    </div>
                  )
                }
              : {})}
          />
        </SettingsGroup>
        {feedbackNotice}
        <BillingSyncPanel />
        {backupGroup}
      </SettingsStack>
    )
  }

  const displayName = profile.nickname ?? t('settings.account.unnamed')

  const commitNickname = (draft: string): Promise<string | undefined> => {
    // Enter commits, then the confirm dialog takes focus and blurs the field:
    // both land here, so the second one shares the first one's outcome.
    if (nicknameCommit.current !== null) return nicknameCommit.current
    const work = (async (): Promise<string | undefined> => {
      const trimmed = draft.trim()
      if (!isValidNickname(trimmed)) return t('settings.account.nickname.rule')
      if (trimmed === (profile.nickname ?? '')) return undefined
      // A renamed account frees the old nickname. First-time setup skips confirmation.
      if (profile.nickname !== null) {
        const confirmed = await confirm({
          title: t('settings.account.nickname.confirm.title'),
          description: t('settings.account.nickname.confirm.message'),
          confirmLabel: t('settings.account.nickname.confirm.change'),
          cancelLabel: t('settings.account.nickname.confirm.cancel')
        })
        if (!confirmed) {
          setNicknameReset(count => count + 1)
          return undefined
        }
      }
      const saved = await runMutation(
        'nickname',
        () => invoke('auth:setNickname', { nickname: trimmed }),
        t('settings.account.nickname.saved'),
        t('settings.account.nickname.saveFailed'),
        { inlineError: true }
      )
      return saved ? undefined : t('settings.account.nickname.saveFailed')
    })()
    nicknameCommit.current = work
    void work.finally(() => {
      nicknameCommit.current = null
    })
    return work
  }

  return (
    <SettingsStack>
      <SettingsGroup searchId="account.profile">
        <div className="flex items-center gap-4 px-4 py-4">
          <AccountAvatar avatarUrl={auth?.avatarUrl ?? null} nickname={displayName} size="lg" />
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-base font-medium text-foreground">{displayName}</p>
            {email !== null && <p className="truncate text-xs text-muted-foreground select-text">{email}</p>}
          </div>
        </div>
        <SettingsTextRow
          key={nicknameReset}
          searchId="account.profile.nickname"
          description={`${t('settings.account.nickname.description')} ${t('settings.account.nickname.rule')}`}
          value={profile.nickname ?? ''}
          placeholder={t('settings.account.nickname.placeholder')}
          maxLength={16}
          disabled={busy && pending !== 'nickname'}
          onCommit={commitNickname}
        />
      </SettingsGroup>

      {feedbackNotice}

      <BillingSyncPanel />

      <SettingsGroup searchId="account.link">
        <SettingsRow
          searchId="account.link.providers"
          control={PROVIDERS.map(provider => (
            <Button key={provider} variant="secondary" size="sm" disabled={busy} onClick={() => linkProvider(provider)}>
              {t('settings.account.link.with', { provider: PROVIDER_NAME[provider] })}
            </Button>
          ))}
        />
      </SettingsGroup>

      {backupGroup}

      <SettingsGroup searchId="account.session">
        <SettingsRow
          searchId="account.session.signOut"
          control={
            <Button variant="destructive-outline" size="sm" disabled={busy} onClick={() => void signOut()}>
              {pending === 'sign-out' ? t('settings.account.signOut.pending') : t('settings.account.signOut.button')}
            </Button>
          }
        />
        <SettingsRow
          searchId="account.session.delete"
          alignTop
          description={
            <>
              {t('settings.account.delete.description')}
              <br />
              {t('settings.account.delete.detail')}
            </>
          }
          control={
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void deleteAccount()}>
              {t('settings.account.delete.action')}
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
