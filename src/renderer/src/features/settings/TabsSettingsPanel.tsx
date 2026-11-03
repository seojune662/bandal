import { Fragment, useEffect, useId, useState } from 'react'
import type { Settings } from '../../../../shared/types/settings'
import { RECORDING_PLAYBACK_RATES, type TabPreferences } from '../../../../shared/tabPreferences'
import {
  formatChord,
  parseChord,
  resolveKeymap,
  type ShortcutActionId
} from '../../../../shared/keymap'
import type { SpeechModelState } from '../../../../shared/recording'
import type { SettingsNavigationTarget } from '../../../../shared/settingsCategories'
import { Button } from '../../components/ui/button'
import { useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { useUiStore } from '../../stores/uiStore'
import { SpeechModelPicker } from '../recordings/SpeechModelPicker'
import { TabKindIcon } from '../workspace/workspaceIcons'
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmentedRow,
  SettingsSelectRow,
  SettingsStack,
  SettingsSwitchRow,
  SettingsTextRow,
  type SettingsOption
} from './kit/SettingsKit'
import { useIsSettingsSearching } from './kit/SettingsSearchContext'
import { savePreference } from './savePreference'
import { TABS_ENTRIES } from './search/entries/tabs'
import '../recordings/recording.css'
import './tabs-settings.css'

/** `id` is the public sub-tab id (deep links, catalog `subTab`). */
const TABS = [
  { id: 'browser', kind: 'browser', action: 'new-browser-tab' },
  { id: 'markdown', kind: 'note', action: 'new-markdown' },
  { id: 'note', kind: 'whiteboard', action: 'new-whiteboard' },
  { id: 'ai', kind: 'chat', action: 'new-ai-tab' },
  { id: 'recording', kind: 'recording', action: 'new-recording-tab' }
] as const satisfies readonly { id: string; kind: string; action: ShortcutActionId }[]
type TabId = (typeof TABS)[number]['id']

const NOTE_PAPERS = ['grid', 'dots', 'lines', 'blank'] as const satisfies readonly TabPreferences['notePaper'][]
const NOTE_ORIENTATIONS = ['portrait', 'landscape'] as const satisfies readonly TabPreferences['noteOrientation'][]
const TITLE_PREFIX_MAX = 60

function isTabId(value: string | undefined): value is TabId {
  return TABS.some((tab) => tab.id === value)
}

/** Sub-tab a deep link points at: explicit `subTab`, else the row's catalog entry. */
function subTabFor(target: SettingsNavigationTarget | null | undefined): TabId | null {
  if (target?.category !== 'tabs') return null
  if (isTabId(target.subTab)) return target.subTab
  const entry = TABS_ENTRIES.find((candidate) => candidate.id === target.sectionId)
  const subTab = entry !== undefined && 'subTab' in entry ? entry.subTab : undefined
  return isTabId(subTab) ? subTab : null
}

