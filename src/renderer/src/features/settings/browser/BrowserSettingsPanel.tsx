import { useEffect, useState, type FormEvent } from 'react'
import { ZOOM_LEVELS, zoomPercent } from '../../../../../shared/browserZoom'
import {
  SEARCH_ENGINE_NAMES,
  SEARCH_ENGINES,
  type SearchEngineId
} from '../../../../../shared/search'
import type {
  BrowserSettings,
  LinkRouting,
  Settings
} from '../../../../../shared/types/settings'
import { showToast } from '../../../app/toast'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { AgentAccessPanel } from '../AgentAccessPanel'
import { BrowsingDataPanel } from '../BrowsingDataPanel'
import { SettingsCard, ToggleRow } from '../primitives'
import './browser-settings.css'

const LINK_ROUTINGS: readonly LinkRouting[] = ['in-app', 'system']

function saveBrowserSettings(
  settings: Settings | null,
  patch: Partial<BrowserSettings>
): void {
  if (settings === null) return
  void invoke('settings:set', {
    browser: { ...settings.browser, ...patch }
  })
}

function AgentUseSection({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  const enabled = settings?.browser.agentUse ?? false
  return (
    <>
      <SettingsCard>
        <ToggleRow
          label={t('settings.browser.agentUse.label')}
          description={t('settings.browser.agentUse.description')}
          checked={enabled}
          disabled={settings === null}
          onChange={(agentUse) => saveBrowserSettings(settings, { agentUse })}
        />
      </SettingsCard>
      <div className={!enabled ? 'settings-browser__dimmed' : ''}>
        <AgentAccessPanel />
      </div>
    </>
  )
}

function HomePageCard({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  const [homePage, setHomePage] = useState('')
  const [savingHomePage, setSavingHomePage] = useState(false)
  useEffect(() => {
    setHomePage(settings?.browser.homePage ?? '')
  }, [settings?.browser.homePage])
  const saveHomePage = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (settings === null || savingHomePage) return
    setSavingHomePage(true)
    void invoke('settings:set', {
      browser: { ...settings.browser, homePage }
    })
      .then((nextSettings) => {
        setHomePage(nextSettings.browser.homePage)
        if (nextSettings.browser.homePage !== homePage) {
          showToast(t('settings.browser.homePage.invalid'), 'danger')
        }
      })
      .finally(() => setSavingHomePage(false))
  }
  return (
    <SettingsCard
      title={t('settings.browser.homePage.title')}
      description={t('settings.browser.homePage.description')}
    >
      <form className="directory-field" noValidate onSubmit={saveHomePage}>
        <input
          type="url"
          aria-label={t('settings.browser.homePage.label')}
          placeholder="https://"
          value={homePage}
          disabled={settings === null || savingHomePage}
          onChange={(event) => setHomePage(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="secondary-button"
          disabled={settings === null || savingHomePage}
        >
          {savingHomePage
            ? t('settings.browser.homePage.saving')
            : t('settings.browser.homePage.save')}
        </button>
      </form>
    </SettingsCard>
  )
}

function SearchEngineCard({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  return (
    <SettingsCard
      title={t('settings.browser.search.title')}
      description={t('settings.browser.search.description')}
    >
      <div className="settings-card__rows">
        <div className="setting-row">
          <div className="setting-row__copy">
            <span className="setting-row__label">
              {t('settings.browser.search.label')}
            </span>
          </div>
          <select
            className="language-select"
            aria-label={t('settings.browser.search.label')}
            value={settings?.browserSearchEngine ?? 'google'}
            disabled={settings === null}
            onChange={(event) => {
              void invoke('settings:set', {
                browserSearchEngine: event.currentTarget.value as SearchEngineId
              })
            }}
          >
            {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
              <option key={id} value={id}>
                {SEARCH_ENGINE_NAMES[id]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </SettingsCard>
  )
}

function DefaultZoomCard({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  return (
    <SettingsCard title={t('settings.browser.zoom.title')}>
      <div className="settings-card__rows">
        <div className="setting-row">
          <div className="setting-row__copy">
            <span className="setting-row__label">
              {t('settings.browser.zoom.label')}
            </span>
            <span className="setting-row__description">
              {t('settings.browser.zoom.description')}
            </span>
          </div>
          <select
            className="language-select"
            aria-label={t('settings.browser.zoom.label')}
            value={settings?.browser.defaultZoomLevel ?? 0}
            disabled={settings === null}
            onChange={(event) =>
              saveBrowserSettings(settings, {
                defaultZoomLevel: Number(event.currentTarget.value)
              })
            }
          >
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {zoomPercent(level)}%
              </option>
            ))}
          </select>
        </div>
      </div>
    </SettingsCard>
  )
}

function LinkRoutingCard({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const t = useT()
  const selected = settings?.browser.linkRouting
  const modifierHint =
    typeof window !== 'undefined' && window.bandal?.platform === 'darwin'
      ? t('settings.browser.linkRouting.modifier.mac')
      : t('settings.browser.linkRouting.modifier.other')
  return (
    <SettingsCard title={t('settings.browser.linkRouting.title')}>
      <div className="settings-card__rows">
        <div className="setting-row">
          <div className="setting-row__copy">
            <span className="setting-row__label">
              {t('settings.browser.linkRouting.label')}
            </span>
            <span className="setting-row__description">{modifierHint}</span>
          </div>
          <div className="segmented settings-browser__segmented">
            {LINK_ROUTINGS.map((routing) => (
              <button
                key={routing}
                type="button"
                className={`segmented__option${
                  selected === routing ? ' segmented__option--selected' : ''
                }`}
                aria-pressed={selected === routing}
                disabled={settings === null}
                onClick={() =>
                  saveBrowserSettings(settings, { linkRouting: routing })
                }
              >
                <span className="segmented__label">
                  {t(`settings.browser.linkRouting.${routing}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsCard>
  )
}

export function BrowserSettingsPanel({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  return (
    <div className="settings-stack">
      <AgentUseSection settings={settings} />
      <HomePageCard settings={settings} />
      <SearchEngineCard settings={settings} />
      <DefaultZoomCard settings={settings} />
      <LinkRoutingCard settings={settings} />
      <BrowsingDataPanel settings={settings} />
    </div>
  )
}
