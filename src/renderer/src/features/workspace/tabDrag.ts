import type { TabDescriptor } from '../../../../shared/tabs'

export const BANDAL_TAB_DRAG_MIME = 'application/x-bandal-tab'

/** Adds Bandal's cross-feature payload without clearing dockview's DnD data. */
export function writeWorkspaceTabDragData(
  dataTransfer: DataTransfer,
  descriptor: TabDescriptor,
  label: string
): void {
  dataTransfer.setData(
    BANDAL_TAB_DRAG_MIME,
    JSON.stringify({ descriptor, label })
  )
  dataTransfer.setData('text/plain', label)
}