export function TabsSettingsPanel({
  settings,
  target
}: {
  settings: Settings | null
  /** SettingsApp's current navigation target (search hits, deep links). */
  target?: SettingsNavigationTarget | null
}): JSX.Element {
  const t = useT()
  const id = useId()
  const storeTarget = useUiStore((state) => state.settingsTarget)
  const [selected, setSelected] = useState<TabId>(() => subTabFor(storeTarget) ?? subTabFor(target) ?? 'browser')
  const searching = useIsSettingsSearching()

  // Deep links: `openSettings({ category: 'tabs', subTab })`; nonce re-fires a repeat link.
  useEffect(() => {
    const next = subTabFor(storeTarget)
    if (next !== null) setSelected(next)
  }, [storeTarget?.nonce])
  useEffect(() => {
    const next = subTabFor(target)
    if (next !== null) setSelected(next)
  }, [target])

  const sections: Record<TabId, JSX.Element> = {
    browser: <BrowserTabSection settings={settings} />,
    markdown: <MarkdownTabSection settings={settings} />,
    note: <NoteTabSection settings={settings} />,
    ai: <AiTabSection settings={settings} />,
    recording: <RecordingTabSection settings={settings} />
  }

  // While searching, every sub-tab renders so matching rows are never hidden
  // behind an unselected tab; the rows filter themselves.
  if (searching) {
    return (
      <div className="tab-settings">
        <SettingsStack>{TABS.map((tab) => <Fragment key={tab.id}>{sections[tab.id]}</Fragment>)}</SettingsStack>
      </div>
    )
  }

  return (
    <div className="tab-settings">
      <SettingsStack>
        <div
          role="tablist"
          aria-label={t('settings.tabs.kindLabel')}
          className="inline-flex w-fit flex-wrap items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5"
        >
          {TABS.map((tab, index) => {
            const active = selected === tab.id
            return (
              <button
                key={tab.id}
                id={`${id}-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${id}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelected(tab.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % TABS.length
                      : event.key === 'ArrowLeft'
                        ? (index + TABS.length - 1) % TABS.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? TABS.length - 1
                            : null
                  if (next === null) return
                  event.preventDefault()
                  setSelected(TABS[next]!.id)
                  document.getElementById(`${id}-${TABS[next]!.id}`)?.focus()
                }}
                className={cn(
                  'inline-flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 text-xs font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary [&_svg]:size-3.5 [&_svg]:shrink-0',
                  active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <TabKindIcon kind={tab.kind} />
                <span>{t(`settings.tabs.kind.${tab.id}`)}</span>
              </button>
            )
          })}
        </div>
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${selected}`}>
          <SettingsStack>{sections[selected]}</SettingsStack>
        </div>
      </SettingsStack>
    </div>
  )
}

/* ---------------------------------------------------------------- shared */

function ShortcutRow({
  searchId,
  settings,
  action
}: {
  searchId: string
  settings: Settings | null
  action: ShortcutActionId
}): JSX.Element {
  const t = useT()
  const chord = [...resolveKeymap(settings?.keybindings ?? {})].find(([, bound]) => bound === action)?.[0]
  const parsed = chord ? parseChord(chord) : null
  return (
    <SettingsRow
      searchId={searchId}
      control={
        <>
          <kbd className="rounded-sm border border-border bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
            {parsed ? formatChord(parsed, window.bandal?.platform ?? 'unknown') : t('settings.tabs.shortcut.unassigned')}
          </kbd>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => useUiStore.getState().openSettings({ category: 'shortcuts' })}
          >
            {t('settings.tabs.shortcut.edit')}
          </Button>
        </>
      }
    />
  )
}

/* -------------------------------------------------------------- sections */

function BrowserTabSection({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  return (
    <SettingsGroup searchId="tabs.browser">
      <ShortcutRow searchId="tabs.browser.shortcut" settings={settings} action="new-browser-tab" />
      <SettingsRow
        searchId="tabs.browser.settings"
        control={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => useUiStore.getState().openSettings({ category: 'browser' })}
          >
            {t('settings.tabs.browser.openSettings')}
          </Button>
        }
      />
    </SettingsGroup>
  )
}

function AiTabSection({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  return (
    <SettingsGroup searchId="tabs.ai">
      <ShortcutRow searchId="tabs.ai.shortcut" settings={settings} action="new-ai-tab" />
      <SettingsRow
        searchId="tabs.ai.settings"
        control={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => useUiStore.getState().openSettings({ category: 'ai' })}
          >
            {t('settings.tabs.ai.openSettings')}
          </Button>
        }
      />
    </SettingsGroup>
  )
}

function MarkdownTabSection({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  // Editor font lives in Appearance (same `editorFont` setting).
  const commitPrefix = async (value: string): Promise<string | undefined> => {
    const markdownTitlePrefix = value.trim()
    if (markdownTitlePrefix === '') return t('settings.tabs.markdown.prefixRequired')
    if (markdownTitlePrefix.length > TITLE_PREFIX_MAX) {
      return t('settings.tabs.markdown.prefixTooLong', { max: TITLE_PREFIX_MAX })
    }
    const saved = await savePreference({ tabs: { markdownTitlePrefix } })
    return saved === null ? t('settings.tabs.saveFailed') : undefined
  }
  return (
    <SettingsGroup searchId="tabs.markdown">
      <ShortcutRow searchId="tabs.markdown.shortcut" settings={settings} action="new-markdown" />
      <SettingsTextRow
        searchId="tabs.markdown.titlePrefix"
        value={settings?.tabs.markdownTitlePrefix ?? ''}
        disabled={settings === null}
        onCommit={commitPrefix}
      />
    </SettingsGroup>
  )
}

function NoteTabSection({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const prefs = settings?.tabs
  return (
    <SettingsGroup searchId="tabs.note">
      <ShortcutRow searchId="tabs.note.shortcut" settings={settings} action="new-whiteboard" />
      <SettingsSegmentedRow
        searchId="tabs.note.paper"
        value={prefs?.notePaper ?? 'lines'}
        disabled={prefs === undefined}
        options={NOTE_PAPERS.map((paper) => ({ value: paper, label: t(`settings.tabs.note.paper.${paper}`) }))}
        onChange={(notePaper) => void savePreference({ tabs: { notePaper } })}
      />
      <SettingsSegmentedRow
        searchId="tabs.note.orientation"
        value={prefs?.noteOrientation ?? 'portrait'}
        disabled={prefs === undefined}
        options={NOTE_ORIENTATIONS.map((orientation) => ({
          value: orientation,
          label: t(`settings.tabs.note.orientation.${orientation}`)
        }))}
        onChange={(noteOrientation) => void savePreference({ tabs: { noteOrientation } })}
      />
    </SettingsGroup>
  )
}

function RecordingTabSection({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const [models, setModels] = useState<SpeechModelState[]>([])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void invoke('recordings:models', {})
      .then((value) => {
        if (alive) setModels(value)
      })
      .catch(() => {
        if (alive) setError(t('settings.tabs.recording.modelsFailed'))
      })
    const refresh = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((value) => {
          if (alive) setDevices(value.filter((device) => device.kind === 'audioinput'))
        })
        .catch(() => undefined)
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    const off = onPush('recordings:modelsChanged', setModels)
    return () => {
      alive = false
      off()
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])
  const prefs = settings?.tabs
  const savedDevice = prefs?.recordingDeviceId ?? 'default'
  // Select items need a non-empty value; unpermitted devices report ''.
  const listed = devices.filter((device) => device.deviceId !== 'default' && device.deviceId !== '')
  const micOptions: SettingsOption<string>[] = [
    { value: 'default', label: t('settings.tabs.recording.mic.default') },
    ...(savedDevice !== 'default' && !listed.some((device) => device.deviceId === savedDevice)
      ? [{ value: savedDevice, label: t('settings.tabs.recording.mic.disconnected') }]
      : []),
    ...listed.map((device, index) => ({
      value: device.deviceId,
      label: device.label || t('settings.tabs.recording.mic.fallback', { index: index + 1 })
    }))
  ]
  return (
    <>
      <SettingsGroup searchId="tabs.recording">
        <ShortcutRow searchId="tabs.recording.shortcut" settings={settings} action="new-recording-tab" />
        <SettingsSelectRow
          searchId="tabs.recording.mic"
          value={savedDevice}
          options={micOptions}
          disabled={prefs === undefined}
          selectClassName="max-w-64"
          onChange={(recordingDeviceId) => void savePreference({ tabs: { recordingDeviceId } })}
        />
        <SettingsSelectRow
          searchId="tabs.recording.playbackRate"
          value={String(prefs?.recordingPlaybackRate ?? 1)}
          options={RECORDING_PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
          disabled={prefs === undefined}
          selectClassName="min-w-24"
          onChange={(rate) => void savePreference({ tabs: { recordingPlaybackRate: Number(rate) } })}
        />
        <SettingsSwitchRow
          searchId="tabs.recording.sidebar"
          checked={prefs?.recordingSidebarOpen ?? true}
          disabled={prefs === undefined}
          onChange={(recordingSidebarOpen) => void savePreference({ tabs: { recordingSidebarOpen } })}
        />
        <SettingsSwitchRow
          searchId="tabs.recording.follow"
          checked={prefs?.recordingFollowTranscript ?? true}
          disabled={prefs === undefined}
          onChange={(recordingFollowTranscript) => void savePreference({ tabs: { recordingFollowTranscript } })}
        />
      </SettingsGroup>
      <SettingsGroup searchId="tabs.recordingModel">
        <SettingsRow
          searchId="tabs.recordingModel.model"
          alignTop
          footer={
            <>
              <SpeechModelPicker
                models={models}
                value={prefs?.recordingModel ?? 'whisper-large-v3-turbo'}
                disabled={prefs === undefined}
                onChange={(recordingModel) => void savePreference({ tabs: { recordingModel } })}
              />
              {error !== null && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </>
          }
        />
      </SettingsGroup>
    </>
  )
}
