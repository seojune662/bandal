import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Ellipsis, Search } from 'lucide-react'
import {
  SHORTCUT_SPECS,
  chordFromKeyboardEvent,
  findConflicts,
  formatChord,
  parseChord,
  type ShortcutActionId,
  type ShortcutSpec
} from '../../../../../shared/keymap'
import type {
  Settings,
  SettingsPatch,
  ShortcutPriority
} from '../../../../../shared/types/settings'
import { showToast } from '../../../app/toast'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../components/ui/dropdown-menu'
import { Input } from '../../../components/ui/input'
import { useLocale, useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import { cn } from '../../../lib/utils'
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSegmented,
  SettingsSelectRow,
  SettingsStack
} from '../kit/SettingsKit'
import {
  assignChord,
  conflictingAction,
  effectiveChords,
  formattedChordParts,
  importedKeybindings,
  restoreDefault,
  type KeybindingOverrides
} from './shortcutModel'

type Scope = ShortcutSpec['scope']
type StatusFilter = 'all' | 'changed' | 'unassigned' | 'conflict'

interface PendingConflict {
  actionId: ShortcutActionId
  chord: string
  displaced: ShortcutActionId
  restore: boolean
}

const SCOPES: readonly Scope[] = ['global', 'browser', 'whiteboard']
const EMPTY_OVERRIDES: KeybindingOverrides = {}

function labelFor(spec: ShortcutSpec, locale: string): string {
  return locale === 'en-US' ? spec.labelEn : spec.labelKo
}

function specFor(actionId: ShortcutActionId): ShortcutSpec {
  const spec = SHORTCUT_SPECS.find((candidate) => candidate.id === actionId)
  if (spec === undefined) throw new Error(`Unknown shortcut action: ${actionId}`)
  return spec
}

function isChanged(spec: ShortcutSpec, overrides: KeybindingOverrides): boolean {
  if (!Object.prototype.hasOwnProperty.call(overrides, spec.id)) return false
  const value = overrides[spec.id]
  return value === null || value !== spec.defaultChord
}

function chordText(chord: string | undefined, platform: string): string {
  if (chord === undefined) return '—'
  const parsed = parseChord(chord)
  return parsed === null ? '—' : formatChord(parsed, platform)
}

interface FilterCounts {
  all: number
  changed: number
  unassigned: number
  conflict: number
}

interface ShortcutGroupView {
  scope: Scope
  specs: readonly ShortcutSpec[]
}

function useShortcutView(
  overrides: KeybindingOverrides,
  query: string,
  filter: StatusFilter,
  locale: string,
  platform: string
): {
  effective: ReadonlyMap<ShortcutActionId, string>
  counts: FilterCounts
  groups: readonly ShortcutGroupView[]
} {
  const effective = useMemo(() => effectiveChords(overrides), [overrides])
  const conflicts = useMemo(() => findConflicts(overrides), [overrides])
  const conflictIds = useMemo(
    () => new Set([...conflicts.values()].flat()),
    [conflicts]
  )
  const counts = useMemo<FilterCounts>(
    () => ({
      all: SHORTCUT_SPECS.length,
      changed: SHORTCUT_SPECS.filter((spec) => isChanged(spec, overrides)).length,
      unassigned: SHORTCUT_SPECS.filter((spec) => !effective.has(spec.id)).length,
      conflict: conflicts.size
    }),
    [conflicts, effective, overrides]
  )
  const normalized = query.trim().toLocaleLowerCase(locale)
  const matches = (spec: ShortcutSpec): boolean => {
    const text = `${labelFor(spec, locale)} ${chordText(
      effective.get(spec.id),
      platform
    )}`.toLocaleLowerCase(locale)
    if (normalized !== '' && !text.includes(normalized)) return false
    if (filter === 'changed') return isChanged(spec, overrides)
    if (filter === 'unassigned') return !effective.has(spec.id)
    return filter !== 'conflict' || conflictIds.has(spec.id)
  }
  const groups = SCOPES.map((scope) => ({
    scope,
    specs: SHORTCUT_SPECS.filter((spec) => spec.scope === scope && matches(spec))
  })).filter((group) => group.specs.length > 0)
  return { effective, counts, groups }
}

