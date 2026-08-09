export interface PopupGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface PopupViewport {
  width: number
  height: number
}

export interface PopupSizeLimits {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export type PopupResizeCorner = 'top-left' | 'bottom-right'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampedSize(
  value: number,
  min: number,
  max: number,
  available: number
): number {
  const boundedMax = Math.max(0, Math.min(max, available))
  const boundedMin = Math.min(Math.max(0, min), boundedMax)
  return clamp(value, boundedMin, boundedMax)
}

/** Keeps the complete popup rectangle inside the current viewport. */
export function clampPopupGeometry(
  geometry: PopupGeometry,
  viewport: PopupViewport,
  limits: PopupSizeLimits
): PopupGeometry {
  const width = clampedSize(
    geometry.width,
    limits.minWidth,
    limits.maxWidth,
    viewport.width
  )
  const height = clampedSize(
    geometry.height,
    limits.minHeight,
    limits.maxHeight,
    viewport.height
  )

  return {
    x: clamp(geometry.x, 0, Math.max(viewport.width - width, 0)),
    y: clamp(geometry.y, 0, Math.max(viewport.height - height, 0)),
    width,
    height
  }
}

/**
 * Resizes from a corner while keeping the opposite corner fixed. The usable
 * screen edge is also a hard maximum, so dragging cannot strand the popup.
 */
export function resizePopupGeometry(
  geometry: PopupGeometry,
  corner: PopupResizeCorner,
  deltaX: number,
  deltaY: number,
  viewport: PopupViewport,
  limits: PopupSizeLimits
): PopupGeometry {
  if (corner === 'top-left') {
    const right = geometry.x + geometry.width
    const bottom = geometry.y + geometry.height
    const width = clampedSize(
      geometry.width - deltaX,
      limits.minWidth,
      limits.maxWidth,
      right
    )
    const height = clampedSize(
      geometry.height - deltaY,
      limits.minHeight,
      limits.maxHeight,
      bottom
    )
    return { x: right - width, y: bottom - height, width, height }
  }

  const width = clampedSize(
    geometry.width + deltaX,
    limits.minWidth,
    limits.maxWidth,
    viewport.width - geometry.x
  )
  const height = clampedSize(
    geometry.height + deltaY,
    limits.minHeight,
    limits.maxHeight,
    viewport.height - geometry.y
  )
  return { ...geometry, width, height }
}
