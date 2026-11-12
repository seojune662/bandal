/**
 * Renderer-wide visual state. Loads the persisted theme preference from main,
 * applies it on <html>, and owns the two shell rail visibility flags.
 */

import { toSettingsNavigationTarget, type SettingsCategoryId, type SettingsNavigationTarget } from '../../../shared/settingsCategories'
import { create } from 'zustand'
import { pickAppearance } from '../../../shared/appearance'
import type { AppearanceSettings } from '../../../shared/appearance'
import { applyTheme, resolveRendererTheme } from '../features/settings/settingsTheme'
import type { ResolvedTheme } from '../../../shared/theme'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'
import { DEFAULT_DECOR, type DecorSettings } from '../../../shared/decor'
import type { ThemePreference } from '../../../shared/types/settings'
import { invoke, onPush } from '../lib/ipc'
import { ensureSettingsLoaded } from './settingsSnapshot'

interface UiState {
  themePreference: ThemePreference
  resolvedTheme: ResolvedTheme
  /** 꾸미기: the glass palette and strength in force. */
  decor: DecorSettings
  /** Paint at once; persist after the dial settles (a slider drag sends one write). */
  setDecor: (patch: Partial<DecorSettings>) => void
  leftRailOpen: boolean
  courseRailOpen: boolean
  leftRailPanel: 'courses' | 'learning' | 'plugins'
  rightRailOpen: boolean
  /** Left AI column; it stays mounted while closed so drafts and streams survive. */
  aiRailOpen: boolean
  rightRailScope: string | null
  /** A temporary presentation of the same materials rail, never a saved width. */
  materialsExpanded: boolean
  materialsExpandedRestoreFocus: boolean
  setMaterialsExpanded: (expanded: boolean) => void
  closeMaterialsExpanded: (options?: { returnFocus?: boolean }) => void
  setRightRailScope: (scope: string | null) => void
  moveRightRailScope: (from: string, to: string) => void
  showMaterials: () => void
  toggleAiRail: () => void
  showAssistant: () => void
  setHomeTab: (tab: 'courses' | 'learning') => void
  /** [M5] Study-board overlay above the workspace (board tab stays too). */
  isBoardOverlayOpen: boolean
  /** 과목 연결 그래프 오버레이. */
  isLinkGraphOpen: boolean
  /** Full-window in-app settings overlay (replaces the settings window). */
  isSettingsOpen: boolean
  /** Category the overlay should open on; null = whatever it showed last. */
  settingsCategory: SettingsCategoryId | null
  /**
   * Pending deep link (sub-tab / row to scroll to). `nonce` changes on every
   * open so the same target can be requested twice in a row.
   */
  settingsTarget: (SettingsNavigationTarget & { nonce: number }) | null
  /** Applied (debounced) settings search query; rows filter on this. */
  settingsSearchQuery: string
  setSettingsSearchQuery: (query: string) => void
  /** Load persisted settings and subscribe to changes. Call once at boot. */
  initTheme: () => Promise<void>
  /** Persist a new preference (round-trips through main). */
  setThemePreference: (pref: ThemePreference) => Promise<void>
  toggleLeftRail: () => void
  toggleCourseRail: () => void
  showCourses: () => void
  toggleLearningPanel: () => void
  togglePluginsPanel: () => void
  toggleRightRail: () => void
  toggleBoardOverlay: () => void
  closeBoardOverlay: () => void
  toggleLinkGraph: () => void
  closeLinkGraph: () => void
  openSettings: (target?: SettingsCategoryId | SettingsNavigationTarget) => void
  closeSettings: () => void
}

type RightRailPreference = { open: boolean }
const RIGHT_RAIL_KEY = 'bandal:right-panels:v1'
function readRightRails(): Record<string, RightRailPreference> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RIGHT_RAIL_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item.open === 'boolean').map(([key, item]) => [key, { open: item.open }]))
  } catch { return {} }
}
const rightRails = readRightRails()
/** Includes spaces that have not mounted a Dockview in this app session. */
export function rememberedRightRailScopes(): string[] { return Object.keys(rightRails) }
function saveRightRail(scope: string | null, preference: RightRailPreference): void {
  if (!scope) return
  rightRails[scope] = preference
  try { localStorage.setItem(RIGHT_RAIL_KEY, JSON.stringify(rightRails)) } catch { /* In-memory restoration remains available. */ }
}