function useShortcutSave(): {
  saving: boolean
  error: string | null
  save: (patch: SettingsPatch) => Promise<boolean>
} {
  const t = useT()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (patch: SettingsPatch): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      await invoke('settings:set', patch)
      return true
    } catch (saveError) {
      console.error('[Bandal] Could not save shortcut settings.', saveError)
      setError(t('help.shortcuts.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, save }
}

function useShortcutEditor(
  overrides: KeybindingOverrides,
  save: (patch: SettingsPatch) => Promise<boolean>
) {
  const recorderRef = useRef<HTMLButtonElement>(null)
  const [recording, setRecording] = useState<ShortcutActionId | null>(null)
  const [conflict, setConflict] = useState<PendingConflict | null>(null)
  useEffect(() => recorderRef.current?.focus(), [recording])

  const persist = async (keybindings: KeybindingOverrides): Promise<boolean> => {
    const saved = await save({ keybindings })
    if (saved) {
      setRecording(null)
      setConflict(null)
    }
    return saved
  }
  const request = (
    actionId: ShortcutActionId,
    chord: string,
    restore: boolean
  ): void => {
    const displaced = conflictingAction(overrides, actionId, chord)
    if (displaced !== null) {
      setConflict({ actionId, chord, displaced, restore })
      setRecording(null)
      return
    }
    const next = restore
      ? restoreDefault(overrides, actionId, null)
      : assignChord(overrides, actionId, chord, null)
    void persist(next)
  }
  const capture = (
    event: KeyboardEvent<HTMLButtonElement>,
    actionId: ShortcutActionId
  ): void => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      setRecording(null)
      return
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    const chord = chordFromKeyboardEvent(event)
    if (chord === null) return
    event.preventDefault()
    request(actionId, chord, false)
  }
  return {
    recorderRef,
    recording,
    conflict,
    persist,
    request,
    capture,
    record: (actionId: ShortcutActionId) => {
      setConflict(null)
      setRecording(actionId)
    },
    cancelConflict: () => setConflict(null)
  }
}

type ShortcutEditor = ReturnType<typeof useShortcutEditor>

function replacementFor(
  overrides: KeybindingOverrides,
  conflict: PendingConflict
): KeybindingOverrides {
  return conflict.restore
    ? restoreDefault(overrides, conflict.actionId, conflict.displaced)
    : assignChord(
        overrides,
        conflict.actionId,
        conflict.chord,
        conflict.displaced
      )
}


const FILTERS: readonly StatusFilter[] = ['all', 'changed', 'unassigned', 'conflict']

function ShortcutKeycaps({
  chord,
  platform
}: {
  chord: string | undefined
  platform: string
}): JSX.Element {
  return (
    <span className="inline-flex flex-none items-center gap-1">
      {formattedChordParts(chord, platform).map((part, index) => (
        <kbd
          key={`${part}-${index}`}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border-strong bg-background px-1.5 font-mono text-2xs text-secondary-foreground shadow-sm"
        >
          {part}
        </kbd>
      ))}
    </span>
  )
}

function ShortcutOverflow({
  disabled,
  onDefault,
  onUnassign
}: {
  disabled: boolean
  onDefault: () => void
  onUnassign: () => void
}): JSX.Element {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-2 self-center text-muted-foreground"
          aria-label={t('settings.shortcuts.actions')}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onSelect={onDefault}>
          {t('settings.shortcuts.default')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={onUnassign}>
          {t('settings.shortcuts.unassign')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConflictNotice({
  conflict,
  locale,
  onReplace,
  onCancel
}: {
  conflict: PendingConflict
  locale: string
  onReplace: () => void
  onCancel: () => void
}): JSX.Element {
  const t = useT()
  return (
    <div
      className="flex items-center gap-2 border-t border-border bg-destructive-muted px-4 py-2.5 text-xs text-secondary-foreground"
      role="alert"
    >
      <span className="min-w-0 flex-1">
        {t('help.shortcuts.conflict', {
          label: labelFor(specFor(conflict.displaced), locale)
        })}
      </span>
      <Button variant="secondary" size="xs" onClick={onReplace}>
        {t('help.shortcuts.replace')}
      </Button>
      <Button variant="ghost" size="xs" onClick={onCancel}>
        {t('help.cancel')}
      </Button>
    </div>
  )
}

interface ShortcutRowProps {
  spec: ShortcutSpec
  chord: string | undefined
  platform: string
  locale: string
  recording: boolean
  saving: boolean
  conflict: PendingConflict | null
  recorderRef: RefObject<HTMLButtonElement>
  onRecord: () => void
  onCapture: (event: KeyboardEvent<HTMLButtonElement>) => void
  onDefault: () => void
  onUnassign: () => void
  onReplace: () => void
  onCancelConflict: () => void
}

function ShortcutRow(props: ShortcutRowProps): JSX.Element {
  const t = useT()
  const { spec } = props
  const label = labelFor(spec, props.locale)
  return (
    <div>
      <div className="flex min-w-0 items-stretch">
        <button
          ref={props.recording ? props.recorderRef : undefined}
          type="button"
          className={cn(
            'flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2.5 text-left text-foreground transition-colors duration-(--dur-fast) disabled:cursor-default',
            'enabled:hover:bg-accent data-[recording=true]:bg-selected'
          )}
          disabled={!spec.customizable || props.saving}
          aria-label={`${label}: ${props.recording ? t('settings.shortcuts.recording') : chordText(props.chord, props.platform)}`}
          aria-pressed={props.recording}
          data-recording={props.recording || undefined}
          onClick={props.onRecord}
          onKeyDown={props.recording ? props.onCapture : undefined}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{label}</span>
            {spec.guestAllowed && <Badge>{t('settings.shortcuts.guestBadge')}</Badge>}
            {!spec.customizable && <Badge variant="outline">{t('settings.shortcuts.fixedBadge')}</Badge>}
          </span>
          {props.recording ? (
            <span className="inline-flex h-6 items-center rounded-sm border border-primary bg-background px-2 font-mono text-2xs text-foreground shadow-sm">
              {t('settings.shortcuts.recording')}
            </span>
          ) : (
            <ShortcutKeycaps chord={props.chord} platform={props.platform} />
          )}
        </button>
        {spec.customizable ? (
          <ShortcutOverflow
            disabled={props.saving}
            onDefault={props.onDefault}
            onUnassign={props.onUnassign}
          />
        ) : (
          // Keeps fixed rows' keycaps aligned with the customizable ones.
          <span className="mr-2 w-7 flex-none" aria-hidden="true" />
        )}
      </div>
      {props.conflict !== null && (
        <ConflictNotice
          conflict={props.conflict}
          locale={props.locale}
          onReplace={props.onReplace}
          onCancel={props.onCancelConflict}
        />
      )}
    </div>
  )
}

function ShortcutToolbar({
  query,
  filter,
  counts,
  onQuery,
  onFilter
}: {
  query: string
  filter: StatusFilter
  counts: FilterCounts
  onQuery: (query: string) => void
  onFilter: (filter: StatusFilter) => void
}): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-48 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          aria-label={t('settings.shortcuts.searchLabel')}
          placeholder={t('settings.shortcuts.search')}
          className="pl-8"
          onChange={event => onQuery(event.target.value)}
        />
      </div>
      <SettingsSegmented
        value={filter}
        ariaLabel={t('settings.shortcuts.filterLabel')}
        options={FILTERS.map(value => ({
          value,
          label: (
            <>
              <span>{t(`settings.shortcuts.filter.${value}`)}</span>
              <span className="text-2xs tabular-nums text-muted-foreground">{counts[value]}</span>
            </>
          )
        }))}
        onChange={onFilter}
      />
    </div>
  )
}

function ShortcutScopeGroup({
  group,
  effective,
  overrides,
  editor,
  platform,
  locale,
  disabled
}: {
  group: ShortcutGroupView
  effective: ReadonlyMap<ShortcutActionId, string>
  overrides: KeybindingOverrides
  editor: ShortcutEditor
  platform: string
  locale: string
  disabled: boolean
}): JSX.Element {
  const t = useT()
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-xs font-medium text-muted-foreground">
        {t(`settings.shortcuts.scope.${group.scope}`)}
      </h3>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60">
        {group.specs.map(spec => {
          const rowConflict = editor.conflict?.actionId === spec.id ? editor.conflict : null
          return (
            <ShortcutRow
              key={spec.id}
              spec={spec}
              chord={effective.get(spec.id)}
              platform={platform}
              locale={locale}
              recording={editor.recording === spec.id}
              saving={disabled}
              conflict={rowConflict}
              recorderRef={editor.recorderRef}
              onRecord={() => editor.record(spec.id)}
              onCapture={event => editor.capture(event, spec.id)}
              onDefault={() =>
                spec.defaultChord === null
                  ? void editor.persist({ ...overrides, [spec.id]: null })
                  : editor.request(spec.id, spec.defaultChord, true)
              }
              onUnassign={() => void editor.persist({ ...overrides, [spec.id]: null })}
              onReplace={() =>
                rowConflict !== null && void editor.persist(replacementFor(overrides, rowConflict))
              }
              onCancelConflict={editor.cancelConflict}
            />
          )
        })}
      </div>
    </section>
  )
}

function ShortcutWorkspace({
  view,
  overrides,
  editor,
  platform,
  locale,
  disabled
}: {
  view: ReturnType<typeof useShortcutView>
  overrides: KeybindingOverrides
  editor: ShortcutEditor
  platform: string
  locale: string
  disabled: boolean
}): JSX.Element {
  const t = useT()
  if (view.groups.length === 0) {
    return (
      <SettingsEmptyState
        icon={<Search />}
        title={t('settings.shortcuts.empty')}
        description={t('settings.shortcuts.emptyDescription')}
      />
    )
  }
  return (
    <>
      {view.groups.map(group => (
        <ShortcutScopeGroup
          key={group.scope}
          group={group}
          effective={view.effective}
          overrides={overrides}
          editor={editor}
          platform={platform}
          locale={locale}
          disabled={disabled}
        />
      ))}
    </>
  )
}

function JsonActions({
  overrides,
  disabled,
  persist
}: {
  overrides: KeybindingOverrides
  disabled: boolean
  persist: ShortcutEditor['persist']
}): JSX.Element {
  const t = useT()
  const paste = async (): Promise<void> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await navigator.clipboard.readText()) as unknown
    } catch {
      showToast(t('settings.shortcuts.json.invalid'), 'danger')
      return
    }
    const keybindings = importedKeybindings(parsed)
    if (keybindings === null) {
      showToast(t('settings.shortcuts.json.invalid'), 'danger')
      return
    }
    if (await persist(keybindings)) {
      showToast(t('settings.shortcuts.json.pasted'))
    }
  }
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(overrides, null, 2))
      showToast(t('settings.shortcuts.json.copied'))
    } catch {
      showToast(t('settings.shortcuts.json.copyFailed'), 'danger')
    }
  }
  return (
    <SettingsRow
      searchId="shortcuts.transfer.json"
      control={
        <>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void copy()}>
            {t('settings.shortcuts.json.copy')}
          </Button>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void paste()}>
            {t('settings.shortcuts.json.paste')}
          </Button>
        </>
      }
    />
  )
}

