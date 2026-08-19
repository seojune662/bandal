/**
 * Page zoom for a browser tab.
 *
 * Chromium's zoom "level" is logarithmic: factor = 1.2 ** level. Level 0 is
 * 100%, and the steps below are the ones Chrome itself uses, so ⌘+ lands on
 * familiar percentages instead of arbitrary ones.
 */

/** Chrome's own zoom stops, as levels. */
const ZOOM_LEVELS = [
  -7.6, -6.08, -4.8, -3.8, -2.2, -1.58, -1.22, -0.58, 0, 0.53, 1.22, 2.22,
  3.07, 3.8, 5.03, 6.03, 7.6
] as const

export const DEFAULT_ZOOM_LEVEL = 0

/** 100% for level 0, 150% for 2.22, and so on. */
export function zoomPercent(level: number): number {
  return Math.round(1.2 ** level * 100)
}

function stepTo(level: number, direction: 1 | -1): number {
  const stops = direction === 1 ? ZOOM_LEVELS : [...ZOOM_LEVELS].reverse()
  const next = stops.find((stop) =>
    direction === 1 ? stop > level + 1e-6 : stop < level - 1e-6
  )
  // Already at the end of the range: stay put rather than drift past it.
  return next ?? level
}

export function zoomIn(level: number): number {
  return stepTo(level, 1)
}

export function zoomOut(level: number): number {
  return stepTo(level, -1)
}

export function isDefaultZoom(level: number): boolean {
  return Math.abs(level - DEFAULT_ZOOM_LEVEL) < 1e-6
}
