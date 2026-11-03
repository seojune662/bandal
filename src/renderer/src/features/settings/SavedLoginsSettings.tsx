import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { Switch } from '../../components/ui/switch'
import type {
  CredentialsAvailability,
  SavedLoginSummary,
} from '../../../../shared/types/credentials'
import { useLocale, useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { BrowserProfileRow } from './browser/BrowserProfileRow'
import { SettingsEmptyState, SettingsGroup, SettingsNotice } from './kit/SettingsKit'

function formatUpdatedAt(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    : value
}

/**
 * Saved university-portal logins, per browser profile. Rendered by the
 * University panel; pass `searchId` (a university.* catalog id) to make the
 * card searchable there.
 */
export function SavedLoginsSettings({ searchId }: { searchId?: string } = {}): JSX.Element {
  const t = useT()
  const [profileId, setProfileId] = useState('default')
  return (
    <SettingsGroup
      {...(searchId !== undefined ? { searchId } : {})}
      title={t('settings.browser.logins.title')}
      description={t('settings.browser.logins.description')}
    >
      <BrowserProfileRow
        value={profileId}
        onChange={setProfileId}
        description={t('settings.browser.logins.profileDescription')}
      />
      <ProfileSavedLogins key={profileId} profileId={profileId} />
    </SettingsGroup>
  )
}

function SavedLoginItem({
  login,
  disabled,
  onToggle,
  onForget,
}: {
  login: SavedLoginSummary
  disabled: boolean
  onToggle: (autoSubmit: boolean) => void
  onForget: () => void
}): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const switchId = useId()
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-mono text-sm font-medium text-foreground select-text">{login.origin}</p>
        <p className="truncate text-xs text-secondary-foreground select-text">{login.username}</p>
        <p className="truncate text-2xs text-muted-foreground">
          {t('settings.browser.logins.updated', { date: formatUpdatedAt(login.updatedAt, locale) })}
        </p>
      </div>
      <label htmlFor={switchId} className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('settings.browser.logins.autoSubmit')}
        <Switch
          id={switchId}
          checked={login.autoSubmit}
          aria-label={t('settings.browser.logins.autoSubmitFor', { origin: login.origin })}
          disabled={disabled}
          onCheckedChange={onToggle}
        />
      </label>
      <Button variant="destructive-outline" size="xs" disabled={disabled} onClick={onForget}>
        {t('settings.browser.logins.delete')}
      </Button>
    </li>
  )
}

function ProfileSavedLogins({ profileId }: { profileId: string }): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  const mountedRef = useRef(true)
  const [availability, setAvailability] =
    useState<CredentialsAvailability | null>(null)
  const [logins, setLogins] = useState<SavedLoginSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [pendingOrigin, setPendingOrigin] = useState<string | null>(null)

  const load = (): void => {
    setLoading(true)
    setError(false)
    setLoadFailed(false)
    void Promise.all([
      invoke('credentials:availability', { profileId }),
      invoke('credentials:list', { profileId }),
    ])
      .then(([nextAvailability, nextLogins]) => {
        if (!mountedRef.current) return
        setAvailability(nextAvailability)
        setLogins(nextLogins)
      })
      .catch(() => {
        if (mountedRef.current) { setError(true); setLoadFailed(true) }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const toggleAutoSubmit = async (
    login: SavedLoginSummary,
    autoSubmit: boolean,
  ): Promise<void> => {
    if (pendingOrigin !== null) return
    setError(false)
    setPendingOrigin(login.id)
    try {
      // Main treats an empty password as metadata-only only when this exact
      // origin already exists. The password never returns to this window.
      const saved = await invoke('credentials:save', {
        profileId,
        id: login.id,
        origin: login.origin,
        username: login.username,
        password: '',
        autoSubmit,
      })
      if (mountedRef.current) {
        setLogins((current) =>
          current.map((item) => (item.id === saved.id ? saved : item)),
        )
      }
    } catch {
      if (mountedRef.current) setError(true)
    } finally {
      if (mountedRef.current) setPendingOrigin(null)
    }
  }

  const forget = async (login: SavedLoginSummary): Promise<void> => {
    if (pendingOrigin !== null) return
    const confirmed = await confirm({
      title: t('settings.browser.logins.deleteConfirmTitle'),
      description: t('settings.browser.logins.deleteConfirm', { origin: login.origin }),
      confirmLabel: t('settings.browser.logins.delete'),
      confirmVariant: 'destructive',
    })
    if (!confirmed || !mountedRef.current) return

    setError(false)
    setPendingOrigin(login.id)
    try {
      await invoke('credentials:forget', {
        profileId,
        origin: login.origin,
        credentialId: login.id,
      })
      if (mountedRef.current) {
        setLogins((current) => current.filter((item) => item.id !== login.id))
      }
    } catch {
      if (mountedRef.current) setError(true)
    } finally {
      if (mountedRef.current) setPendingOrigin(null)
    }
  }

  return (
    <div className="px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('settings.browser.logins.autoSubmitHint')}
        </p>
        {!loading && availability?.state === 'ready' && (
          <Badge>{logins.length}</Badge>
        )}
      </div>

      {loading ? (
        <div
          aria-label={t('settings.browser.loading')}
          className="space-y-2"
        >
          <span className="block h-12 animate-pulse rounded-md bg-muted" />
          <span className="block h-12 animate-pulse rounded-md bg-muted" />
        </div>
      ) : loadFailed ? (
        <SettingsNotice
          tone="danger"
          action={
            <Button variant="secondary" size="xs" onClick={load}>
              {t('settings.browser.retry')}
            </Button>
          }
        >
          {t('settings.browser.logins.loadFailed')}
        </SettingsNotice>
      ) : availability?.state === 'unavailable' ? (
        <SettingsNotice tone="warning">
          <p className="font-medium">{t('settings.browser.logins.unavailable')}</p>
          <p>{availability.reason}</p>
          <p>{t('settings.browser.logins.unavailableDetail')}</p>
        </SettingsNotice>
      ) : logins.length === 0 ? (
        <SettingsEmptyState
          title={t('settings.browser.logins.empty')}
          description={t('settings.browser.logins.emptyDetail')}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {logins.map((login) => (
            <SavedLoginItem
              key={login.id}
              login={login}
              disabled={pendingOrigin !== null}
              onToggle={(autoSubmit) => void toggleAutoSubmit(login, autoSubmit)}
              onForget={() => void forget(login)}
            />
          ))}
        </ul>
      )}

      <p
        className={cn('mt-2 text-xs empty:hidden', error && !loadFailed ? 'text-destructive' : 'hidden')}
        aria-live="polite"
      >
        {error && !loadFailed ? t('settings.browser.logins.actionFailed') : ''}
      </p>
    </div>
  )
}