export function ShortcutsPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const overrides = settings?.keybindings ?? EMPTY_OVERRIDES
  const platform = typeof window === 'undefined' ? 'darwin' : (window.bandal?.platform ?? 'darwin')
  const view = useShortcutView(overrides, query, filter, locale, platform)
  const { saving, error, save } = useShortcutSave()
  const editor = useShortcutEditor(overrides, save)
  const priority = settings?.shortcutPriority ?? 'bandal'
  const disabled = settings === null || saving
  return (
    <SettingsStack>
      <SettingsGroup searchId="shortcuts.priority">
        <SettingsSelectRow<ShortcutPriority>
          searchId="shortcuts.priority.mode"
          description={t(`settings.shortcuts.priority.${priority}Description`)}
          value={priority}
          disabled={disabled}
          options={[
            { value: 'bandal', label: t('settings.shortcuts.priority.bandal') },
            { value: 'site', label: t('settings.shortcuts.priority.site') }
          ]}
          onChange={shortcutPriority => void save({ shortcutPriority })}
        />
      </SettingsGroup>

      {error !== null && <SettingsNotice tone="danger">{error}</SettingsNotice>}

      <SettingsGroup searchId="shortcuts.keys" bare>
        <div className="space-y-5">
          <ShortcutToolbar
            query={query}
            filter={filter}
            counts={view.counts}
            onQuery={setQuery}
            onFilter={setFilter}
          />
          <ShortcutWorkspace
            view={view}
            overrides={overrides}
            editor={editor}
            platform={platform}
            locale={locale}
            disabled={disabled}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup searchId="shortcuts.transfer">
        <JsonActions overrides={overrides} disabled={disabled} persist={editor.persist} />
      </SettingsGroup>
    </SettingsStack>
  )
}
