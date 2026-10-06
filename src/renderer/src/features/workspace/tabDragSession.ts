export type WorkspaceDragKind = 'tab' | 'group' | 'resize' | null
export interface WorkspaceTabDragSource {
  courseId: string | null
  panelId: string
  nonce: string
}
let kind: WorkspaceDragKind = null
let source: WorkspaceTabDragSource | null = null
const listeners = new Set<() => void>()

export const tabDragSession = {
  getSnapshot: (): WorkspaceDragKind => kind,
  getSource: (): WorkspaceTabDragSource | null => source,
  beginTab: (next: WorkspaceTabDragSource): void => {
    source = next
    kind = 'tab'
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  begin: (next: Exclude<WorkspaceDragKind, null>): void => {
    if (kind === next) return
    kind = next
    for (const listener of listeners) listener()
  },
  end: (): void => {
    if (kind === null && source === null) return
    kind = null
    source = null
    for (const listener of listeners) listener()
  }
}

/** One owner for tab/group DnD and sash resizing; file uploads stay independent. */
export function installWorkspaceDragSession(root: HTMLElement): () => void {
  const start = (event: DragEvent): void => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    if (event.target.closest('.dv-tab')) tabDragSession.begin('tab')
    else if (event.target.closest('.dv-tabs-and-actions-container'))
      tabDragSession.begin('group')
  }
  const pointer = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('.dv-sash'))
      tabDragSession.begin('resize')
  }
  const end = (): void => tabDragSession.end()
  // Target handlers need the trusted source during the entire drop dispatch.
  // Chromium runs microtasks between native listener callbacks. A microtask
  // here clears the source before later capture/target listeners see `drop`.
  const dropped = (): void => { setTimeout(end, 0) }
  // Starting native HTML DnD cancels the pointer stream. Only a sash owns it.
  const endResize = (): void => {
    if (kind === 'resize') end()
  }
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') end()
  }
  const reflect = (): void => {
    if (kind === 'tab' || kind === 'group') root.dataset.tabDragging = 'true'
    else delete root.dataset.tabDragging
  }
  const unsubscribe = tabDragSession.subscribe(reflect)
  root.addEventListener('dragstart', start)
  root.addEventListener('pointerdown', pointer, true)
  window.addEventListener('drop', dropped, true)
  for (const name of ['dragend', 'mouseup'] as const)
    window.addEventListener(name, end, true)
  // A course switch blurs its focused tab; that is not losing the app window.
  window.addEventListener('blur', end)
  window.addEventListener('pointerup', endResize, true)
  window.addEventListener('pointercancel', endResize, true)
  window.addEventListener('keydown', key, true)
  return () => {
    end()
    unsubscribe()
    root.removeEventListener('dragstart', start)
    root.removeEventListener('pointerdown', pointer, true)
    window.removeEventListener('drop', dropped, true)
    for (const name of ['dragend', 'mouseup'] as const)
      window.removeEventListener(name, end, true)
    window.removeEventListener('blur', end)
    window.removeEventListener('pointerup', endResize, true)
    window.removeEventListener('pointercancel', endResize, true)
    window.removeEventListener('keydown', key, true)
  }
}
