/**
 * Renderer-wide visual state. Loads the persisted theme preference from main,
 * applies it on <html>, and owns the two shell rail visibility flags.
 */

import { create } from 'zustand'
import type { OrbCharmId } from '../../../shared/orbCharm'
import { SYSTEM_THEME } from '../../../shared/theme'
import type { PaletteId, ResolvedTheme } from '../../../shared/theme'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'
import type { ThemePreference } from '../../../shared/types/settings'
import { invoke, onPush } from '../lib/ipc'

interface UiState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  /** The color family layered over `resolvedTheme` (`<html data-palette>`). */
  palette: PaletteId
  /** Charm hanging off the assistant orb (src/shared/orbCharm.ts). */
  orbCharm: OrbCharmId
  leftRailOpen: boolean
  rightRailOpen: boolean
  /** [M5] Study-board overlay above the workspace (board tab stays too). */
  isBoardOverlayOpen: boolean
  /** 과목 연결 그래프 오버레이. */
  isLinkGraphOpen: boolean
  /** Full-window in-app settings overlay (replaces the settings window). */
  isSettingsOpen: boolean
  /** Load persisted settings and subscribe to changes. Call once at boot. */
  initTheme: () => Promise<void>
  /** Persist a new preference (round-trips through main). */
  setThemePreference: (pref: ThemePreference) => Promise<void>
  /** Persist a new color family (round-trips through main). */
  setPalette: (palette: PaletteId) => Promise<void>
  /** Persist a new orb charm (round-trips through main). */
  setOrbCharm: (orbCharm: OrbCharmId) => Promise<void>
  toggleLeftRail: () => void
  toggleRightRail: () => void
  toggleBoardOverlay: () => void
  closeBoardOverlay: () => void
  toggleLinkGraph: () => void
  closeLinkGraph: () => void
  openSettings: () => void
  closeSettings: () => void
}

let themeInitialization: Promise<void> | null = null

/** `system` follows the OS between the two 반달 defaults; any other
 * preference is already a registered theme id. */
function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? SYSTEM_THEME.light
      : SYSTEM_THEME.dark
  }
  return pref
}

function applyToDocument(theme: ResolvedTheme, palette: PaletteId): void {
  document.documentElement.dataset['theme'] = theme
  document.documentElement.dataset['palette'] = palette
}

export const useUiStore = create<UiState>()((set, get) => ({
  themePreference: DEFAULT_SETTINGS.theme,
  resolvedTheme: resolve(DEFAULT_SETTINGS.theme),
  palette: DEFAULT_SETTINGS.palette,
  orbCharm: DEFAULT_SETTINGS.orbCharm,
  leftRailOpen: true,
  rightRailOpen: true,
  isBoardOverlayOpen: false,
  isLinkGraphOpen: false,
  isSettingsOpen: false,
  toggleLinkGraph: () =>
    set((state) => ({ isLinkGraphOpen: !state.isLinkGraphOpen })),
  closeLinkGraph: () => set({ isLinkGraphOpen: false }),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  initTheme: async () => {
    if (themeInitialization === null) {
      themeInitialization = (async () => {
        const settings = await invoke('settings:get', {})
        const resolved = resolve(settings.theme)
        applyToDocument(resolved, settings.palette)
        set({
          themePreference: settings.theme,
          resolvedTheme: resolved,
          palette: settings.palette,
          orbCharm: settings.orbCharm
        })

        onPush('settings:changed', ({ settings: next }) => {
          const nextResolved = resolve(next.theme)
          applyToDocument(nextResolved, next.palette)
          set({
            themePreference: next.theme,
            resolvedTheme: nextResolved,
            palette: next.palette,
            orbCharm: next.orbCharm
          })
        })

        window
          .matchMedia('(prefers-color-scheme: light)')
          .addEventListener('change', () => {
            if (get().themePreference === 'system') {
              const nextResolved = resolve('system')
              applyToDocument(nextResolved, get().palette)
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
    applyToDocument(resolved, get().palette)
    set({ themePreference: pref, resolvedTheme: resolved })
    await invoke('settings:set', { theme: pref })
  },

  setPalette: async (palette) => {
    applyToDocument(get().resolvedTheme, palette)
    set({ palette })
    await invoke('settings:set', { palette })
  },

  setOrbCharm: async (orbCharm) => {
    set({ orbCharm })
    await invoke('settings:set', { orbCharm })
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
