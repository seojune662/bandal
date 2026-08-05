/**
 * Heavy-pane decoupling prep (docs/orca-analysis.md §6).
 *
 * CONTRACT for M3-F:
 *  - The browser placeholder panel renders a stable positioned container
 *    `<div data-browser-anchor={tabId}>` and reports its bounding rect here.
 *  - The real `<webview>` guest is owned at the workspace/window level and
 *    is positioned over the anchor from these rect reports. It is NOT a
 *    child of the dockview panel DOM.
 *  - Panel unmount must NOT be assumed to destroy the guest: dockview
 *    unmounts panel content when tabs are hidden, moved between groups, or
 *    re-parented during drag. A `null` rect report means "anchor currently
 *    unmounted → hide the guest", never "destroy the guest". Guest
 *    destruction is an explicit `closeTab` concern.
 */

import { useEffect, type RefObject } from 'react'

export interface AnchorRect {
  x: number
  y: number
  width: number
  height: number
}

type AnchorListener = (tabId: string, rect: AnchorRect | null) => void

const anchorRects = new Map<string, AnchorRect>()
const listeners = new Set<AnchorListener>()

function publish(tabId: string, rect: AnchorRect | null): void {
  if (rect === null) anchorRects.delete(tabId)
  else anchorRects.set(tabId, rect)
  for (const listener of listeners) listener(tabId, rect)
}

/** Latest known rect for a browser anchor, if currently mounted. */
export function getBrowserAnchorRect(tabId: string): AnchorRect | null {
  return anchorRects.get(tabId) ?? null
}

/** Subscribe to anchor rect changes (M3-F: drive `browser:setBounds`). */
export function onBrowserAnchorRect(listener: AnchorListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function measure(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/**
 * Report the element's bounding rect for a browser tab, re-measuring on
 * element resize and window resize. Reports `null` on unmount (hide, not
 * destroy — see the module contract above).
 */
export function useBrowserAnchorRect(
  tabId: string,
  ref: RefObject<HTMLElement>
): void {
  useEffect(() => {
    const element = ref.current
    if (tabId === '' || element === null) return

    const report = (): void => {
      publish(tabId, measure(element))
    }
    report()

    // ResizeObserver covers panel resize/split; window resize covers rail
    // toggles that translate the workspace without resizing the panel.
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      publish(tabId, null)
    }
  }, [tabId, ref])
}
