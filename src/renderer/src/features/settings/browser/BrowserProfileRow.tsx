import { Button } from '../../../components/ui/button'
import { useT } from '../../../i18n'
import { useBrowserProfiles } from '../../browser/useBrowserProfiles'
import { SettingsSelectRow, type SettingsOption } from '../kit/SettingsKit'

/**
 * Which browser profile the profile-scoped settings below apply to
 * (extensions, import, site data, saved logins). Kit replacement for
 * BrowserProfileSelect inside settings; the import dialog keeps its own.
 */
export function BrowserProfileRow({
  value,
  onChange,
  searchId,
  description
}: {
  value: string
  onChange: (profileId: string) => void
  searchId?: string
  description?: string
}): JSX.Element {
  const t = useT()
  const { profiles, loading, error, refresh } = useBrowserProfiles()
  const missing = !profiles.some(profile => profile.id === value)
  const options: SettingsOption<string>[] = profiles.map(profile => ({
    value: profile.id,
    label: `${profile.icon} ${profile.name}`
  }))
  if (missing) {
    options.unshift({
      value,
      disabled: true,
      label: loading
        ? t('settings.browser.profile.loading')
        : error !== ''
          ? t('settings.browser.profile.loadFailed')
          : t('settings.browser.profile.unavailable')
    })
  }
  const footer =
    error !== '' ? (
      <div role="alert" className="flex items-center gap-3 text-xs text-destructive">
        <span>{t('settings.browser.profile.loadFailedDetail')}</span>
        <Button variant="secondary" size="xs" onClick={() => void refresh()}>
          {t('settings.browser.retry')}
        </Button>
      </div>
    ) : !loading && missing ? (
      <p role="alert" className="text-xs text-destructive">
        {t('settings.browser.profile.missing')}
      </p>
    ) : undefined
  return (
    <SettingsSelectRow
      {...(searchId !== undefined ? { searchId } : {})}
      {...(searchId === undefined ? { label: t('settings.browser.profile.select') } : {})}
      description={description ?? t('settings.browser.profile.selectDescription')}
      value={value}
      options={options}
      onChange={onChange}
      disabled={loading || error !== '' || profiles.length === 0}
      disabledReason={
        loading
          ? t('settings.browser.profile.loading')
          : error !== ''
            ? undefined
            : profiles.length === 0
              ? t('settings.browser.profile.none')
              : undefined
      }
      {...(footer !== undefined ? { footer } : {})}
    />
  )
}
