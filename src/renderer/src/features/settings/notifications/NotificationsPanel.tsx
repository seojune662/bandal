import { useId, useState } from 'react'
import { BellOff, Check } from 'lucide-react'

import { showToast } from '../../../app/toast'
import { Button } from '../../../components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import {
  DEADLINE_LEAD_DAYS,
  type DeadlineLeadDays,
  type NotificationSettings,
  type Settings
} from '../../../../../shared/types/settings'
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsStack, SettingsSwitchRow } from '../kit/SettingsKit'
import { useIsSettingsSearching } from '../kit/SettingsSearchContext'

const LEAD_DAY_OPTIONS: readonly DeadlineLeadDays[] = [...DEADLINE_LEAD_DAYS].reverse()

type SaveNotifications = (patch: Partial<NotificationSettings>) => void

export function toggleLeadDay(
  current: readonly DeadlineLeadDays[],
  day: DeadlineLeadDays
): readonly DeadlineLeadDays[] {
  const selected = new Set(current)
  if (selected.has(day)) selected.delete(day)
  else selected.add(day)
  return LEAD_DAY_OPTIONS.filter(option => selected.has(option))
}

function NotificationsLoading(): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t('settings.notifications.loading')}>
      {[0, 1, 2].map(index => (
        <span key={index} className="h-14 animate-pulse rounded-lg bg-secondary" />
      ))}
    </div>
  )
}

function NotificationStatus({ enabled }: { enabled: boolean }): JSX.Element {
  const t = useT()
  return (
    <SettingsNotice icon={enabled ? <Check /> : <BellOff />}>
      <strong className="font-medium text-foreground">
        {t(enabled ? 'settings.notifications.status.enabled' : 'settings.notifications.status.disabled')}
      </strong>
      {enabled && <span className="ml-2">{t('settings.notifications.status.enabledDescription')}</span>}
    </SettingsNotice>
  )
}

/** Compact multi-toggle for 7/3/1 days before; order follows LEAD_DAY_OPTIONS. */
function LeadDaysRow({
  notifications,
  onSave
}: {
  notifications: NotificationSettings
  onSave: SaveNotifications
}): JSX.Element {
  const t = useT()
  const labelId = useId()
  const disabled = !notifications.enabled || !notifications.deadlines
  const current = notifications.deadlineLeadDays
  return (
    <SettingsRow
      searchId="notifications.alerts.leadDays"
      labelId={labelId}
      disabled={disabled}
      disabledReason={t(
        notifications.enabled
          ? 'settings.notifications.deadlines.leadDaysDisabled'
          : 'settings.notifications.disabledReason'
      )}
      control={
        <ToggleGroup
          type="multiple"
          aria-labelledby={labelId}
          disabled={disabled}
          value={current.map(String)}
          onValueChange={values => {
            const changed = LEAD_DAY_OPTIONS.find(day => values.includes(String(day)) !== current.includes(day))
            if (changed !== undefined) onSave({ deadlineLeadDays: toggleLeadDay(current, changed) })
          }}
        >
          {LEAD_DAY_OPTIONS.map(day => (
            <ToggleGroupItem key={day} value={String(day)}>
              {t(`settings.notifications.deadlines.leadDay.${day}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    />
  )
}

function AlertsGroup({
  notifications,
  onSave
}: {
  notifications: NotificationSettings
  onSave: SaveNotifications
}): JSX.Element {
  const t = useT()
  const off = !notifications.enabled
  const child = { disabled: off, disabledReason: t('settings.notifications.disabledReason') }
  return (
    <SettingsGroup searchId="notifications.alerts">
      <SettingsSwitchRow
        searchId="notifications.alerts.enabled"
        checked={notifications.enabled}
        onChange={enabled => onSave({ enabled })}
      />
      <SettingsSwitchRow
        searchId="notifications.alerts.deadlines"
        {...child}
        checked={notifications.deadlines}
        onChange={deadlines => onSave({ deadlines })}
      />
      <LeadDaysRow notifications={notifications} onSave={onSave} />
      <SettingsSwitchRow
        searchId="notifications.alerts.agentComplete"
        {...child}
        checked={notifications.agentComplete}
        onChange={agentComplete => onSave({ agentComplete })}
      />
      <SettingsSwitchRow
        searchId="notifications.alerts.downloads"
        {...child}
        checked={notifications.downloads}
        onChange={downloads => onSave({ downloads })}
      />
      <SettingsSwitchRow
        searchId="notifications.alerts.pluginNotices"
        {...child}
        checked={notifications.pluginNotices}
        onChange={pluginNotices => onSave({ pluginNotices })}
      />
    </SettingsGroup>
  )
}

function BehaviorGroup({
  notifications,
  testing,
  onSave,
  onTest
}: {
  notifications: NotificationSettings
  testing: boolean
  onSave: SaveNotifications
  onTest: () => void
}): JSX.Element {
  const t = useT()
  return (
    <SettingsGroup searchId="notifications.behavior">
      <SettingsSwitchRow
        searchId="notifications.behavior.sound"
        checked={notifications.sound}
        onChange={sound => onSave({ sound })}
      />
      <SettingsSwitchRow
        searchId="notifications.behavior.suppressWhileFocused"
        checked={notifications.suppressWhileFocused}
        onChange={suppressWhileFocused => onSave({ suppressWhileFocused })}
      />
      <SettingsRow
        searchId="notifications.behavior.test"
        control={
          <Button variant="secondary" size="sm" disabled={testing} onClick={onTest}>
            {t(testing ? 'settings.notifications.test.sending' : 'settings.notifications.test.send')}
          </Button>
        }
      />
    </SettingsGroup>
  )
}

export function NotificationsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const searching = useIsSettingsSearching()
  if (settings === null) return <NotificationsLoading />

  const save: SaveNotifications = patch => {
    void invoke('settings:set', {
      notifications: patch
    }).catch(() => showToast(t('settings.notifications.saveFailed'), 'danger'))
  }
  const sendTestNotification = (): void => {
    if (testing) return
    setTesting(true)
    void invoke('notifications:test', {})
      .then(result => {
        if (result.ok) showToast(t('settings.notifications.test.sent'))
        else if (result.reason === 'unsupported') {
          showToast(t('settings.notifications.test.unsupported'), 'danger')
        } else showToast(t('settings.notifications.test.failed'), 'danger')
      })
      .catch(() => showToast(t('settings.notifications.test.failed'), 'danger'))
      .finally(() => setTesting(false))
  }

  return (
    <SettingsStack>
      {!searching && <NotificationStatus enabled={settings.notifications.enabled} />}
      <AlertsGroup notifications={settings.notifications} onSave={save} />
      <BehaviorGroup
        notifications={settings.notifications}
        testing={testing}
        onSave={save}
        onTest={sendTestNotification}
      />
    </SettingsStack>
  )
}
