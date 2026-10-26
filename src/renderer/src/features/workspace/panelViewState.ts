import type { ScrollMemoryEntry } from '../pdf/lib/scrollMemory'

export const FLUSH_PANEL_VIEW_STATE = 'bandal:flush-panel-view-state'

/** Capture view state before the old canvas is hidden or serialized. */
export function flushPanelViewStates(): void {
  window.dispatchEvent(new Event(FLUSH_PANEL_VIEW_STATE))
}

export function readPdfPanelViewState(value: unknown): ScrollMemoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (typeof state.zoom !== 'number' || !Number.isFinite(state.zoom) || state.zoom <= 0 ||
      typeof state.scrollTop !== 'number' || !Number.isFinite(state.scrollTop) || state.scrollTop < 0 ||
      typeof state.scrollHeight !== 'number' || !Number.isFinite(state.scrollHeight) || state.scrollHeight < 0) return null
  const anchor = state.anchor as { page?: unknown; pageOffset?: unknown } | undefined
  if (anchor !== undefined && (!anchor || typeof anchor.page !== 'number' || !Number.isInteger(anchor.page) || anchor.page < 1 ||
      typeof anchor.pageOffset !== 'number' || !Number.isFinite(anchor.pageOffset))) return null
  return { zoom: state.zoom, scrollTop: state.scrollTop, scrollHeight: state.scrollHeight,
    ...(anchor ? { anchor: { page: anchor.page as number, pageOffset: anchor.pageOffset as number } } : {}) }
}

export interface NotePanelViewState { scrollTop: number; fontScale: number; mode: 'edit' | 'quiz' }
export function readNotePanelViewState(value: unknown): NotePanelViewState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  return typeof state.scrollTop === 'number' && Number.isFinite(state.scrollTop) && state.scrollTop >= 0 &&
    typeof state.fontScale === 'number' && Number.isFinite(state.fontScale) && state.fontScale > 0 &&
    (state.mode === 'edit' || state.mode === 'quiz')
    ? { scrollTop: state.scrollTop, fontScale: state.fontScale, mode: state.mode } : null
}