/** Home and AI share the left slot beside the rail (as on iPad): opening AI folds home away. */
const openAiRail = (): Partial<UiState> => ({ aiRailOpen: true, courseRailOpen: false })

let themeInitialization: Promise<void> | null = null

/** The last appearance painted, so a single-axis change can re-apply the rest. */
let currentAppearance: AppearanceSettings = pickAppearance(DEFAULT_SETTINGS)

let currentDecor: DecorSettings = DEFAULT_DECOR

function applyToDocument(appearance: AppearanceSettings & { decor?: DecorSettings }): ResolvedTheme {
  currentAppearance = pickAppearance(appearance)
  if (appearance.decor) currentDecor = appearance.decor
  return applyTheme({ ...currentAppearance, decor: currentDecor })
}

let decorSave: ReturnType<typeof setTimeout> | null = null

export const useUiStore = create<UiState>()((set, get) => ({
  themePreference: DEFAULT_SETTINGS.theme,
  resolvedTheme: resolveRendererTheme(DEFAULT_SETTINGS.theme),
  decor: DEFAULT_DECOR,
  setDecor: patch => {
    const decor = { ...get().decor, ...patch }
    applyToDocument({ ...currentAppearance, decor })
    set({ decor })
    if (decorSave) clearTimeout(decorSave)
    decorSave = setTimeout(() => { decorSave = null; void invoke('settings:set', { decor: get().decor }) }, 250)
  },
  leftRailOpen: true,
  courseRailOpen: true,
  leftRailPanel: (() => { try { return localStorage.getItem('bandal:home-tab') === 'learning' ? 'learning' : 'courses' } catch { return 'courses' } })(),
  rightRailOpen: true,
  aiRailOpen: false,
  rightRailScope: null,
  materialsExpanded: false,
  materialsExpandedRestoreFocus: true,
  setMaterialsExpanded: expanded => set(expanded
    ? { materialsExpanded: true, materialsExpandedRestoreFocus: true, rightRailOpen: true, isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false }
    : { materialsExpanded: false, materialsExpandedRestoreFocus: true }),
  closeMaterialsExpanded: options => set({ materialsExpanded: false, materialsExpandedRestoreFocus: options?.returnFocus ?? true }),
  moveRightRailScope: (from, to) => {
    if (from === to) return
    const current = get()
    const preference = from === current.rightRailScope ? { open: current.rightRailOpen } : rightRails[from]
    delete rightRails[from]
    if (preference) saveRightRail(to, preference)
    if (current.rightRailScope === from) set({ rightRailScope: to })
  },
  setRightRailScope: scope => {
    const current = get()
    if (scope === current.rightRailScope) return
    saveRightRail(current.rightRailScope, { open: current.rightRailOpen })
    const saved = scope ? rightRails[scope] : undefined
    set({ rightRailScope: scope, rightRailOpen: saved?.open ?? true, materialsExpanded: false })
  },
  showMaterials: () => {
    saveRightRail(get().rightRailScope, { open: true })
    set({ rightRailOpen: true })
  },
  toggleAiRail: () => set(state => ({ ...(state.aiRailOpen ? { aiRailOpen: false } : openAiRail()), materialsExpanded: false })),
  showAssistant: () => {
    set({ ...openAiRail(), materialsExpanded: false, isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false })
  },
  setHomeTab: tab => {
    try { localStorage.setItem('bandal:home-tab', tab) } catch { /* Optional UI preference. */ }
    set({ leftRailPanel: tab, leftRailOpen: true, courseRailOpen: true })
  },
  isBoardOverlayOpen: false,
  isLinkGraphOpen: false,
  isSettingsOpen: false,
  settingsCategory: null,
  settingsTarget: null,
  settingsSearchQuery: '',
  setSettingsSearchQuery: (query) => set({ settingsSearchQuery: query }),
  toggleLinkGraph: () =>
    set((state) => ({ isLinkGraphOpen: !state.isLinkGraphOpen, materialsExpanded: false })),
  closeLinkGraph: () => set({ isLinkGraphOpen: false }),
  openSettings: (requested) => {
    const target = requested === undefined ? null : toSettingsNavigationTarget(requested)
    set({
      isSettingsOpen: true,
      settingsCategory: target?.category ?? null,
      settingsTarget: target === null ? null : { ...target, nonce: Date.now() },
      // A deep link must land on its row, so a stale filter is cleared.
      settingsSearchQuery: '',
      materialsExpanded: false
    })
  },
  closeSettings: () => set({ isSettingsOpen: false, settingsTarget: null, settingsSearchQuery: '' }),

  initTheme: async () => {
    if (themeInitialization === null) {
      themeInitialization = (async () => {
        const settings = await ensureSettingsLoaded()
        const resolved = applyToDocument(settings)
        set({
          themePreference: settings.theme,
          resolvedTheme: resolved,
          decor: settings.decor,
        })

        onPush('settings:changed', ({ settings: next }) => {
          // A pending dial write wins over the echo of the one before it.
          const decor = decorSave ? get().decor : next.decor
          const nextResolved = applyToDocument({ ...next, decor })
          set({
            themePreference: next.theme,
            resolvedTheme: nextResolved,
            decor,
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
    // Reopening restores the slot as it was: AI stays if it held it, else home.
    set((state) => ({ leftRailOpen: !state.leftRailOpen,
      ...(!state.leftRailOpen && !state.aiRailOpen ? { courseRailOpen: true } : {}) }))
  },

  toggleCourseRail: () => set(state => ({ courseRailOpen: !state.courseRailOpen })),
  showCourses: () => set({ leftRailOpen: true, courseRailOpen: true, leftRailPanel: 'courses',
    isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false }),
  toggleLearningPanel: () => set(state => ({
    leftRailOpen: true,
    courseRailOpen: !(state.courseRailOpen && state.leftRailPanel === 'learning' &&
      !state.isSettingsOpen && !state.isBoardOverlayOpen && !state.isLinkGraphOpen),
    leftRailPanel: 'learning',
    isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false
  })),
  togglePluginsPanel: () => set(state => ({
    leftRailOpen: true,
    courseRailOpen: !(state.courseRailOpen && state.leftRailPanel === 'plugins' &&
      !state.isSettingsOpen && !state.isBoardOverlayOpen && !state.isLinkGraphOpen),
    leftRailPanel: 'plugins',
    isSettingsOpen: false, isBoardOverlayOpen: false, isLinkGraphOpen: false
  })),

  toggleRightRail: () => {
    const state = get()
    saveRightRail(state.rightRailScope, { open: !state.rightRailOpen })
    set({ rightRailOpen: !state.rightRailOpen, materialsExpanded: false })
  },

  toggleBoardOverlay: () => {
    set((state) => ({ isBoardOverlayOpen: !state.isBoardOverlayOpen, materialsExpanded: false }))
  },

  closeBoardOverlay: () => {
    set({ isBoardOverlayOpen: false })
  }
}))

/**
 * One left slot: whichever of home and AI opened last owns it. Enforced on
 * every state change, so a direct `setState({ courseRailOpen: true })` from a
 * navigation helper folds AI away just like the rail buttons do.
 */
useUiStore.subscribe((state, previous) => {
  const homeOpened = state.courseRailOpen && !previous.courseRailOpen
  const aiOpened = state.aiRailOpen && !previous.aiRailOpen
  if (homeOpened && state.aiRailOpen) useUiStore.setState({ aiRailOpen: false })
  else if (aiOpened && state.courseRailOpen) useUiStore.setState({ courseRailOpen: false })
  else if (state.courseRailOpen && state.aiRailOpen) useUiStore.setState({ aiRailOpen: false })
})
