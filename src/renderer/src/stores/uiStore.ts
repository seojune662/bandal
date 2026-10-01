/**
 * Renderer-wide visual state. Loads the persisted theme preference from main,
 * applies it on <html>, and owns the two shell rail visibility flags.
 */

import type { SettingsCategoryId } from '../../../shared/settingsCategories'
import { create } from 'zustand'
import { pickAppearance } from '../../../shared/appearance'
import type { AppearanceSettings } from '../../../shared/appearance'
import { applyTheme, resolveRendererTheme } from '../features/settings/settingsTheme'
import type { ResolvedTheme } from '../../../shared/theme'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'
import type { ThemePreference } from '../../../shared/types/settings'
import { invoke, onPush } from '../lib/ipc'
import { ensureSettingsLoaded } from './settingsSnapshot'

interface UiState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  leftRailOpen: boolean
  rightRailOpen: boolean
  /** [M5] Study-board overlay above the workspace (board tab stays too). */
  isBoardOverlayOpen: boolean
  /** 과목 연결 그래프 오버레이. */
  isLinkGraphOpen: boolean
  /** Full-window in-app settings overlay (replaces the settings window). */
  isSettingsOpen: boolean
  /** Category the overlay should open on; null = whatever it showed last. */
  settingsCategory: SettingsCategoryId | null
  /** Load persisted settings and subscribe to changes. Call once at boot. */
  initTheme: () => Promise<void>
  /** Persist a new preference (round-trips through main). */
  setThemePreference: (pref: ThemePreference) => Promise<void>
  toggleLeftRail: () => void
  toggleRightRail: () => void
  toggleBoardOverlay: () => void
  closeBoardOverlay: () => void
  toggleLinkGraph: () => void
  closeLinkGraph: () => void
  openSettings: (category?: SettingsCategoryId) => void
  closeSettings: () => void
}

let themeInitialization: Promise<void> | null = null

/** The last appearance painted, so a single-axis change can re-apply the rest. */
let currentAppearance: AppearanceSettings = pickAppearance(DEFAULT_SETTINGS)

function applyToDocument(appearance: AppearanceSettings): ResolvedTheme {
  currentAppearance = pickAppearance(appearance)
  return applyTheme(appearance)
}

export const useUiStore = create<UiState>()((set, get) => ({
  themePreference: DEFAULT_SETTINGS.theme,
  resolvedTheme: resolveRendererTheme(DEFAULT_SETTINGS.theme),
  leftRailOpen: true,
  rightRailOpen: true,
  isBoardOverlayOpen: false,
  isLinkGraphOpen: false,
  isSettingsOpen: false,
  settingsCategory: null,
  toggleLinkGraph: () =>
    set((state) => ({ isLinkGraphOpen: !state.isLinkGraphOpen })),
  closeLinkGraph: () => set({ isLinkGraphOpen: false }),
  openSettings: (category) =>
    set({ isSettingsOpen: true, settingsCategory: category ?? null }),
  closeSettings: () => set({ isSettingsOpen: false }),

  initTheme: async () => {
    if (themeInitialization === null) {
      themeInitialization = (async () => {
        const settings = await ensureSettingsLoaded()
        const resolved = applyToDocument(settings)
        set({
          themePreference: settings.theme,
          resolvedTheme: resolved,
        })

        onPush('settings:changed', ({ settings: next }) => {
          const nextResolved = applyToDocument(next)
          set({
            themePreference: next.theme,
            resolvedTheme: nextResolved,
          })
        })

        window
          .matchMedia('(prefers-color-scheme: dark)')
          .addEventListener('change', () => {
            if (get().themePreference === 'system') {
              const nextResolved = applyToDocument(currentAppearance)
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
    const resolved = applyToDocument({ ...currentAppearance, theme: pref })
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
