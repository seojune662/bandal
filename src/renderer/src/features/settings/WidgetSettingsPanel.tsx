import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { type Settings, type WidgetId } from '../../../../shared/types/settings'
import { showToast } from '../../app/toast'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { Switch } from '../../components/ui/switch'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { useUniversityStore } from '../../stores/universityStore'
import { SettingsGroup, SettingsRow, SettingsSelectRow, SettingsStack, SettingsTextRow } from './kit/SettingsKit'
import { savePreference } from './savePreference'

/** Radix Select cannot hold an empty value; this stands for `mailServiceId: null`. */
const FIRST_MAIL_SERVICE = '__first__'

/** Mirrors main's sanitizeHomePage: an empty field clears, anything else must be http(s). */
function isMailUrl(value: string): boolean {
  if (value === '') return true
  if (value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function WidgetRow({
  searchId,
  description,
  enabled,
  position,
  count,
  disabled,
  onToggle,
  onMove
}: {
  searchId: string
  description: string
  enabled: boolean
  position: number
  count: number
  disabled: boolean
  onToggle: (next: boolean) => void
  onMove: (delta: -1 | 1) => void
}): JSX.Element {
  const t = useT()
  const labelId = useId()
  return (
    <SettingsRow
      searchId={searchId}
      description={description}
      labelId={labelId}
      control={
        <>
          {enabled && count > 1 && (
            <div className="flex items-center gap-0.5" role="group" aria-label={t('settings.widgets.order')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.widgets.moveUp')}
                disabled={position === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.widgets.moveDown')}
                disabled={position === count - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown />
              </Button>
            </div>
          )}
          <Switch checked={enabled} disabled={disabled} aria-labelledby={labelId} onCheckedChange={onToggle} />
        </>
      }
    />
  )
}

export function WidgetSettingsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  // The Gmail mailbox waits on Google's restricted-scope review (BANDAL_GMAIL_UI).
  const gmail = window.bandal?.gmailUi === true
  const services = useUniversityStore(state => state.services)
  const initUniversity = useUniversityStore(state => state.init)
  const widgets = settings?.widgets
  // The account of a saved Gmail sign-in, so it can be removed even while the mailbox is hidden.
  const [gmailAccount, setGmailAccount] = useState<string | null>(null)

  useEffect(() => void initUniversity(), [initUniversity])
  useEffect(
    () =>
      void invoke('mail:state', {})
        .then(account => setGmailAccount(account.email))
        .catch(() => {}),
    []
  )

  const mailServices = useMemo(() => services.filter(service => service.kind === 'mail'), [services])
  const ordered = widgets?.enabled ?? []

  const toggle = (id: WidgetId, enabled: boolean): void => {
    if (widgets === undefined) return
    const next = enabled ? [...ordered, id] : ordered.filter(candidate => candidate !== id)
    void savePreference({
      widgets: {
        enabled: next,
        active: next.includes(widgets.active) ? widgets.active : (next[0] ?? 'todo')
      }
    })
  }

  const move = (id: WidgetId, delta: -1 | 1): void => {
    if (widgets === undefined) return
    const index = ordered.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    void savePreference({ widgets: { enabled: next } })
  }

  const commitMailUrl = async (mailUrl: string): Promise<string | undefined> => {
    if (!isMailUrl(mailUrl.trim())) return t('settings.widgets.mailUrl.invalid')
    try {
      await invoke('settings:set', { widgets: { mailUrl } })
      return undefined
    } catch {
      return t('settings.widgets.mailUrl.saveFailed')
    }
  }

  const disconnectGmail = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('settings.widgets.gmail.confirmTitle'),
      description: t('settings.widgets.gmail.confirmDescription'),
      confirmLabel: t('settings.widgets.gmail.disconnect'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) return
    // Resolves only once the token file is gone.
    await invoke('mail:disconnect', {})
      .then(() => setGmailAccount(null))
      .catch(() => showToast(t('settings.widgets.gmail.disconnectFailed'), 'danger'))
  }

  const widgetRow = (id: WidgetId): Omit<Parameters<typeof WidgetRow>[0], 'searchId'> => ({
    description:
      id === 'mail' && gmail ? t('settings.widgets.mail.gmailDescription') : t(`settings.widgets.${id}.description`),
    enabled: ordered.includes(id),
    position: ordered.indexOf(id),
    count: ordered.length,
    disabled: widgets === undefined,
    onToggle: next => toggle(id, next),
    onMove: delta => move(id, delta)
  })

  return (
    <SettingsStack>
      <SettingsGroup searchId="widgets.dock">
        <WidgetRow searchId="widgets.dock.todo" {...widgetRow('todo')} />
        <WidgetRow searchId="widgets.dock.board" {...widgetRow('board')} />
        <WidgetRow searchId="widgets.dock.mail" {...widgetRow('mail')} />
      </SettingsGroup>

      <SettingsGroup
        searchId="widgets.mail"
        {...(gmail ? { description: t('settings.widgets.connection.gmailDescription') } : {})}
      >
        {mailServices.length > 0 && (
          <SettingsSelectRow
            searchId="widgets.mail.service"
            value={widgets?.mailServiceId ?? FIRST_MAIL_SERVICE}
            disabled={widgets === undefined}
            options={[
              { value: FIRST_MAIL_SERVICE, label: t('settings.widgets.mailService.first') },
              ...mailServices.map(service => ({ value: service.id, label: service.label }))
            ]}
            onChange={next =>
              void savePreference({ widgets: { mailServiceId: next === FIRST_MAIL_SERVICE ? null : next } })
            }
          />
        )}
        <SettingsTextRow
          searchId="widgets.mail.url"
          type="url"
          placeholder="https://mail.example.edu"
          value={widgets?.mailUrl ?? ''}
          disabled={widgets === undefined}
          onCommit={commitMailUrl}
        />
        {gmailAccount !== null && (
          <SettingsRow
            searchId="widgets.mail.gmail"
            description={t('settings.widgets.gmail.saved', { email: gmailAccount })}
            control={
              <Button variant="destructive-outline" size="sm" onClick={() => void disconnectGmail()}>
                {t('settings.widgets.gmail.disconnect')}
              </Button>
            }
          />
        )}
      </SettingsGroup>
    </SettingsStack>
  )
}
