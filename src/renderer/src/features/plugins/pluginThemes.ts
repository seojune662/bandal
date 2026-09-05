import { PLUGIN_THEME_TOKENS } from '../../../../shared/plugins/contributions'
import { invoke, onPush } from '../../lib/ipc'
import { usePluginsStore } from '../../stores/pluginsStore'

export function subscribePluginThemes(): () => void {
  let selected: string | null = null
  let pushed = false
  let disposed = false
  const paint = (): void => {
    const root = document.documentElement
    for (const token of PLUGIN_THEME_TOKENS) root.style.removeProperty(token)
    root.style.removeProperty('--accent-muted')
    delete root.dataset['pluginTheme']
    for (const plugin of usePluginsStore.getState().plugins) {
      if (
        !plugin.enabled ||
        plugin.state !== 'active' ||
        !plugin.approvedPermissions?.includes('themes')
      )
        continue
      const theme = plugin.manifest.contributes.themes?.find(
        (entry) => `${plugin.manifest.id}:${entry.id}` === selected,
      )
      if (!theme) continue
      for (const [token, color] of Object.entries(theme.tokens))
        root.style.setProperty(token, color)
      root.style.setProperty(
        '--accent-muted',
        'color-mix(in srgb, var(--accent) 14%, transparent)',
      )
      root.dataset['pluginTheme'] = selected ?? ''
    }
  }
  const stopSettings = onPush('settings:changed', ({ settings }) => {
    pushed = true
    selected = settings.pluginTheme
    paint()
  })
  const stopPlugins = usePluginsStore.subscribe(paint)
  // Standalone settings windows have their own store, including on startup.
  void usePluginsStore
    .getState()
    .refresh()
    .catch(() => undefined)
  void invoke('settings:get', {})
    .then((settings) => {
      if (!disposed && !pushed) {
        selected = settings.pluginTheme
        paint()
      }
    })
    .catch(() => undefined)
  return () => {
    disposed = true
    stopSettings()
    stopPlugins()
  }
}
