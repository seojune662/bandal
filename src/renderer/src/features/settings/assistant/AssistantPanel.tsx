import { useEffect, useState } from 'react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import type { ScreenPermissionState } from '../../../../../shared/types/screenCapture'
import type { Settings } from '../../../../../shared/types/settings'
import { useT } from '../../../i18n'
import { invoke, onPush } from '../../../lib/ipc'
import { useUiStore } from '../../../stores/uiStore'
import { RestartRequiredBanner } from '../kit/RestartRequiredBanner'
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsStack } from '../kit/SettingsKit'

function useScreenPermission(): {
  isDarwin: boolean
  screenPermission: ScreenPermissionState
} {
  const isDarwin = typeof window !== 'undefined' && window.bandal?.platform === 'darwin'
  const [screenPermission, setScreenPermission] = useState<ScreenPermissionState>('unknown')

  useEffect(() => {
    if (!isDarwin) return
    let active = true
    let receivedPush = false
    const unsubscribe = onPush('desktopAgent:permission', ({ state }) => {
      receivedPush = true
      if (active) setScreenPermission(state)
    })
    void invoke('desktopAgent:permissionStatus', {}).then(
      ({ state }) => {
        if (active && !receivedPush) setScreenPermission(state)
      },
      () => undefined
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [isDarwin])

  return { isDarwin, screenPermission }
}

/**
 * macOS Screen Recording status for the screen assistant. Granting it in
 * System Settings only reaches a running process after a relaunch, and the
 * OS keeps reporting `denied` until then — so "granted, not yet applied" is
 * indistinguishable from "never granted". The restart banner therefore
 * appears only after the user opened System Settings from here; before that
 * a denied state shows the plain hint.
 */
export function DesktopPermissionsSlot(_props: { settings: Settings }): JSX.Element | null {
  const t = useT()
  const { isDarwin, screenPermission } = useScreenPermission()
  const [openedSystemSettings, setOpenedSystemSettings] = useState(false)
  if (!isDarwin) return null

  const visibleState = screenPermission === 'unsupported' ? 'unknown' : screenPermission
  const openPermissionSettings = (): void => {
    setOpenedSystemSettings(true)
    void invoke('desktopAgent:openPermissionSettings', {}).catch(() => undefined)
  }

  return (
    <SettingsRow
      searchId="assistant.screen.permission"
      label={t('settings.ai.permissions.screen.label')}
      description={t('settings.assistant.screen.permissionDescription')}
      badge={
        <Badge
          variant={visibleState === 'granted' ? 'success' : visibleState === 'denied' ? 'destructive' : 'outline'}
          data-state={visibleState}
        >
          {t(`settings.ai.permissions.screen.${visibleState}`)}
        </Badge>
      }
      control={
        <Button variant="secondary" size="sm" onClick={openPermissionSettings}>
          {t('settings.ai.permissions.screen.open')}
        </Button>
      }
      {...(visibleState === 'denied'
        ? {
            footer: openedSystemSettings ? (
              <RestartRequiredBanner pending>{t('settings.ai.permissions.screen.restartPending')}</RestartRequiredBanner>
            ) : (
              <SettingsNotice tone="info">{t('settings.ai.permissions.screen.restartHint')}</SettingsNotice>
            )
          }
        : {})}
    />
  )
}

export function AssistantPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  return (
    <SettingsStack>
      <SettingsGroup searchId="assistant.screen">
        {settings !== null && <DesktopPermissionsSlot settings={settings} />}
        <SettingsRow
          searchId="assistant.screen.systemPermissions"
          control={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => useUiStore.getState().openSettings('permissions')}
            >
              {t('settings.assistant.permissions.open')}
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsStack>
  )
}
