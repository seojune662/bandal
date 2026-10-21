/**
 * Open/close state for the "+" new-tab menu. Kept as a tiny standalone
 * store shared by the pointer menu and the hold-⌘/Ctrl+T tab picker.
 */

import { create } from 'zustand'
import type { WorkspaceTarget } from './placementContext'

export interface MenuAnchor {
  x: number
  y: number
  target?: WorkspaceTarget
}

export const NEW_TAB_CYCLE_ACTIONS = [
  'new-browser-tab', 'new-markdown', 'new-whiteboard', 'new-ai-tab', 'new-recording-tab'
] as const

interface NewTabMenuState {
  isOpen: boolean
  cycleIndex: number | null
  advanceCycle: () => void
  /** Fixed-position anchor (viewport coords); null = centered fallback. */
  anchor: MenuAnchor | null
  open: (anchor?: MenuAnchor) => void
  close: () => void
}

export const useNewTabMenu = create<NewTabMenuState>()((set) => ({
  isOpen: false,
  cycleIndex: null,
  advanceCycle: () => set(state => ({
    isOpen: true, anchor: null,
    cycleIndex: state.cycleIndex === null ? 0 : (state.cycleIndex + 1) % NEW_TAB_CYCLE_ACTIONS.length
  })),
  anchor: null,
  open: (anchor) => {
    set({ isOpen: true, anchor: anchor ?? null, cycleIndex: null })
  },
  close: () => {
    set({ isOpen: false, cycleIndex: null })
  }
}))

/** Pointer menus and custom shortcuts keep the searchable picker open. */
export function openNewTabMenu(anchor?: MenuAnchor): void {
  useNewTabMenu.getState().open(anchor)
}
