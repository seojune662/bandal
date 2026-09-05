import { useEffect, useState } from 'react'
import type { Settings } from '../../../../shared/types/settings'
import { useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { PacksPanel } from './PacksPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import { CatalogPanel } from './catalog/CatalogPanel'
import { SettingsCard, ToggleRow } from './primitives'
import './settings-plugins.css'

export function PluginsCategoryPanel(): JSX.Element {
  const t = useT()
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

  return (
    <div className="settings-plugins-category">
      <SettingsCard>
        <div className="settings-card__rows">
          <ToggleRow
            label={t('settings.catalog.pluginSystem.label')}
            description={t('settings.catalog.pluginSystem.description')}
            checked={settings?.experimental.extensionRuntime ?? false}
            disabled={settings === null}
            onChange={(extensionRuntime) => {
              if (settings === null) return
              void invoke('settings:set', {
                experimental: {
                  ...settings.experimental,
                  extensionRuntime
                }
              }).catch(() => undefined)
            }}
          />
        </div>
      </SettingsCard>

      <CatalogPanel settings={settings} />

      <details className="settings-plugins-development">
        <summary>
          <span>{t('settings.catalog.development.title')}</span>
          <span className="settings-plugins-development__chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="settings-plugins-development__content">
          <section>
            <h2>{t('settings.catalog.development.extensions')}</h2>
            <ExtensionsPanel />
          </section>
          <section>
            <h2>{t('settings.catalog.development.packs')}</h2>
            <PacksPanel />
          </section>
        </div>
      </details>
    </div>
  )
}
