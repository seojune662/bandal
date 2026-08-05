/**
 * Renderer-wide visual state. Loads the persisted theme preference from main,
 * applies it on <html>, and owns the two shell rail visibility flags.
 */

import { create } from 'zustand'
import type { ThemePreference } from '../../../shared/types/settings'
import { invoke, onPush } from '../lib/ipc'

type ResolvedTheme = 'dark' | 'light'

interface UiState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  leftRailOpen: boolean
  rightRailOpen: boolean
  /** [M5] Study-board overlay above the workspace (board tab stays too). */
  isBoardOverlayOpen: boolean
  /** Load persisted settings and subscribe to changes. Call once at boot. */
  initTheme: () => Promise<void>
  /** Persist a new preference (round-trips through main). */
  setThemePreference: (pref: ThemePreference) => Promise<void>
  toggleLeftRail: () => void
  toggleRightRail: () => void
  toggleBoardOverlay: () => void
  closeBoardOverlay: () => void
}

let themeInitialization: Promise<void> | null = null

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
  leftRailOpen: true,
  rightRailOpen: true,
  isBoardOverlayOpen: false,

  initTheme: async () => {
    if (themeInitialization === null) {
      themeInitialization = (async () => {
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
      })()
    }

    try {
      await themeInitialization
    } catch (error) {
      themeInitialization = null
      throw error
    }
  },

  setThemePreference: async (pref) => {
    // Optimistic apply; the settings:changed broadcast confirms it.
    const resolved = resolve(pref)
    applyToDocument(resolved)
    set({ themePreference: pref, resolvedTheme: resolved })
    await invoke('settings:set', { theme: pref })
  },

  toggleLeftRail: () => {
    set((state) => ({ leftRailOpen: !state.leftRailOpen }))
  },

  toggleRightRail: () => {
    set((state) => ({ rightRailOpen: !state.rightRailOpen }))
  },

  toggleBoardOverlay: () => {
    set((state) => ({ isBoardOverlayOpen: !state.isBoardOverlayOpen }))
  },

  closeBoardOverlay: () => {
    set({ isBoardOverlayOpen: false })
  }
}))
