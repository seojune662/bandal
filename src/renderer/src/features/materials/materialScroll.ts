function nearestDelta(start: number, end: number, visibleStart: number, visibleEnd: number): number {
  if (start < visibleStart && end > visibleEnd) return 0
  const oversized = end - start > visibleEnd - visibleStart
  if (start < visibleStart) return oversized ? end - visibleEnd : start - visibleStart
  if (end > visibleEnd) return oversized ? start - visibleStart : end - visibleEnd
  return 0
}

/** Reveal a selection within material panes, never by scrolling the app document. */
export function revealMaterialRow(row: HTMLElement, boundary: HTMLElement): void {
  if (!boundary.contains(row) || row.closest('[hidden], [inert]') || getComputedStyle(row).visibility === 'hidden') return
  for (let container = row.parentElement; container && boundary.contains(container); container = container.parentElement) {
    const style = getComputedStyle(container)
    const rect = container.getBoundingClientRect()
    const target = row.getBoundingClientRect()
    if (/^(auto|scroll)$/.test(style.overflowY) && container.scrollHeight > container.clientHeight) {
      const top = rect.top + container.clientTop
      container.scrollTop += nearestDelta(target.top, target.bottom, top, top + container.clientHeight)
    }
    if (/^(auto|scroll)$/.test(style.overflowX) && container.scrollWidth > container.clientWidth) {
      const left = rect.left + container.clientLeft
      container.scrollLeft += nearestDelta(target.left, target.right, left, left + container.clientWidth)
    }
  }
}
