/**
 * UI store (M0: theme state only). Loads the persisted theme preference
 * from main, applies `data-theme` on <html>, and stays in sync with the
 * `settings:changed` push event.
 */

import { create } from 'zustand'
import type { ThemePreference } from '../../../shared/types/settings'
import { invoke, onPush } from '../lib/ipc'

type ResolvedTheme = 'dark' | 'light'

interface UiState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  /** Load persisted settings and subscribe to changes. Call once at boot. */
  initTheme: () => Promise<void>
  /** Persist a new preference (round-trips through main). */
  setThemePreference: (pref: ThemePreference) => Promise<void>
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  return pref
}

function applyToDocument(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme
}

export const useUiStore = create<UiState>()((set, get) => ({
  themePreference: 'dark',
  resolvedTheme: 'dark',

  initTheme: async () => {
    const settings = await invoke('settings:get', {})
    const resolved = resolve(settings.theme)
    applyToDocument(resolved)
    set({ themePreference: settings.theme, resolvedTheme: resolved })

    onPush('settings:changed', ({ settings: next }) => {
      const nextResolved = resolve(next.theme)
      applyToDocument(nextResolved)
      set({ themePreference: next.theme, resolvedTheme: nextResolved })
    })

    window
      .matchMedia('(prefers-color-scheme: light)')
      .addEventListener('change', () => {
        if (get().themePreference === 'system') {
          const nextResolved = resolve('system')
          applyToDocument(nextResolved)
          set({ resolvedTheme: nextResolved })
        }
      })
  },

  setThemePreference: async (pref) => {
    // Optimistic apply; the settings:changed broadcast confirms it.
    const resolved = resolve(pref)
    applyToDocument(resolved)
    set({ themePreference: pref, resolvedTheme: resolved })
    await invoke('settings:set', { theme: pref })
  }
}))
