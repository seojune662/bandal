import { useEffect, useId, useRef, useState } from 'react'
import type { PluginManifest, PluginSettingDefinition } from '../../../../shared/types/plugin'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { Input } from '../../components/ui/input'
import { useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsSelectRow, SettingsSwitchRow, SettingsTextRow } from './kit/SettingsKit'

/**
 * Number field that commits on blur/Enter like SettingsTextRow, clamping to
 * the manifest's min/max first. Escape reverts; an empty or non-numeric
 * draft is rejected instead of saved.
 */
function NumberSettingRow({ field, value, disabled, onCommit }: { field: PluginSettingDefinition; value: unknown; disabled: boolean; onCommit: (value: number) => Promise<boolean> }): JSX.Element {
  const t = useT()
  const labelId = useId()
  const committed = String(value ?? '')
  const [draft, setDraft] = useState(committed)
  const [invalid, setInvalid] = useState(false)
  const last = useRef(committed)
  useEffect(() => { last.current = committed; setDraft(committed); setInvalid(false) }, [committed])

  const commit = async (): Promise<void> => {
    if (draft === last.current) return
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft)
    if (!Number.isFinite(parsed)) { setInvalid(true); return }
    let next = parsed
    if (field.min !== undefined) next = Math.max(field.min, next)
    if (field.max !== undefined) next = Math.min(field.max, next)
    setDraft(String(next))
    setInvalid(false)
    if (String(next) === last.current) return
    if (await onCommit(next)) last.current = String(next)
  }

  const range = field.min !== undefined && field.max !== undefined
    ? t('settings.pluginCenter.config.range', { min: field.min, max: field.max })
    : field.min !== undefined ? t('settings.pluginCenter.config.min', { min: field.min })
      : field.max !== undefined ? t('settings.pluginCenter.config.max', { max: field.max }) : undefined

  return (
    <SettingsRow
      label={field.title}
      labelId={labelId}
      {...(field.description ? { description: field.description } : {})}
      disabled={disabled}
      control={
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={field.min}
          max={field.max}
          value={draft}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-invalid={invalid || undefined}
          className="w-32"
          onChange={event => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={event => {
            if (event.key === 'Enter') void commit()
            if (event.key === 'Escape' && draft !== last.current) {
              event.stopPropagation()
              setDraft(last.current)
              setInvalid(false)
            }
          }}
        />
      }
      {...(invalid
        ? { footer: <p role="alert" className="text-xs text-destructive">{t('settings.pluginCenter.config.invalidNumber')}</p> }
        : range !== undefined ? { footer: <p className="text-2xs text-muted-foreground">{range}</p> } : {})}
    />
  )
}

export function PluginConfiguration({ manifest }: { manifest: PluginManifest }): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  const [values, setValues] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let pushed = false
    setValues(null)
    setError(false)
    const stop = onPush('plugins:settingsChanged', (event) => {
      if (event.pluginId === manifest.id) {
        pushed = true
        setValues(event.values)
      }
    })
    void invoke('plugins:getSettings', { id: manifest.id })
      .then((result) => {
        if (active && !pushed) setValues(result.values)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
      stop()
    }
  }, [manifest.id, attempt])

  /** Resolves true when the value was stored. */
  async function save(key: string, value: unknown): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(false)
    try {
      const result = await invoke('plugins:setSetting', { id: manifest.id, key, value })
      setValues(result.values)
      return true
    } catch {
      setError(true)
      return false
    } finally {
      setBusy(false)
    }
  }

  const resetDefaults = async (): Promise<void> => {
    const ok = await confirm({
      title: t('settings.pluginCenter.config.resetConfirm', { name: manifest.name }),
      confirmLabel: t('settings.pluginCenter.config.reset'),
      confirmVariant: 'destructive'
    })
    if (!ok) return
    setBusy(true)
    setError(false)
    void invoke('plugins:resetSettings', { id: manifest.id })
      .then((result) => setValues(result.values))
      .catch(() => setError(true))
      .finally(() => setBusy(false))
  }

  return (
    <div className="plugin-configuration space-y-3" aria-busy={busy}>
      {error && (
        <SettingsNotice
          tone="danger"
          action={<Button variant="secondary" size="xs" onClick={() => setAttempt((n) => n + 1)}>{t('settings.plugins.action.retry')}</Button>}
        >
          {t('settings.pluginCenter.config.error')}
        </SettingsNotice>
      )}
      {values === null ? (
        <p role="status" className="text-xs text-muted-foreground">{t('settings.pluginCenter.config.loading')}</p>
      ) : (
        <SettingsGroup
          title={t('settings.pluginCenter.config.title')}
          action={<Button variant="ghost" size="sm" disabled={busy} onClick={() => { void resetDefaults() }}>{t('settings.pluginCenter.config.reset')}</Button>}
        >
          {manifest.contributes.settings?.map((field) => {
            const description = field.description ? { description: field.description } : {}
            if (field.type === 'boolean') {
              return (
                <SettingsSwitchRow
                  key={field.key}
                  label={field.title}
                  {...description}
                  checked={values[field.key] === true}
                  disabled={busy}
                  onChange={(next) => void save(field.key, next)}
                />
              )
            }
            if (field.type === 'select') {
              return (
                <SettingsSelectRow
                  key={field.key}
                  label={field.title}
                  {...description}
                  value={String(values[field.key])}
                  options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
                  disabled={busy}
                  onChange={(next) => void save(field.key, next)}
                />
              )
            }
            if (field.type === 'number') {
              return <NumberSettingRow key={field.key} field={field} value={values[field.key]} disabled={busy} onCommit={(next) => save(field.key, next)} />
            }
            return (
              <SettingsTextRow
                key={field.key}
                label={field.title}
                {...description}
                value={String(values[field.key] ?? '')}
                disabled={busy}
                onCommit={async (next) => {
                  if (field.min !== undefined && next.length < field.min) return t('settings.pluginCenter.config.tooShort', { min: field.min })
                  if (field.max !== undefined && next.length > field.max) return t('settings.pluginCenter.config.tooLong', { max: field.max })
                  return (await save(field.key, next)) ? undefined : t('settings.pluginCenter.config.error')
                }}
              />
            )
          })}
        </SettingsGroup>
      )}
    </div>
  )
}
