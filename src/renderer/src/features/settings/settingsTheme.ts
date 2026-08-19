import { SYSTEM_THEME } from '../../../../shared/theme'
import type { PaletteId, ResolvedTheme } from '../../../../shared/theme'
import type { ThemePreference } from '../../../../shared/types/settings'

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? SYSTEM_THEME.light
      : SYSTEM_THEME.dark
  }
  return theme
}

/** Paints both axes: `data-theme` is the mode, `data-palette` the family. */
export function applyTheme(theme: ThemePreference, palette: PaletteId): void {
  document.documentElement.dataset['theme'] = resolveTheme(theme)
  document.documentElement.dataset['palette'] = palette
}
