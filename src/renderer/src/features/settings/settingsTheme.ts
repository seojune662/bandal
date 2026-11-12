import { applyAppearanceKnobs } from '../../../../shared/appearance'
import type { AppearanceSettings } from '../../../../shared/appearance'
import { resolveThemeId } from '../../../../shared/theme'
import type { ResolvedTheme } from '../../../../shared/theme'
import type { ThemePreference } from '../../../../shared/types/settings'
import { DEFAULT_DECOR, type DecorSettings } from '../../../../shared/decor'
import { applyDecor } from '../../app/decor/applyDecor'

export function resolveRendererTheme(theme: ThemePreference): ResolvedTheme {
  return resolveThemeId(
    theme,
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

let lastDecor: DecorSettings = DEFAULT_DECOR

/**
 * Apply the shared neutral theme, the decor (palette × strength of the glass)
 * and accessibility preferences before rendering. A caller without `decor`
 * keeps the last one painted.
 */
export function applyTheme(appearance: AppearanceSettings & { decor?: DecorSettings }): ResolvedTheme {
  const resolved = resolveRendererTheme(appearance.theme)
  const root = document.documentElement
  root.dataset['theme'] = resolved
  delete root.dataset['palette']
  applyAppearanceKnobs(root, appearance)
  if (appearance.decor) lastDecor = appearance.decor
  applyDecor(root, lastDecor, resolved === 'dark')
  return resolved
}
