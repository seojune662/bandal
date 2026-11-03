/**
 * Browser data: which sites the student is signed in to, their remembered
 * permissions, and how to forget any of it.
 *
 * `browser:sessionSites` / `browser:clearSession` were fully implemented in
 * main but had ZERO renderer callers — a working feature nobody could reach.
 * This is where they surface.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import type { Settings } from '../../../../shared/types/settings'
import { SettingsGroup, SettingsRow } from './kit/SettingsKit'

interface SignedInSite {
  origin: string
  cookieCount: number
}

interface SitePermission {
  id: string
  origin: string
  permission: string
  decision: 'granted' | 'denied'
  decidedAt: string
}

/** Same copy the prompt used, so the list reads back as what was asked. */
const PERMISSION_KEYS: Record<string, string> = {
  notifications: 'notifications',
  geolocation: 'geolocation',
  media: 'media',
  mediaKeySystem: 'mediaKeySystem',
  'clipboard-read': 'clipboardRead',
  'display-capture': 'displayCapture',
  midi: 'midi',
  midiSysex: 'midi',
  'window-management': 'windowManagement',
  popups: 'popups'
}

/** Loading / error / empty / list states shared by both lists. */
function SiteList<T>({
  items,
  error,
  errorText,
  emptyText,
  onRetry,
  renderItem
}: {
  items: T[] | null
  error: boolean
  errorText: string
  emptyText: string
  onRetry: () => void
  renderItem: (item: T) => ReactNode
}): JSX.Element {
  const t = useT()
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-destructive">
        <span>{errorText}</span>
        <Button variant="secondary" size="xs" onClick={onRetry}>
          {t('settings.browser.retry')}
        </Button>
      </div>
    )
  }
  if (items === null) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.browser.loading')}</p>
  }
  if (items.length === 0) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">{emptyText}</p>
  }
  return <ul className="divide-y divide-border">{items.map(renderItem)}</ul>
}

function SiteListItem({ children, action }: { children: ReactNode; action: ReactNode }): JSX.Element {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground select-text">{children}</span>
      {action}
    </li>
  )
}

