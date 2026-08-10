import type { TabDescriptor } from '../../../../shared/tabs'

export const BANDAL_TAB_DRAG_MIME = 'application/x-bandal-tab'

/** Adds Bandal's cross-feature payload without clearing dockview's DnD data. */
export function writeWorkspaceTabDragData(
  dataTransfer: DataTransfer,
  descriptor: TabDescriptor,
  label: string
): void {
  // Dockview initializes every tab drag as move-only. Favorites intentionally
  // copy the descriptor while the original workspace tab stays open, so a
  // copy-only drop target is incompatible with dockview's default and
  // Chromium refuses to emit `drop`. Keep move enabled for dockview's own tab
  // rearranging, and additionally allow the cross-feature copy operation.
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(
    BANDAL_TAB_DRAG_MIME,
    JSON.stringify({ descriptor, label })
  )
  dataTransfer.setData('text/plain', label)
}
