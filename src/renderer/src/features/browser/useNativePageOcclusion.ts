import { useEffect, useState } from 'react'
import type { AnchorRect } from '../workspace/panels/browserAnchor'

const SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], dialog[open]'
export function overlapsNativePage(rect: AnchorRect | null, surfaces: readonly AnchorRect[]): boolean {
  return rect !== null && surfaces.some(surface =>
    surface.x < rect.x + rect.width && surface.x + surface.width > rect.x &&
    surface.y < rect.y + rect.height && surface.y + surface.height > rect.y)
}
/** Only DOM surfaces that overlap a native page replace it with a still preview. */
export function useNativePageOcclusion(): readonly AnchorRect[] {
  const [rects, setRects] = useState<readonly AnchorRect[]>([])
  useEffect(() => {
    let frame = 0
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    const update = (): void => {
      frame = 0
      resize.disconnect()
      const next: AnchorRect[] = []
      for (const surface of document.querySelectorAll(SURFACES)) {
        if (!surface.getClientRects().length || getComputedStyle(surface).visibility === 'hidden') continue
        resize.observe(surface)
        const bounds = surface.getBoundingClientRect()
        next.push(surface.getAttribute('aria-modal') === 'true'
          ? { x: 0, y: 0, width: innerWidth, height: innerHeight }
          : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
      }
      setRects(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const relevant = (node: Node): boolean => node instanceof Element &&
      (node.matches(SURFACES) || node.closest(SURFACES) !== null || node.querySelector(SURFACES) !== null)
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes'
        ? relevant(record.target)
        : [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-hidden', 'class', 'style'] })
    window.addEventListener('resize', schedule)
    update()
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule) }
  }, [])
  return rects
}
