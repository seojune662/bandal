import { BANDAL_TAB_DRAG_MIME } from './tabDrag'

/** Native tab DnD needs edge scrolling when the destination tab is offscreen. */
export function installTabDragScrolling(root: HTMLElement): () => void {
  let frame: number | null = null
  let tabs: HTMLElement | null = null
  let velocity = 0
  let previous = 0
  const stop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    tabs = null
    velocity = 0
    previous = 0
  }
  const finish = (): void => {
    stop()
    delete root.dataset.tabDragging
  }
  const tick = (time: number): void => {
    frame = null
    if (!tabs?.isConnected || velocity === 0) return
    const elapsed = previous ? Math.min(32, time - previous) : 16
    previous = time
    const before = tabs.scrollLeft
    tabs.scrollLeft += velocity * elapsed / 1000
    if (tabs.scrollLeft !== before) frame = requestAnimationFrame(tick)
  }
  const start = (event: DragEvent): void => {
    if (event.target instanceof Element && event.target.closest('.dv-tab')) root.dataset.tabDragging = 'true'
  }
  const over = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes(BANDAL_TAB_DRAG_MIME) || !(event.target instanceof Element)) return
    const next = event.target.closest<HTMLElement>('.dv-tabs-container.dv-horizontal')
    if (!next || !root.contains(next)) { stop(); return }
    const rect = next.getBoundingClientRect()
    const zone = Math.min(40, rect.width / 4)
    velocity = event.clientX < rect.left + zone ? -500 * (1 - (event.clientX - rect.left) / zone)
      : event.clientX > rect.right - zone ? 500 * (1 - (rect.right - event.clientX) / zone) : 0
    if (!velocity) { stop(); return }
    tabs = next
    if (frame === null) { previous = 0; frame = requestAnimationFrame(tick) }
  }
  const leave = (event: DragEvent): void => {
    if (!(event.relatedTarget instanceof Node) || !tabs?.contains(event.relatedTarget)) stop()
  }
  const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') finish() }
  root.addEventListener('dragstart', start)
  root.addEventListener('dragover', over)
  root.addEventListener('dragleave', leave)
  window.addEventListener('drop', finish, true)
  window.addEventListener('dragend', finish, true)
  window.addEventListener('blur', finish)
  window.addEventListener('keydown', key)
  return () => {
    finish()
    root.removeEventListener('dragstart', start)
    root.removeEventListener('dragover', over)
    root.removeEventListener('dragleave', leave)
    window.removeEventListener('drop', finish, true)
    window.removeEventListener('dragend', finish, true)
    window.removeEventListener('blur', finish)
    window.removeEventListener('keydown', key)
  }
}
