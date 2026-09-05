import { useEffect, useState } from 'react'
import { usePluginsStore } from '../../stores/pluginsStore'
import { useLocale } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { savePreference } from './savePreference'
import { SettingsCard } from './primitives'

export function PluginThemePicker(): JSX.Element | null {
  const plugins = usePluginsStore((state) => state.plugins)
  const ko = useLocale() === 'ko-KR'
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    let pushed = false
    const stop = onPush('settings:changed', ({ settings }) => {
      pushed = true
      setSelected(settings.pluginTheme)
    })
    void invoke('settings:get', {})
      .then((s) => {
        if (active && !pushed) setSelected(s.pluginTheme)
      })
      .catch(() => undefined)
    return () => {
      active = false
      stop()
    }
  }, [])
  const themes = plugins
    .filter(
      (p) =>
        p.enabled &&
        p.state === 'active' &&
        p.approvedPermissions?.includes('themes'),
    )
    .flatMap((p) =>
      (p.manifest.contributes.themes ?? []).map((theme) => ({
        ...theme,
        key: `${p.manifest.id}:${theme.id}`,
        publisher: p.manifest.name,
      })),
    )
  if (!themes.length && !selected) return null
  return (
    <SettingsCard title={ko ? '플러그인 테마' : 'Plugin themes'}>
      <select
        className="language-select"
        aria-label={ko ? '플러그인 테마' : 'Plugin themes'}
        disabled={busy}
        value={selected ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value
          const theme = themes.find((t) => t.key === value)
          setBusy(true)
          void savePreference({
            pluginTheme: value || null,
            ...(theme ? { theme: theme.base } : {}),
          })
            .then((result) => {
              if (result) setSelected(result.pluginTheme)
            })
            .finally(() => setBusy(false))
        }}
      >
        <option value="">{ko ? '기본 테마 사용' : 'Use built-in theme'}</option>
        {selected && !themes.some((t) => t.key === selected) && (
          <option value={selected}>
            {ko
              ? '플러그인 비활성 — 기본 테마 표시 중'
              : 'Plugin inactive — using built-in theme'}
          </option>
        )}
        {themes.map((theme) => (
          <option key={theme.key} value={theme.key}>
            {theme.title} · {theme.publisher}
          </option>
        ))}
      </select>
    </SettingsCard>
  )
}
