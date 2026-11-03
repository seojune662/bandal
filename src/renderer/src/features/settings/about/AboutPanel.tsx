import { useEffect } from 'react'

import type { UpdateStatus } from '../../../../../shared/types/update'
import { BandalMark } from '../../../components/BandalMark'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { useLocale, useT } from '../../../i18n'
import { useUpdateStore } from '../../../stores/updateStore'
import { SettingsGroup, SettingsRow, SettingsStack } from '../kit/SettingsKit'

const BADGE_VARIANT: Record<UpdateStatus['phase'], BadgeVariant> = {
  unsupported: 'default',
  idle: 'default',
  checking: 'info',
  available: 'success',
  downloading: 'info',
  ready: 'success',
  error: 'destructive'
}

function UpdateGroup({ status }: { status: UpdateStatus }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const check = useUpdateStore(state => state.check)
  const download = useUpdateStore(state => state.download)
  const install = useUpdateStore(state => state.install)

  const badgeLabel =
    status.phase === 'checking'
      ? t('settings.update.checking')
      : status.phase === 'downloading'
        ? t('settings.update.downloading', { percent: status.percent })
        : status.phase === 'available'
          ? t('settings.update.available')
          : status.phase === 'ready'
            ? t('settings.update.ready')
            : status.phase === 'error'
              ? t('settings.update.failed')
              : status.phase === 'idle'
                ? t('settings.update.current')
                : null

  const checkButton = (
    <Button
      variant="secondary"
      size="sm"
      disabled={status.phase === 'checking'}
      onClick={() => void check()}
    >
      {t(status.phase === 'checking' ? 'settings.update.checkingButton' : 'settings.update.check')}
    </Button>
  )

  const row = ((): { label: string; description: string; control?: JSX.Element } => {
    switch (status.phase) {
      case 'available':
        return {
          label: t('settings.update.availableTitle', { version: status.version }),
          description: t('settings.update.availableHelp'),
          control: (
            <Button variant="secondary" size="sm" onClick={() => void download()}>
              {t('settings.update.download')}
            </Button>
          )
        }
      case 'downloading':
        return {
          label: t('settings.update.downloadingTitle', { version: status.version }),
          description: t('settings.update.downloadingHelp', { percent: status.percent })
        }
      case 'ready':
        return {
          label: t('settings.update.readyTitle', { version: status.version }),
          description: t('settings.update.readyHelp'),
          control: (
            <Button size="sm" onClick={() => void install()}>
              {t('settings.update.restart')}
            </Button>
          )
        }
      case 'error':
        return { label: t('settings.update.errorTitle'), description: status.message, control: checkButton }
      case 'unsupported':
        return {
          label: t('settings.update.currentVersion', { version: status.currentVersion }),
          description: t('settings.update.unsupported')
        }
      case 'idle':
      case 'checking':
        return {
          label: t('settings.update.currentVersion', { version: status.currentVersion }),
          description:
            status.phase === 'idle' && status.lastCheckedAt !== null
              ? t('settings.update.lastChecked', {
                  time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
                    new Date(status.lastCheckedAt)
                  )
                })
              : t('settings.update.automatic'),
          control: checkButton
        }
      default:
        // An unknown phase (newer main, malformed push) must not crash settings.
        return { label: t('settings.update.currentVersion', { version: (status as { currentVersion?: string }).currentVersion ?? '—' }), description: t('settings.update.automatic'), control: checkButton }
    }
  })()

  return (
    <SettingsGroup
      searchId="about.update"
      {...(badgeLabel !== null
        ? { action: <Badge variant={BADGE_VARIANT[status.phase]}>{badgeLabel}</Badge> }
        : {})}
    >
      <SettingsRow
        searchId="about.update.check"
        label={row.label}
        description={row.description}
        {...(row.control !== undefined ? { control: row.control } : {})}
      />
    </SettingsGroup>
  )
}

export function AboutPanel(): JSX.Element {
  const t = useT()
  const status = useUpdateStore(state => state.status)
  const init = useUpdateStore(state => state.init)

  useEffect(() => {
    init()
  }, [init])

  return (
    <SettingsStack>
      <SettingsGroup searchId="about.app" bare>
        <div className="flex items-center gap-4 rounded-lg border border-border bg-card/60 px-5 py-4">
          <BandalMark size={48} title={t('settings.app.name')} />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground select-text">
              {t('settings.about.version', { version: status?.currentVersion ?? '—' })}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.about.footer')}</p>
          </div>
        </div>
      </SettingsGroup>
      {status !== null && <UpdateGroup status={status} />}
    </SettingsStack>
  )
}
