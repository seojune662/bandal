import { tabDragSession } from '../workspace/tabDragSession'
import { acquirePointerPassthrough } from './webviewPassthrough'

/** Native pages must stop receiving input before a held tab can cross them. */
export function installWorkspaceNativePassthrough(root: Document): () => void {
  let primed = false
  let release: (() => void) | null = null
  const reflect = (): void => {
    if (primed || tabDragSession.getSnapshot() !== null) {
      release ??= acquirePointerPassthrough()
    } else {
      release?.()
      release = null
    }
  }
  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element) ||
      !event.target.closest('.workspace-host') ||
      !event.target.closest('.dv-tabs-and-actions-container, .dv-sash') ||
      event.target.closest('button, input, select, textarea, a, [role="button"]')) return
    // Waiting for dragstart's React render lets a fast diagonal gesture enter
    // a still-visible WebContentsView, which consumes the native drag events.
    // Prime the IPC while the pointer is still held on the tab/header/sash.
    primed = true
    reflect()
  }
  const unprime = (): void => { primed = false; reflect() }
  const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') unprime() }
  const unsubscribe = tabDragSession.subscribe(() => {
    if (tabDragSession.getSnapshot() !== null) primed = false
    reflect()
  })
  root.addEventListener('pointerdown', pointerDown, true)
  root.addEventListener('pointerup', unprime, true)
  root.addEventListener('pointercancel', unprime, true)
  root.addEventListener('keydown', key, true)
  root.defaultView?.addEventListener('blur', unprime)
  reflect()
  return () => {
    unsubscribe()
    root.removeEventListener('pointerdown', pointerDown, true)
    root.removeEventListener('pointerup', unprime, true)
    root.removeEventListener('pointercancel', unprime, true)
    root.removeEventListener('keydown', key, true)
    root.defaultView?.removeEventListener('blur', unprime)
    release?.()
  }
}
