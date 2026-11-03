import { useEffect, useId, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { Switch } from '../../../components/ui/switch'
import { ZOOM_LEVELS, zoomPercent } from '../../../../../shared/browserZoom'
import { SEARCH_ENGINES, type SearchEngineId } from '../../../../../shared/search'
import type {
  BrowserSettings,
  LinkRouting,
  PopupBehavior,
  Settings
} from '../../../../../shared/types/settings'
import type { BrowserExtensionSummary } from '../../../../../shared/types/browserExtension'
import { useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { cn } from '../../../lib/utils'
import { BrowserImportDialog } from '../../browser/BrowserImportDialog'
import { AgentAccessPanel } from '../AgentAccessPanel'
import { BrowsingDataPanel } from '../BrowsingDataPanel'
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmentedRow,
  SettingsSelectRow,
  SettingsStack,
  SettingsSwitchRow,
  SettingsTextRow
} from '../kit/SettingsKit'
import { savePreference } from '../savePreference'
import { BrowserProfileRow } from './BrowserProfileRow'

const LINK_ROUTINGS: readonly LinkRouting[] = ['in-app', 'system']
const POPUP_BEHAVIORS: readonly PopupBehavior[] = ['balanced', 'strict']
const TRACKING_PROTECTIONS = ['balanced', 'strict', 'off'] as const

function saveBrowserSettings(settings: Settings | null, patch: Partial<BrowserSettings>): void {
  if (settings === null) return
  void savePreference({ browser: patch })
}

/**
 * Main rejects an unusable home page with a ValidationError (message tagged
 * `[validation]`); show that inline instead of the generic save toast.
 */
async function saveHomePage(homePage: string, t: ReturnType<typeof useT>): Promise<string | undefined> {
  try {
    await invoke('settings:set', { browser: { homePage } })
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /\[validation\]|ValidationError/.test(message)
      ? t('settings.browser.homePage.invalid')
      : t('settings.browser.homePage.saveFailed')
  }
}

function GeneralGroup({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const browser = settings?.browser
  return (
    <SettingsGroup searchId="browser.general">
      <SettingsTextRow
        searchId="browser.general.homePage"
        type="url"
        placeholder="https://"
        value={browser?.homePage ?? ''}
        disabled={settings === null}
        onCommit={(homePage) => saveHomePage(homePage, t)}
      />
      <SettingsSegmentedRow
        searchId="browser.general.searchEngine"
        value={settings?.browserSearchEngine ?? 'google'}
        disabled={settings === null}
        options={(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => ({
          value: id,
          label: t(`settings.browser.search.engine.${id}`)
        }))}
        onChange={(browserSearchEngine) => void savePreference({ browserSearchEngine })}
      />
      <SettingsSelectRow
        searchId="browser.general.zoom"
        value={String(browser?.defaultZoomLevel ?? 0)}
        disabled={settings === null}
        selectClassName="min-w-24"
        options={ZOOM_LEVELS.map((level) => ({ value: String(level), label: `${zoomPercent(level)}%` }))}
        onChange={(level) => saveBrowserSettings(settings, { defaultZoomLevel: Number(level) })}
      />
      <SettingsSwitchRow
        searchId="browser.general.swipe"
        checked={browser?.swipeNavigation ?? true}
        disabled={settings === null}
        onChange={(swipeNavigation) => saveBrowserSettings(settings, { swipeNavigation })}
      />
    </SettingsGroup>
  )
}

function LinksGroup({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const modifierHint =
    typeof window !== 'undefined' && window.bandal?.platform === 'darwin'
      ? t('settings.browser.linkRouting.modifier.mac')
      : t('settings.browser.linkRouting.modifier.other')
  return (
    <SettingsGroup searchId="browser.links">
      <SettingsSegmentedRow
        searchId="browser.links.routing"
        description={`${t('settings.browser.links.routingDescription')} ${modifierHint}`}
        value={settings?.browser.linkRouting ?? 'in-app'}
        disabled={settings === null}
        options={LINK_ROUTINGS.map((routing) => ({
          value: routing,
          label: t(`settings.browser.linkRouting.${routing}`)
        }))}
        onChange={(linkRouting) => saveBrowserSettings(settings, { linkRouting })}
      />
      <SettingsSegmentedRow
        searchId="browser.links.popups"
        value={settings?.browser.popupBehavior ?? 'balanced'}
        disabled={settings === null}
        options={POPUP_BEHAVIORS.map((behavior) => ({
          value: behavior,
          label: t(`settings.browser.popups.${behavior}`)
        }))}
        onChange={(popupBehavior) => saveBrowserSettings(settings, { popupBehavior })}
      />
    </SettingsGroup>
  )
}

function PrivacyGroup({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const browser = settings?.browser
  return (
    <SettingsGroup searchId="browser.privacy">
      <SettingsSegmentedRow
        searchId="browser.privacy.tracking"
        value={browser?.trackingProtection ?? 'balanced'}
        disabled={settings === null}
        options={TRACKING_PROTECTIONS.map((protection) => ({
          value: protection,
          label: t(`settings.browser.tracking.${protection}`)
        }))}
        onChange={(trackingProtection) => saveBrowserSettings(settings, { trackingProtection })}
      />
      <SettingsSwitchRow
        searchId="browser.privacy.dnt"
        checked={browser?.doNotTrack ?? true}
        disabled={settings === null}
        onChange={(doNotTrack) => saveBrowserSettings(settings, { doNotTrack })}
      />
    </SettingsGroup>
  )
}

function ImportGroup({ profileId }: { profileId: string }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <SettingsGroup searchId="browser.import">
      <SettingsRow
        searchId="browser.import.open"
        control={
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t('settings.browser.import.openAction')}
          </Button>
        }
      />
      {open && <BrowserImportDialog profileId={profileId} onClose={() => setOpen(false)} />}
    </SettingsGroup>
  )
}

function ExtensionItem({
  extension,
  busy,
  onToggle,
  onRemove
}: {
  extension: BrowserExtensionSummary
  busy: boolean
  onToggle: () => void
  onRemove: () => void
}): JSX.Element {
  const t = useT()
  const labelId = useId()
  const status =
    extension.status === 'loaded'
      ? t('settings.browser.extensions.active')
      : extension.status === 'disabled'
        ? t('settings.browser.extensions.disabled')
        : extension.error ?? t('settings.browser.extensions.error')
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="truncate text-sm font-medium text-foreground">
          {extension.name}
        </p>
        <p
          className={cn(
            'truncate text-xs',
            extension.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {extension.version !== '' ? `v${extension.version} · ` : ''}
          {status}
        </p>
      </div>
      <Switch
        checked={extension.enabled}
        disabled={busy}
        aria-labelledby={labelId}
        onCheckedChange={onToggle}
      />
      <Button variant="destructive-outline" size="xs" disabled={busy} onClick={onRemove}>
        {t('settings.browser.extensions.remove')}
      </Button>
    </li>
  )
}

function ExtensionsGroup({ profileId }: { profileId: string }): JSX.Element {
  const t = useT()
  const [extensions, setExtensions] = useState<BrowserExtensionSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  const refresh = (): void => {
    void invoke('browser:extensions', { profileId })
      .then((result) => setExtensions(result.extensions))
      .catch(() => {
        setExtensions([])
        setFeedback(t('settings.browser.extensions.error'))
      })
  }

  useEffect(refresh, [])

  const install = (): void => {
    setBusy('install')
    setFeedback('')
    void invoke('browser:installExtension', { profileId })
      .then(({ extension }) => {
        if (extension === null) return
        refresh()
        setFeedback(
          extension.status === 'loaded'
            ? t('settings.browser.extensions.installed')
            : extension.error ?? t('settings.browser.extensions.error')
        )
      })
      .catch((error: unknown) =>
        setFeedback(error instanceof Error ? error.message : t('settings.browser.extensions.error'))
      )
      .finally(() => setBusy(null))
  }

  const toggle = (extension: BrowserExtensionSummary): void => {
    setBusy(extension.path)
    void invoke('browser:setExtensionEnabled', {
      profileId,
      path: extension.path,
      enabled: !extension.enabled
    })
      .then((result) => setExtensions(result.extensions))
      .catch(() => setFeedback(t('settings.browser.extensions.error')))
      .finally(() => setBusy(null))
  }

  const remove = (extension: BrowserExtensionSummary): void => {
    setBusy(extension.path)
    void invoke('browser:removeExtension', { profileId, path: extension.path })
      .then((result) => setExtensions(result.extensions))
      .catch(() => setFeedback(t('settings.browser.extensions.error')))
      .finally(() => setBusy(null))
  }

  return (
    <SettingsGroup searchId="browser.extensions">
      <SettingsRow
        searchId="browser.extensions.add"
        control={
          <Button variant="secondary" size="sm" disabled={busy !== null} onClick={install}>
            {busy === 'install' ? t('settings.browser.extensions.loading') : t('settings.browser.extensions.add')}
          </Button>
        }
      />
      {extensions === null ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.browser.extensions.loading')}</p>
      ) : extensions.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.browser.extensions.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {extensions.map((extension) => (
            <ExtensionItem
              key={extension.path}
              extension={extension}
              busy={busy !== null}
              onToggle={() => toggle(extension)}
              onRemove={() => remove(extension)}
            />
          ))}
        </ul>
      )}
      <p className="px-4 py-2 text-xs text-muted-foreground empty:hidden" aria-live="polite">
        {feedback}
      </p>
    </SettingsGroup>
  )
}

/** The grant/audit cards are long; everyday knobs come first, these after. */
function AgentGroup({ settings }: { settings: Settings | null }): JSX.Element {
  const enabled = settings?.browser.agentUse ?? false
  return (
    <SettingsGroup searchId="browser.agent" bare>
      <div className="flex flex-col gap-4">
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60">
          <SettingsSwitchRow
            searchId="browser.agent.use"
            checked={enabled}
            disabled={settings === null}
            onChange={(agentUse) => saveBrowserSettings(settings, { agentUse })}
          />
        </div>
        <div className={cn('transition-opacity duration-(--dur-fast)', !enabled && 'opacity-50')}>
          <AgentAccessPanel />
        </div>
      </div>
    </SettingsGroup>
  )
}

export function BrowserSettingsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const [profileId, setProfileId] = useState('default')
  return (
    <SettingsStack>
      <GeneralGroup settings={settings} />
      <LinksGroup settings={settings} />
      <PrivacyGroup settings={settings} />
      <SettingsGroup searchId="browser.profile">
        <BrowserProfileRow searchId="browser.profile.select" value={profileId} onChange={setProfileId} />
      </SettingsGroup>
      <ExtensionsGroup key={`extensions-${profileId}`} profileId={profileId} />
      <ImportGroup profileId={profileId} />
      <BrowsingDataPanel key={profileId} settings={settings} profileId={profileId} />
      <AgentGroup settings={settings} />
    </SettingsStack>
  )
}
