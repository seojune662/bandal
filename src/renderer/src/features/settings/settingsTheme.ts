import { applyAppearanceKnobs } from '../../../../shared/appearance'
import type { AppearanceSettings } from '../../../../shared/appearance'
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

/**
 * Paints every appearance axis: `data-theme` is the mode, `data-palette` the
 * family, and the three knobs (font scale, editor font, density) ride along
 * via src/shared/appearance.ts. Standalone settings window only — embedded,
 * the main window's uiStore owns `<html>`.
 */
export function applyTheme(appearance: AppearanceSettings): void {
  const root = document.documentElement
  root.dataset['theme'] = resolveTheme(appearance.theme)
  root.dataset['palette'] = appearance.palette
  applyAppearanceKnobs(root, appearance)
}
