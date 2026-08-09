/**
 * HTML inside the ink layer's `<svg viewBox="0 0 1 1">`.
 *
 * A `foreignObject` child inherits the SVG's user coordinate system, so every
 * CSS pixel inside it means "one board width". A 1px border becomes a border
 * as wide as the whole board; an 8px radius becomes a radius eight boards
 * across, which renders as a huge curved wedge rather than a rounded box.
 *
 * The fix is to lay the content out at real pixel size and scale it back down
 * into normalized space. This bit the text box first and the PDF clip second,
 * so it lives here rather than being written a third time.
 */

import type { CSSProperties } from 'react'
import type { DrawingBox } from '../../../../shared/types/drawing'

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Sizes `box` in pixels and scales it back, so CSS inside the foreignObject
 * behaves normally. Returns `null` before the surface has been measured —
 * rendering then would divide by zero and produce the wedge described above.
 */
export function foreignObjectContentStyle(
  box: DrawingBox,
  baseWidthPx: number,
  aspect: number
): CSSProperties | null {
  if (!isFinitePositive(baseWidthPx) || !isFinitePositive(aspect)) return null
  const baseHeightPx = baseWidthPx * aspect
  if (!isFinitePositive(baseHeightPx)) return null

  return {
    width: box.width * baseWidthPx,
    height: box.height * baseHeightPx,
    transform: `scale(${1 / baseWidthPx}, ${1 / baseHeightPx})`,
    transformOrigin: 'top left'
  }
}
