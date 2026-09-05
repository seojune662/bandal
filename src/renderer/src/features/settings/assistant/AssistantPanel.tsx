import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ScreenPermissionState } from '../../../../../shared/types/overlay'
import type { Settings } from '../../../../../shared/types/settings'
import { useT } from '../../../i18n'
import { invoke, onPush } from '../../../lib/ipc'
import { useUiStore } from '../../../stores/uiStore'
import { SettingsCard, ToggleRow } from '../primitives'
import './assistant-panel.css'

const ASSISTANT_MODES = ['in-app', 'desktop'] as const
type AssistantMode = Settings['assistantMode']

function useScreenPermission(): {
  isDarwin: boolean
  screenPermission: ScreenPermissionState
} {
  const isDarwin =
    typeof window !== 'undefined' && window.bandal?.platform === 'darwin'
  const [screenPermission, setScreenPermission] =
    useState<ScreenPermissionState>('unknown')

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

export function DesktopPermissionsSlot(
  _props: { settings: Settings }
): JSX.Element | null {
  const t = useT()
  const { isDarwin, screenPermission } = useScreenPermission()
  if (!isDarwin) return null

  const visibleState =
    screenPermission === 'unsupported' ? 'unknown' : screenPermission
  const openPermissionSettings = (): void => {
    void invoke('desktopAgent:openPermissionSettings', {}).catch(() => undefined)
  }

  return (
    <div className="setting-row">
      <div className="setting-row__copy">
        <div className="setting-row__label-line">
          <span className="setting-row__label">
            {t('settings.ai.permissions.screen.label')}
          </span>
          <span
            className={`status-pill${
              visibleState === 'granted' ? ' status-pill--ready' : ''
            }`}
            data-state={visibleState}
          >
            <span className="status-pill__dot" />
            {t(`settings.ai.permissions.screen.${visibleState}`)}
          </span>
        </div>
        {visibleState === 'denied' && (
          <span className="setting-row__description">
            {t('settings.ai.permissions.screen.restartHint')}
          </span>
        )}
      </div>
      <button
        type="button"
        className="secondary-button"
        onClick={openPermissionSettings}
      >
        {t('settings.ai.permissions.screen.open')}
      </button>
    </div>
  )
}

function modeForKey(key: string, current: AssistantMode): AssistantMode | null {
  if (
    key === 'ArrowLeft' ||
    key === 'ArrowUp' ||
    key === 'ArrowRight' ||
    key === 'ArrowDown'
  ) {
    return current === 'in-app' ? 'desktop' : 'in-app'
  }
  if (key === 'Home') return 'in-app'
  if (key === 'End') return 'desktop'
  return null
}

function OrbModePicker({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  const selectMode = (assistantMode: AssistantMode): void => {
    if (settings === null || settings.assistantMode === assistantMode) return
    void invoke('settings:set', { assistantMode }).catch(() => undefined)
  }
  const handleModeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (settings === null) return
    const next = modeForKey(event.key, settings.assistantMode)
    if (next === null) return
    event.preventDefault()
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)
      ?.focus()
    selectMode(next)
  }

  return (
    <div
      className="segmented settings-assistant-mode"
      role="radiogroup"
      aria-label={t('settings.ai.orb.mode.selectLabel')}
      aria-disabled={settings === null}
      onKeyDown={handleModeKeyDown}
    >
      {ASSISTANT_MODES.map((option) => {
        const selected = settings?.assistantMode === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            data-mode={option}
            aria-checked={selected}
            disabled={settings === null}
            tabIndex={selected ? 0 : -1}
            className={`segmented__option${
              selected ? ' segmented__option--selected' : ''
            }`}
            onClick={() => selectMode(option)}
          >
            {t(
              `settings.ai.orb.mode.${
                option === 'in-app' ? 'inApp' : 'desktop'
              }`
            )}
          </button>
        )
      })}
    </div>
  )
}

function OrbCard({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const toggleKeepAlive = (keepAliveOnClose: boolean): void => {
    if (settings === null) return
    void invoke('settings:set', {
      desktopOrb: { ...settings.desktopOrb, keepAliveOnClose }
    }).catch(() => undefined)
  }

  return (
    <SettingsCard
      title={t('settings.ai.orb.title')}
      description={t('settings.ai.orb.description')}
    >
      <div className="settings-card__rows">
        <div className="setting-row">
          <div className="setting-row__copy">
            <OrbModePicker settings={settings} />
            <span className="setting-row__description">
              {t('settings.ai.orb.mode.desktopDescription')}
            </span>
          </div>
        </div>
        <ToggleRow
          label={t('settings.ai.orb.keepAlive')}
          description={t('settings.ai.orb.keepAliveDescription')}
          checked={settings?.desktopOrb.keepAliveOnClose ?? false}
          disabled={settings?.assistantMode !== 'desktop'}
          onChange={toggleKeepAlive}
        />
      </div>
    </SettingsCard>
  )
}

function ScreenReadingCard({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  return (
    <SettingsCard
      title={t('settings.assistant.screen.title')}
      description={t('settings.assistant.screen.description')}
    >
      <div className="settings-card__rows">
        {settings !== null && <DesktopPermissionsSlot settings={settings} />}
        <div className="settings-assistant-permissions-footer">
          <button
            type="button"
            className="settings-assistant-permissions-button"
            onClick={() => useUiStore.getState().openSettings('permissions')}
          >
            {t('settings.assistant.permissions.open')}
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}

export function AssistantPanel({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  return (
    <div className="settings-stack">
      <OrbCard settings={settings} />
      <ScreenReadingCard settings={settings} />
    </div>
  )
}
