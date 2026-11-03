import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { AppleCalendar, AppleCalendarState } from '../../../../shared/types/appleCalendar'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { invoke, onPush } from '../../lib/ipc'
import { useT } from '../../i18n'
import {
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSelectRow,
  SettingsStack,
  type SettingsOption
} from '../settings/kit/SettingsKit'

/** Radix Select items cannot use '' — stands in for "no destination". */
const NO_DESTINATION = '__none__'

function CalendarChoice({
  calendar,
  checked,
  disabled,
  onChange
}: {
  calendar: AppleCalendar
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  const t = useT()
  const id = useId()
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} />
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} aria-hidden />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block truncate text-sm font-medium text-foreground">{calendar.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {calendar.source}
          {!calendar.writable ? ` · ${t('settings.calendar.display.readOnly')}` : ''}
        </span>
      </label>
    </li>
  )
}

export function CalendarSettingsPanel(): JSX.Element {
  const t = useT()
  const [state, setState] = useState<AppleCalendarState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const sequence = useRef(0)
  const saving = useRef(false)
  const refresh = useCallback(async () => {
    if (saving.current) return
    const current = ++sequence.current
    try {
      const value = await invoke('appleCalendar:state', {})
      if (current === sequence.current) { setState(value); setError(null) }
    } catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : t('settings.calendar.loadFailed')) }
  }, [t])
  useEffect(() => {
    void refresh()
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    const off = onPush('appleCalendar:changed', focus)
    return () => { sequence.current++; off(); window.removeEventListener('focus', focus) }
  }, [refresh])
  const run = async (action: () => Promise<AppleCalendarState>, message: string) => {
    if (saving.current) return
    saving.current = true
    const current = ++sequence.current
    setBusy(true); setError(null); setNotice('')
    try { const value = await action(); if (current === sequence.current) { setState(value); setNotice(message) } }
    catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : t('settings.calendar.saveFailed')) }
    finally { saving.current = false; if (current === sequence.current) setBusy(false) }
  }
  const ready = state?.connected === true && state.authorization === 'authorized'
  const denied = state?.authorization === 'denied' || state?.authorization === 'restricted' || state?.authorization === 'write-only'
  const change = (selectedCalendarIds: string[], destinationCalendarId: string | null) =>
    run(() => invoke('appleCalendar:configure', { selectedCalendarIds, destinationCalendarId }), t('settings.calendar.saved'))

  const connectionDescription =
    state === null
      ? t('settings.calendar.apple.checking')
      : state.supported === false
        ? t('settings.calendar.apple.unsupported')
        : ready
          ? t('settings.calendar.apple.readyDescription')
          : t('settings.calendar.apple.connectDescription')

  const destination = state?.destinationCalendarId ?? null
  const destinationOptions: SettingsOption<string>[] = [
    { value: NO_DESTINATION, label: t('settings.calendar.export.none') }
  ]
  if (state !== null && destination !== null && !state.calendars.some((c) => c.id === destination && c.writable)) {
    destinationOptions.push({ value: destination, label: t('settings.calendar.export.unavailable'), disabled: true })
  }
  for (const calendar of state?.calendars ?? []) {
    if (calendar.writable) destinationOptions.push({ value: calendar.id, label: `${calendar.title} · ${calendar.source}` })
  }
  const notReadyReason = t('settings.calendar.notConnected')

  return (
    <div aria-busy={busy}>
    <SettingsStack>
      <SettingsGroup searchId="calendar.apple">
        <SettingsRow
          searchId="calendar.apple.connection"
          label={ready ? t('settings.calendar.apple.connected') : t('settings.calendar.apple.pitch')}
          description={<span {...(state === null && error === null ? { role: 'status' } : {})}>{connectionDescription}</span>}
          control={
            state?.supported === true ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => invoke(state.connected ? 'appleCalendar:disconnect' : 'appleCalendar:connect', {}), '')}
              >
                {busy
                  ? t('settings.calendar.apple.working')
                  : state.connected
                    ? t('settings.calendar.apple.disconnect')
                    : t('settings.calendar.apple.connect')}
              </Button>
            ) : undefined
          }
          {...(ready ? { footer: <p className="text-xs text-muted-foreground">{t('settings.calendar.apple.disconnectHint')}</p> } : {})}
        />
        {denied && (
          <div className="px-4 py-3">
            <SettingsNotice
              tone="warning"
              action={
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => void invoke('appleCalendar:permissions', {}).catch((e) => setError(String(e)))}
                >
                  {t('settings.calendar.apple.openSystemSettings')}
                </Button>
              }
            >
              {t('settings.calendar.apple.denied')}
            </SettingsNotice>
          </div>
        )}
      </SettingsGroup>

      {error !== null && (
        <SettingsNotice
          tone="danger"
          action={
            <Button variant="secondary" size="xs" disabled={busy} onClick={() => void refresh()}>
              {t('settings.calendar.retry')}
            </Button>
          }
        >
          {error}
        </SettingsNotice>
      )}
      {notice !== '' && <SettingsNotice>{notice}</SettingsNotice>}

      {state?.supported === true && (
        <>
          <SettingsGroup searchId="calendar.display">
            {!ready ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.calendar.display.notConnected')}</p>
            ) : state.calendars.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">{t('settings.calendar.display.empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {state.calendars.map((calendar) => (
                  <CalendarChoice
                    key={calendar.id}
                    calendar={calendar}
                    checked={state.selectedCalendarIds.includes(calendar.id)}
                    disabled={busy}
                    onChange={(checked) =>
                      void change(
                        checked
                          ? [...state.selectedCalendarIds, calendar.id]
                          : state.selectedCalendarIds.filter((id) => id !== calendar.id),
                        state.destinationCalendarId
                      )
                    }
                  />
                ))}
              </ul>
            )}
            <SettingsRow
              searchId="calendar.display.refresh"
              disabled={!ready}
              disabledReason={notReadyReason}
              control={
                <Button variant="secondary" size="sm" disabled={busy || !ready} onClick={() => void refresh()}>
                  {t('settings.calendar.display.refreshAction')}
                </Button>
              }
            />
          </SettingsGroup>

          <SettingsGroup searchId="calendar.export">
            <SettingsSelectRow
              searchId="calendar.export.destination"
              value={destination ?? NO_DESTINATION}
              options={destinationOptions}
              disabled={busy || !ready}
              {...(!ready ? { disabledReason: notReadyReason } : {})}
              selectClassName="max-w-64"
              onChange={(next) => void change(state.selectedCalendarIds, next === NO_DESTINATION ? null : next)}
            />
          </SettingsGroup>
        </>
      )}
    </SettingsStack>
    </div>
  )
}
