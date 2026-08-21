export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const ORB_WINDOW_SIZE = 64
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

export function defaultOrbPosition(
  area: Rect,
  size = ORB_WINDOW_SIZE
): { x: number; y: number } {
  const bounds = clampToArea(
    {
      x: area.x + area.width - size,
      y: area.y + area.height - size,
      width: size,
      height: size
    },
    area
  )
  return { x: bounds.x, y: bounds.y }
}

export function placePopup(
  orb: Rect,
  popupSize: { width: number; height: number },
  area: Rect
): Rect {
  const above = orb.y - popupSize.height
  const left = orb.x - popupSize.width
  const below = orb.y + orb.height
  const right = orb.x + orb.width

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
  size = ORB_WINDOW_SIZE
): { x: number; y: number } {
  const raw = {
    x: Math.round(cursor.x - grab.x),
    y: Math.round(cursor.y - grab.y),
    width: size,
    height: size
  }
  const area = areaForPoint(cursor, areas)
  if (area === null) return { x: raw.x, y: raw.y }

  const clamped = clampToArea(raw, area)
  return { x: clamped.x, y: clamped.y }
}
