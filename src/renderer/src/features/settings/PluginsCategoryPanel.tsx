import { useEffect, useState } from 'react'
import type { Settings } from '../../../../shared/types/settings'
import { useT, useLocale } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { PacksPanel } from './PacksPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import { CatalogPanel } from './catalog/CatalogPanel'
import { SettingsCard, ToggleRow } from './primitives'
import './settings-plugins.css'
import { savePreference } from './savePreference'
import { MarketplacePanel } from './MarketplacePanel'
import { PluginDevelopmentPanel } from './PluginDevelopmentPanel'
import { usePluginsStore } from '../../stores/pluginsStore'

export function PluginsCategoryPanel({ searchTarget }: { searchTarget?: string | null } = {}): JSX.Element {
  const t = useT()
  const ko = useLocale() === 'ko-KR'
  const [tab, setTab] = useState<'discover' | 'installed' | 'updates' | 'developer'>('discover')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const plugins = usePluginsStore((state) => state.plugins)
  useEffect(() => {
    if (!searchTarget) return
    if (['개발자 센터', 'Developer center', '로컬 개발', 'Local development'].includes(searchTarget)) setTab('developer')
    else if (['설치됨', 'Installed'].includes(searchTarget) || plugins.some((plugin) => plugin.manifest.name === searchTarget || plugin.manifest.contributes.settings?.some((field) => field.title === searchTarget))) setTab('installed')
  }, [searchTarget, plugins])

  useEffect(() => {
    let active = true
    let pushed = false
    setLoadError(false)
    void invoke('settings:get', {})
      .then((next) => {
        if (active && !pushed) setSettings(next)
      })
      .catch(() => { if (active) setLoadError(true) })
    const unsubscribe = onPush('settings:changed', ({ settings: next }) => {
      if (active) { pushed = true; setSettings(next) }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [attempt])

  return (
    <div className="settings-plugins-category">
      {loadError && <div role="alert" className="settings-extension-feedback">
        {t('settings.plugins.error.load')}
        <button type="button" className="settings-extension-button" onClick={() => setAttempt((n) => n + 1)}>{t('settings.plugins.action.retry')}</button>
      </div>}
      <SettingsCard>
        <div className="settings-card__rows">
          <ToggleRow
            label={t('settings.catalog.pluginSystem.label')}
            description={t('settings.catalog.pluginSystem.description')}
            checked={settings?.experimental.extensionRuntime ?? false}
            disabled={settings === null || saving}
            onChange={(extensionRuntime) => {
              if (settings === null || saving) return
              setSaving(true)
              void savePreference({ experimental: { extensionRuntime } }).then((next) => {
                if (next !== null) setSettings(next)
              }).finally(() => setSaving(false))
            }}
          />
        </div>
      </SettingsCard>

      <nav className="plugin-center-nav" aria-label={ko ? '플러그인 관리' : 'Plugin center'}>
        {(['discover', 'installed', 'updates', 'developer'] as const).map((id) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
          {(ko ? { discover: '탐색', installed: '설치됨', updates: '업데이트', developer: '개발자' } : { discover: 'Discover', installed: 'Installed', updates: 'Updates', developer: 'Developer' })[id]}
        </button>)}
      </nav>
      {(tab === 'discover' || tab === 'updates') && <CatalogPanel settings={settings} updatesOnly={tab === 'updates'} />}
      {tab === 'installed' && <><ExtensionsPanel /><PacksPanel /></>}
      {tab === 'developer' && <><PluginDevelopmentPanel /><MarketplacePanel /></>}
    </div>
  )
}
