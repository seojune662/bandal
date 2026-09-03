import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SHORTCUT_SPECS,
  chordFromKeyboardEvent,
  formatChord,
  parseChord,
  type ShortcutActionId,
  type ShortcutSpec
} from '../../../../shared/keymap'
import type { Settings } from '../../../../shared/types/settings'
import { Icon } from '../../app/icons'
import { useFocusTrap } from '../../components/useFocusTrap'
import { useLocale, useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import {
  assignChord,
  conflictingAction,
  effectiveChords,
  restoreDefault,
  type KeybindingOverrides
} from './shortcutModel'

interface ShortcutHelpOverlayProps {
  open: boolean
  onClose: () => void
}

type Scope = ShortcutSpec['scope']

interface PendingConflict {
  actionId: ShortcutActionId
  chord: string
  displaced: ShortcutActionId
  restore: boolean
}

const SCOPES: readonly Scope[] = ['global', 'browser', 'whiteboard']

function labelFor(spec: ShortcutSpec, locale: string): string {
  return locale === 'en-US' ? spec.labelEn : spec.labelKo
}

function specFor(actionId: ShortcutActionId): ShortcutSpec {
  const spec = SHORTCUT_SPECS.find((candidate) => candidate.id === actionId)
  if (spec === undefined) throw new Error(`Unknown shortcut action: ${actionId}`)
  return spec
}

function formattedChord(chord: string | undefined, platform: string): string {
  if (chord === undefined) return '—'
  const parsed = parseChord(chord)
  return parsed === null ? '—' : formatChord(parsed, platform)
}

export function ShortcutHelpOverlay({
  open,
  onClose
}: ShortcutHelpOverlayProps): JSX.Element | null {
  const t = useT()
  const locale = useLocale()
  const dialogRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<ShortcutActionId | null>(null)
  const [conflict, setConflict] = useState<PendingConflict | null>(null)
  const [saving, setSaving] = useState<ShortcutActionId | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusTrap(dialogRef, {
    active: open,
    initialFocus: searchRef,
    onEscape: () => {
      if (recording !== null) setRecording(null)
      else if (conflict !== null) setConflict(null)
      else onClose()
    }
  })

  useEffect(() => {
    if (!open) return
    let active = true
    setQuery('')
    setRecording(null)
    setConflict(null)
    setError(null)
    void invoke('settings:get', {})
      .then((next) => {
        if (active) setSettings(next)
      })
      .catch((loadError: unknown) => {
        console.error('[Bandal] 단축키 설정을 불러오지 못했습니다.', loadError)
        if (active) setError(t('help.shortcuts.loadFailed'))
      })
    const unsubscribe = onPush('settings:changed', ({ settings: next }) => {
      if (active) setSettings(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [open, t])

  const overrides = settings?.keybindings ?? {}
  const effective = useMemo(() => effectiveChords(overrides), [overrides])
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const groups = useMemo(
    () =>
      SCOPES.map((scope) => ({
        scope,
        specs: SHORTCUT_SPECS.filter(
          (spec) =>
            spec.scope === scope &&
            (normalizedQuery === '' ||
              labelFor(spec, locale)
                .toLocaleLowerCase(locale)
                .includes(normalizedQuery))
        )
      })).filter((group) => group.specs.length > 0),
    [locale, normalizedQuery]
  )

  const persist = async (
    actionId: ShortcutActionId,
    keybindings: KeybindingOverrides
  ): Promise<void> => {
    setSaving(actionId)
    setError(null)
    try {
      const saved = await invoke('settings:set', { keybindings })
      setSettings(saved)
      setRecording(null)
      setConflict(null)
    } catch (saveError) {
      console.error('[Bandal] 단축키 설정을 저장하지 못했습니다.', saveError)
      setError(t('help.shortcuts.saveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const requestBinding = (
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
    void persist(actionId, next)
  }

  const reset = (spec: ShortcutSpec): void => {
    if (spec.defaultChord === null) {
      void persist(spec.id, { ...overrides, [spec.id]: null })
      return
    }
    requestBinding(spec.id, spec.defaultChord, true)
  }

  const capture = (
    event: React.KeyboardEvent<HTMLButtonElement>,
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
    requestBinding(actionId, chord, false)
  }

  if (!open) return null
  const platform = window.bandal?.platform ?? 'darwin'

  return (
    <div
      className="settings-overlay help-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && saving === null) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="help-panel help-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-shortcuts-title"
      >
        <header className="help-panel__header">
          <div>
            <h2 id="help-shortcuts-title">{t('help.shortcuts.title')}</h2>
          </div>
          <button
            type="button"
            className="help-panel__close"
            aria-label={t('help.close')}
            disabled={saving !== null}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>

        <label className="help-search">
          <Icon name="search" />
          <span className="sr-only">{t('help.shortcuts.searchLabel')}</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={t('help.shortcuts.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {error !== null && (
          <p className="help-panel__error" role="alert">
            {error}
          </p>
        )}

        <div className="help-shortcuts__body">
          {groups.length === 0 ? (
            <p className="help-panel__empty">{t('help.shortcuts.empty')}</p>
          ) : (
            groups.map(({ scope, specs }) => (
              <section className="help-shortcut-group" key={scope}>
                <h3>{t(`help.shortcuts.scope.${scope}`)}</h3>
                <div className="help-shortcut-table" role="table">
                  {specs.map((spec) => {
                    const isRecording = recording === spec.id
                    const rowConflict = conflict?.actionId === spec.id
                      ? conflict
                      : null
                    return (
                      <div
                        className="help-shortcut-row"
                        role="row"
                        key={spec.id}
                        data-recording={isRecording || undefined}
                      >
                        <span className="help-shortcut-row__label" role="cell">
                          {labelFor(spec, locale)}
                        </span>
                        <span className="help-shortcut-row__chord" role="cell">
                          {isRecording ? (
                            <button
                              type="button"
                              className="help-shortcut-recorder"
                              autoFocus
                              aria-label={t('help.shortcuts.recording')}
                              onKeyDown={(event) => capture(event, spec.id)}
                            >
                              {t('help.shortcuts.recording')}
                            </button>
                          ) : (
                            <kbd>
                              {formattedChord(effective.get(spec.id), platform)}
                            </kbd>
                          )}
                        </span>
                        <span className="help-shortcut-row__actions" role="cell">
                          {spec.customizable && (
                            <>
                              <button
                                type="button"
                                disabled={saving !== null}
                                onClick={() => {
                                  setConflict(null)
                                  setRecording(spec.id)
                                }}
                              >
                                {t('help.shortcuts.change')}
                              </button>
                              <button
                                type="button"
                                disabled={saving !== null}
                                onClick={() => reset(spec)}
                              >
                                {t('help.shortcuts.default')}
                              </button>
                            </>
                          )}
                        </span>
                        {rowConflict !== null && (
                          <div className="help-shortcut-conflict" role="alert">
                            <span>
                              {t('help.shortcuts.conflict', {
                                label: labelFor(
                                  specFor(rowConflict.displaced),
                                  locale
                                )
                              })}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = rowConflict.restore
                                  ? restoreDefault(
                                      overrides,
                                      rowConflict.actionId,
                                      rowConflict.displaced
                                    )
                                  : assignChord(
                                      overrides,
                                      rowConflict.actionId,
                                      rowConflict.chord,
                                      rowConflict.displaced
                                    )
                                void persist(rowConflict.actionId, next)
                              }}
                            >
                              {t('help.shortcuts.replace')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConflict(null)}
                            >
                              {t('help.cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
