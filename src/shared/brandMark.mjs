/**
 * Geometry shared by the build-time icon generator and the React mark.
 *
 * This JavaScript module is the runtime source of truth because Node can load
 * it directly from `scripts/generate-icon.mjs`. `brandMark.ts` only provides a
 * typed application-facing re-export.
 */

export const ICON_MOON_CX = 512
export const ICON_MOON_CY = 498

export const MARK_CX = 12
export const MARK_CY = 12
export const MARK_RADIUS = 9

export const MOON_TILT = -14
export const TERMINATOR_BULGE = 0.15

/**
 * The lit hemisphere, closed by a curved terminator rather than a diameter.
 *
 * Rotation remains an SVG group transform so the circle, rim, craters, and
 * path all share the exact same axis. `tilt` is accepted here as part of the
 * complete geometry contract and validated with the path coordinates.
 */
export function litHalfPath(cx, cy, radius, tilt, bulge) {
  if (![cx, cy, radius, tilt, bulge].every(Number.isFinite)) {
    throw new TypeError('brand mark geometry must contain only finite numbers')
  }
  if (radius <= 0 || bulge <= 0) {
    throw new RangeError('brand mark radius and bulge must be positive')
  }

  const top = `${cx} ${cy - radius}`
  const bottom = `${cx} ${cy + radius}`
  const terminatorRadius = (radius * bulge).toFixed(1)
  return `M ${top} A ${radius} ${radius} 0 0 1 ${bottom} A ${terminatorRadius} ${radius} 0 0 1 ${top} Z`
}
