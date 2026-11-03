import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  SYSTEM_PERMISSIONS,
  type SystemPermissionId,
  type SystemPermissionState,
  type SystemPermissionStatus
} from '../../../../../shared/types/permissions'
import { showToast } from '../../../app/toast'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { SettingsGroup, SettingsRow, SettingsStack } from '../kit/SettingsKit'

type PermissionTone = 'ok' | 'danger' | 'neutral' | 'muted'

export function permissionTone(state: SystemPermissionState): PermissionTone {
  if (state === 'granted') return 'ok'
  if (state === 'denied') return 'danger'
  if (state === 'not-applicable') return 'muted'
  return 'neutral'
}

const BADGE_VARIANT: Record<PermissionTone, BadgeVariant> = {
  ok: 'success',
  danger: 'destructive',
  neutral: 'outline',
  muted: 'default'
}

function unknownStatus(id: SystemPermissionId): SystemPermissionStatus {
  return {
    id,
    state: 'unknown',
    canRequest: false,
    canOpenSettings: false
  }
}

export function PermissionStatusBadge({ state }: { state: SystemPermissionState }): JSX.Element {
  const t = useT()
  return (
    <Badge variant={BADGE_VARIANT[permissionTone(state)]} data-state={state}>
      {t(`settings.permissions.status.${state}`)}
    </Badge>
  )
}

interface PermissionRowProps {
  searchId: string
  status: SystemPermissionStatus
  pending: boolean
  error: string | undefined
  onAction: (status: SystemPermissionStatus) => void
}

function PermissionRow({ searchId, status, pending, error, onAction }: PermissionRowProps): JSX.Element {
  const t = useT()
  const canAct = status.canRequest || status.canOpenSettings
  return (
    <SettingsRow
      searchId={searchId}
      badge={<PermissionStatusBadge state={status.state} />}
      {...(canAct
        ? {
            control: (
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => onAction(status)}>
                {t(
                  pending && status.canRequest
                    ? 'settings.permissions.requesting'
                    : status.canRequest
                      ? 'settings.permissions.request'
                      : 'settings.permissions.openSettings'
                )}
              </Button>
            )
          }
        : {})}
      {...(error !== undefined
        ? {
            footer: (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )
          }
        : {})}
    />
  )
}

export function PermissionsPanel(): JSX.Element {
  const t = useT()
  const [statuses, setStatuses] = useState<SystemPermissionStatus[]>(() =>
    SYSTEM_PERMISSIONS.map(unknownStatus)
  )
  const [refreshing, setRefreshing] = useState(false)
  const [pendingId, setPendingId] = useState<SystemPermissionId | null>(null)
  const [errors, setErrors] = useState<Partial<Record<SystemPermissionId, string>>>({})

  const refresh = useCallback((): void => {
    setRefreshing(true)
    void invoke('permissions:status', {})
      .then((report) => {
        setStatuses(
          SYSTEM_PERMISSIONS.map(
            (id) => report.permissions.find((status) => status.id === id) ?? unknownStatus(id)
          )
        )
      })
      .catch(() => showToast(t('settings.permissions.refreshFailed'), 'danger'))
      .finally(() => setRefreshing(false))
  }, [t])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const runAction = (status: SystemPermissionStatus): void => {
    if (pendingId !== null) return
    setPendingId(status.id)
    setErrors((current) => ({ ...current, [status.id]: undefined }))
    const action = status.canRequest
      ? invoke('permissions:request', { id: status.id }).then((next) => {
          setStatuses((current) => current.map((item) => (item.id === next.id ? next : item)))
        })
      : invoke('permissions:openSettings', { id: status.id }).then(() => undefined)

    void action
      .catch(() => {
        setErrors((current) => ({
          ...current,
          [status.id]: t('settings.permissions.actionFailed')
        }))
      })
      .finally(() => setPendingId(null))
  }

  const rowProps = (id: SystemPermissionId): Omit<PermissionRowProps, 'searchId'> => ({
    status: statuses.find((status) => status.id === id) ?? unknownStatus(id),
    pending: pendingId === id,
    error: errors[id],
    onAction: runAction
  })

  return (
    <SettingsStack>
      <SettingsGroup
        searchId="permissions.system"
        action={
          <Button variant="ghost" size="sm" disabled={refreshing} onClick={refresh}>
            <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
            {t(refreshing ? 'settings.permissions.refreshing' : 'settings.permissions.refresh')}
          </Button>
        }
      >
        {/* Literal ids per row so the catalog test can see each one rendered. */}
        <PermissionRow searchId="permissions.system.screen" {...rowProps('screen')} />
        <PermissionRow searchId="permissions.system.accessibility" {...rowProps('accessibility')} />
        <PermissionRow searchId="permissions.system.notifications" {...rowProps('notifications')} />
        <PermissionRow searchId="permissions.system.documents" {...rowProps('documents')} />
      </SettingsGroup>
    </SettingsStack>
  )
}
