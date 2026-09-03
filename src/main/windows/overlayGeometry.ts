export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Transparent desktop window; asymmetric space keeps both charm directions visible. */
export const ORB_WINDOW_WIDTH = 260
export const ORB_WINDOW_HEIGHT = 340
/** Visible pill inside the transparent desktop window. */
export const ORB_VISUAL_SIZE = 56
export const ORB_VISUAL_CENTER_Y = 120
/** Matches the in-app orb's `--space-5` default edge gap. */
export const ORB_DEFAULT_MARGIN = 24
/** Window size persisted by releases before desktop charms were supported. */
export const LEGACY_ORB_WINDOW_SIZE = 64
export const POPUP_DEFAULT_SIZE = { width: 400, height: 560 }
export const POPUP_MIN_SIZE = { width: 320, height: 400 }

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), Math.max(lower, upper))
}

export function clampToArea(rect: Rect, area: Rect): Rect {
  return {
    ...rect,
    x: clamp(rect.x, area.x, area.x + area.width - rect.width),
    y: clamp(rect.y, area.y, area.y + area.height - rect.height)
  }
}

export function orbVisualBounds(
  orbWindow: Rect,
  visualSize = ORB_VISUAL_SIZE,
  visualCenterY = ORB_VISUAL_CENTER_Y
): Rect {
  return {
    x: orbWindow.x + (orbWindow.width - visualSize) / 2,
    y: orbWindow.y + visualCenterY - visualSize / 2,
    width: visualSize,
    height: visualSize
  }
}

/**
 * Keeps the visible pill on-screen at the sides/top. The whole window stays
 * above the display bottom so downward charms cannot disappear off-screen.
 */
export function clampOrbToArea(
  orbWindow: Rect,
  area: Rect,
  visualSize = ORB_VISUAL_SIZE,
  visualCenterY = ORB_VISUAL_CENTER_Y
): Rect {
  const visual = orbVisualBounds(orbWindow, visualSize, visualCenterY)
  const clampedVisual = clampToArea(visual, area)
  const visualClampedY = orbWindow.y + clampedVisual.y - visual.y
  return {
    ...orbWindow,
    x: orbWindow.x + clampedVisual.x - visual.x,
    y: Math.min(visualClampedY, area.y + area.height - orbWindow.height)
  }
}

/** Preserves the old window's centre when upgrading its transparent canvas. */
export function normalizeOrbWindowBounds(saved: Rect): Rect {
  if (
    saved.width === ORB_WINDOW_WIDTH &&
    saved.height === ORB_WINDOW_HEIGHT
  ) {
    return { ...saved }
  }
  return {
    x: saved.x + saved.width / 2 - ORB_WINDOW_WIDTH / 2,
    y: saved.y + saved.height / 2 - ORB_VISUAL_CENTER_Y,
    width: ORB_WINDOW_WIDTH,
    height: ORB_WINDOW_HEIGHT
  }
}

export function defaultOrbPosition(
  area: Rect,
  windowWidth = ORB_WINDOW_WIDTH,
  windowHeight = ORB_WINDOW_HEIGHT,
  visualSize = ORB_VISUAL_SIZE,
  visualCenterY = ORB_VISUAL_CENTER_Y,
  margin = ORB_DEFAULT_MARGIN
): { x: number; y: number } {
  const bounds = clampOrbToArea(
    {
      x: area.x + area.width - windowWidth - margin,
      y: area.y + area.height - windowHeight - margin,
      width: windowWidth,
      height: windowHeight
    },
    area,
    visualSize,
    visualCenterY
  )
  return { x: bounds.x, y: bounds.y }
}

export function placePopup(
  orb: Rect,
  popupSize: { width: number; height: number },
  area: Rect,
  visualSize = ORB_VISUAL_SIZE,
  visualCenterY = ORB_VISUAL_CENTER_Y
): Rect {
  const visual = orbVisualBounds(orb, visualSize, visualCenterY)
  const above = visual.y - popupSize.height
  const left = visual.x - popupSize.width
  const below = visual.y + visual.height
  const right = visual.x + visual.width

  return clampToArea(
    {
      x: left >= area.x ? left : right,
      y: above >= area.y ? above : below,
      ...popupSize
    },
    area
  )
}

function distanceToAreaSquared(point: { x: number; y: number }, area: Rect): number {
  const nearestX = clamp(point.x, area.x, area.x + area.width)
  const nearestY = clamp(point.y, area.y, area.y + area.height)
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2
}

function areaForPoint(point: { x: number; y: number }, areas: Rect[]): Rect | null {
  const containing = areas.find(
    (area) =>
      point.x >= area.x &&
      point.x < area.x + area.width &&
      point.y >= area.y &&
      point.y < area.y + area.height
  )
  if (containing !== undefined) return containing

  let nearest: Rect | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const area of areas) {
    const distance = distanceToAreaSquared(point, area)
    if (distance < nearestDistance) {
      nearest = area
      nearestDistance = distance
    }
  }
  return nearest
}

export function orbPositionFromCursor(
  cursor: { x: number; y: number },
  grab: { x: number; y: number },
  areas: Rect[],
  windowWidth = ORB_WINDOW_WIDTH,
  windowHeight = ORB_WINDOW_HEIGHT,
  visualSize = ORB_VISUAL_SIZE,
  visualCenterY = ORB_VISUAL_CENTER_Y
): { x: number; y: number } {
  const raw = {
    x: Math.round(cursor.x - grab.x),
    y: Math.round(cursor.y - grab.y),
    width: windowWidth,
    height: windowHeight
  }
  const area = areaForPoint(cursor, areas)
  if (area === null) return { x: raw.x, y: raw.y }

  const clamped = clampOrbToArea(raw, area, visualSize, visualCenterY)
  return { x: clamped.x, y: clamped.y }
}
