import { useEffect, useState } from 'react'
import type { Settings } from '../../../../shared/types/settings'
import { useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { useUiStore } from '../../stores/uiStore'
import { PacksPanel } from './PacksPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import './settings-plugins.css'

type PluginsView = 'packs' | 'extensions'

export function PluginsCategoryPanel(): JSX.Element {
  const t = useT()
  const [view, setView] = useState<PluginsView>('packs')
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    let active = true
    void invoke('settings:get', {})
      .then((next) => {
        if (active) setSettings(next)
      })
      .catch(() => undefined)
    const unsubscribe = onPush('settings:changed', ({ settings: next }) => {
      if (active) setSettings(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const extensionRuntimeDisabled =
    settings?.experimental.extensionRuntime === false

  return (
    <div className="settings-plugins-category">
      <div
        className="settings-plugins-segments"
        role="tablist"
        aria-label={t('settings.plugins.view.label')}
      >
        {(['packs', 'extensions'] as const).map((id) => (
          <button
            key={id}
            id={`settings-plugins-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={view === id}
            aria-controls={`settings-plugins-panel-${id}`}
            onClick={() => setView(id)}
          >
            {t(`settings.plugins.view.${id}`)}
          </button>
        ))}
      </div>
      <div
        id={`settings-plugins-panel-${view}`}
        role="tabpanel"
        aria-labelledby={`settings-plugins-tab-${view}`}
      >
        {view === 'packs' ? (
          <PacksPanel />
        ) : extensionRuntimeDisabled ? (
          <div className="inline-notice" role="status">
            <span>{t('settings.plugins.extensionRuntime.disabled')}</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                useUiStore.getState().openSettings('experimental')
              }
            >
              {t('settings.plugins.extensionRuntime.openExperimental')}
            </button>
          </div>
        ) : (
          <ExtensionsPanel />
        )}
      </div>
    </div>
  )
}
