import { useState } from 'react'
import { useT } from '../../i18n'
import { PacksPanel } from './PacksPanel'
import { ExtensionsPanel } from './ExtensionsPanel'
import './settings-plugins.css'

type PluginsView = 'packs' | 'extensions'

export function PluginsCategoryPanel(): JSX.Element {
  const t = useT()
  const [view, setView] = useState<PluginsView>('packs')

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
        {view === 'packs' ? <PacksPanel /> : <ExtensionsPanel />}
      </div>
    </div>
  )
}
