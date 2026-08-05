/**
 * [M3-F] Pure LRU helpers for live webview guests.
 *
 * Live guests are expensive (one renderer process each), so we cap them.
 * The cap is soft: only HIDDEN guests (anchor unmounted) are ever evicted —
 * a visible split of 6 browser panes keeps all 6 alive rather than blanking
 * one. Evicted guests keep their last URL for restore (browserGuestsStore).
 */

export const MAX_LIVE_GUESTS = 5

/** Move `tabId` to the most-recently-used end (new array, no mutation). */
export function touchOrder(
  order: readonly string[],
  tabId: string
): string[] {
  if (!order.includes(tabId)) return [...order]
  return [...order.filter((id) => id !== tabId), tabId]
}

/**
 * Which guests to release so `order` (oldest→newest) fits within `cap`.
 * Only guests reported hidden are candidates, oldest first.
 */
export function pickEvictions(
  order: readonly string[],
  cap: number,
  isHidden: (tabId: string) => boolean
): string[] {
  const overflow = order.length - cap
  if (overflow <= 0) return []
  return order.filter(isHidden).slice(0, overflow)
}
