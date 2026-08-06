import { SYSTEM_THEME } from '../../../../shared/theme'
import type { ResolvedTheme } from '../../../../shared/theme'
import type { ThemePreference } from '../../../../shared/types/settings'

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? SYSTEM_THEME.light
      : SYSTEM_THEME.dark
  }
  return theme
}

export function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset['theme'] = resolveTheme(theme)
}