export function BrowsingDataPanel({
  profileId = 'default',
  settings: _settings
}: {
  profileId?: string
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  const [sites, setSites] = useState<SignedInSite[] | null>(null)
  const [permissions, setPermissions] = useState<SitePermission[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [sitesError, setSitesError] = useState(false)
  const [permissionsError, setPermissionsError] = useState(false)

  const loadSites = useCallback(() => {
    setSitesError(false)
    setSites(null)
    void invoke('browser:sessionSites', { profileId })
      .then((result) => setSites(result.sites))
      .catch(() => setSitesError(true))
  }, [profileId])

  const loadPermissions = useCallback(() => {
    setPermissionsError(false)
    setPermissions(null)
    void invoke('browser:sitePermissions', { profileId })
      .then((result) => setPermissions(result.permissions))
      .catch(() => setPermissionsError(true))
  }, [profileId])

  useEffect(() => loadSites(), [loadSites])
  useEffect(() => loadPermissions(), [loadPermissions])

  const forgetPermission = (id: string | null): void => {
    setBusy(id ?? 'permissions')
    void invoke('browser:forgetPermission', { profileId, id })
      .then(() => {
        setFeedback(
          id === null
            ? t('settings.browser.permissions.clearedAll')
            : t('settings.browser.permissions.cleared')
        )
        loadPermissions()
      })
      .catch(() => setFeedback(t('settings.browser.permissions.clearFailed')))
      .finally(() => setBusy(null))
  }

  const forget = (origin: string | null): void => {
    setBusy(origin ?? '*')
    void invoke('browser:clearSession', { profileId, origin })
      .then(() => {
        setFeedback(
          origin === null
            ? t('settings.browser.sites.signedOutAll')
            : t('settings.browser.sites.signedOut', { origin })
        )
        loadSites()
      })
      .catch(() => setFeedback(t('settings.browser.sites.signOutFailed')))
      .finally(() => setBusy(null))
  }

  /**
   * Cookies were never the whole story: an LMS keeps its token in
   * localStorage and a Canvas-style SPA restores from IndexedDB, so
   * "로그아웃" left the student logged in. A stale service worker serves an
   * old bundle forever, which is the "저만 깨져요" report with no fix.
   */
  const clearStorage = (): void => {
    setBusy('storage')
    void invoke('browser:clearStorage', { profileId, origin: null, cache: true })
      .then(() => {
        setFeedback(t('settings.browser.sites.storageCleared'))
        loadSites()
      })
      .catch(() => setFeedback(t('settings.browser.sites.storageFailed')))
      .finally(() => setBusy(null))
  }

  const clearHistory = (): void => {
    setBusy('history')
    void invoke('browser:clearHistory', { profileId, courseId: null })
      .then(() => setFeedback(t('settings.browser.sites.historyCleared')))
      .catch(() => setFeedback(t('settings.browser.sites.historyFailed')))
      .finally(() => setBusy(null))
  }

  const permissionLabel = (permission: string): string => {
    const key = PERMISSION_KEYS[permission]
    return key === undefined ? permission : t(`settings.browser.permissions.kind.${key}`)
  }
  const noSites = (sites?.length ?? 0) === 0
  const noPermissions = (permissions?.length ?? 0) === 0

  return (
    <>
      <SettingsGroup searchId="browser.sites">
        <SiteList
          items={sites}
          error={sitesError}
          errorText={t('settings.browser.sites.loadFailed')}
          emptyText={t('settings.browser.sites.empty')}
          onRetry={loadSites}
          renderItem={(site) => (
            <SiteListItem
              key={site.origin}
              action={
                <Button variant="secondary" size="xs" disabled={busy !== null} onClick={() => forget(site.origin)}>
                  {t('settings.browser.sites.signOut')}
                </Button>
              }
            >
              {site.origin}
            </SiteListItem>
          )}
        />
        <SettingsRow
          searchId="browser.sites.signOutAll"
          disabled={noSites}
          disabledReason={t('settings.browser.sites.signOutAllDisabled')}
          control={
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={busy !== null || noSites}
              onClick={() => forget(null)}
            >
              {t('settings.browser.sites.signOutAllAction')}
            </Button>
          }
        />
        <SettingsRow
          searchId="browser.sites.clearHistory"
          control={
            <Button variant="destructive-outline" size="sm" disabled={busy !== null} onClick={clearHistory}>
              {t('settings.browser.sites.clearHistoryAction')}
            </Button>
          }
        />
        <SettingsRow
          searchId="browser.sites.clearStorage"
          control={
            <Button variant="destructive-outline" size="sm" disabled={busy !== null} onClick={clearStorage}>
              {t('settings.browser.sites.clearStorageAction')}
            </Button>
          }
        />
        <p className="px-4 py-2 text-xs text-muted-foreground empty:hidden" aria-live="polite">
          {feedback ?? ''}
        </p>
      </SettingsGroup>

      <SettingsGroup searchId="browser.permissions">
        <SiteList
          items={permissions}
          error={permissionsError}
          errorText={t('settings.browser.permissions.loadFailed')}
          emptyText={t('settings.browser.permissions.empty')}
          onRetry={loadPermissions}
          renderItem={(entry) => (
            <SiteListItem
              key={entry.id}
              action={
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => forgetPermission(entry.id)}
                >
                  {t('settings.browser.permissions.clear')}
                </Button>
              }
            >
              {entry.origin} · {permissionLabel(entry.permission)}
              {' · '}
              {entry.decision === 'granted'
                ? t('settings.browser.permissions.granted')
                : t('settings.browser.permissions.denied')}
            </SiteListItem>
          )}
        />
        <SettingsRow
          searchId="browser.permissions.clearAll"
          disabled={noPermissions}
          disabledReason={t('settings.browser.permissions.clearAllDisabled')}
          control={
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={busy !== null || noPermissions}
              onClick={() => forgetPermission(null)}
            >
              {t('settings.browser.permissions.clearAllAction')}
            </Button>
          }
        />
      </SettingsGroup>
    </>
  )
}
