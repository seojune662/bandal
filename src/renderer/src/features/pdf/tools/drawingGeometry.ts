import { getStroke } from 'perfect-freehand'
import type {
  Drawing,
  DrawingBox,
  DrawingColor,
  DrawingPoint,
  DrawingStyle
} from '../../../../../shared/types/drawing'

type Point2 = readonly [number, number]

const STROKE_COORD_SCALE = 1000

export function drawingColorVariable(color: DrawingColor): string {
  return `var(--drawing-color-${color})`
}

export function normalizedPoint(
  element: SVGSVGElement,
  clientX: number,
  clientY: number,
  pressure: number
): DrawingPoint {
  const bounds = element.getBoundingClientRect()
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return {
    x: clamp((clientX - bounds.left) / bounds.width),
    y: clamp((clientY - bounds.top) / bounds.height),
    p: clamp(pressure > 0 ? pressure : 0.5)
  }
}

export function normalizedBox(start: DrawingPoint, end: DrawingPoint): DrawingBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

export function strokePath(
  points: DrawingPoint[],
  style: DrawingStyle,
  aspect: number,
  isHighlighter: boolean
): string {
  if (points.length === 0 || aspect <= 0) return ''
  const outline = getStroke(
    points.map((point) => [
      point.x * STROKE_COORD_SCALE,
      point.y * aspect * STROKE_COORD_SCALE,
      point.p
    ]),
    {
      size: style.width * STROKE_COORD_SCALE,
      thinning: isHighlighter ? 0.08 : 0.62,
      smoothing: 0.55,
      streamline: 0.42,
      simulatePressure: false,
      start: { cap: true, taper: style.width * STROKE_COORD_SCALE * 2 },
      end: { cap: true, taper: style.width * STROKE_COORD_SCALE * 2 },
      last: true
    }
  )
  const first = outline[0]
  if (first === undefined) return ''
  const toPage = (point: Point2): Point2 => [
    point[0] / STROKE_COORD_SCALE,
    point[1] / STROKE_COORD_SCALE / aspect
  ]
  const start = toPage(first)
  let path = `M ${start[0]} ${start[1]}`
  for (let index = 1; index < outline.length - 1; index += 1) {
    const currentRaw = outline[index]
    const nextRaw = outline[index + 1]
    if (currentRaw === undefined || nextRaw === undefined) continue
    const current = toPage(currentRaw)
    const next = toPage(nextRaw)
    path += ` Q ${current[0]} ${current[1]} ${(current[0] + next[0]) / 2} ${(current[1] + next[1]) / 2}`
  }
  return `${path} Z`
}

export function lineEndpoints(drawing: Drawing): [DrawingPoint, DrawingPoint] | null {
  const points = drawing.data.points
  const first = points?.[0]
  const last = points?.[points.length - 1]
  if (first !== undefined && last !== undefined && points !== undefined && points.length >= 2) {
    return [first, last]
  }
  const box = drawing.data.box
  if (box === undefined) return null
  return [
    { x: box.x, y: box.y, p: 0.5 },
    { x: box.x + box.width, y: box.y + box.height, p: 0.5 }
  ]
}

export function arrowHeadPoints(
  start: DrawingPoint,
  end: DrawingPoint,
  width: number,
  aspect: number
): string {
  const startPhysical: Point2 = [start.x, start.y * aspect]
  const endPhysical: Point2 = [end.x, end.y * aspect]
  const angle = Math.atan2(
    endPhysical[1] - startPhysical[1],
    endPhysical[0] - startPhysical[0]
  )
  const size = Math.max(width * 4, 0.012)
  const wing = (offset: number): Point2 => [
    endPhysical[0] - Math.cos(angle + offset) * size,
    (endPhysical[1] - Math.sin(angle + offset) * size) / aspect
  ]
  const left = wing(-Math.PI / 6)
  const right = wing(Math.PI / 6)
  return `${left[0]},${left[1]} ${end.x},${end.y} ${right[0]},${right[1]}`
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.min(1, Math.max(0,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)
  ))
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))
}

function boxPolyline(box: DrawingBox, aspect: number): Point2[] {
  return [
    [box.x, box.y * aspect],
    [box.x + box.width, box.y * aspect],
    [box.x + box.width, (box.y + box.height) * aspect],
    [box.x, (box.y + box.height) * aspect],
    [box.x, box.y * aspect]
  ]
}

function ellipsePolyline(box: DrawingBox, aspect: number): Point2[] {
  const points: Point2[] = []
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  for (let index = 0; index <= 32; index += 1) {
    const angle = index / 32 * Math.PI * 2
    points.push([
      centerX + Math.cos(angle) * box.width / 2,
      (centerY + Math.sin(angle) * box.height / 2) * aspect
    ])
  }
  return points
}

function drawingPolyline(drawing: Drawing, aspect: number): Point2[] {
  if (drawing.kind === 'ink' || drawing.kind === 'highlighter') {
    return (drawing.data.points ?? []).map((point) => [point.x, point.y * aspect])
  }
  if (drawing.kind === 'line' || drawing.kind === 'arrow') {
    const endpoints = lineEndpoints(drawing)
    return endpoints === null
      ? []
      : endpoints.map((point) => [point.x, point.y * aspect])
  }
  const box = drawing.data.box
  if (box === undefined) return []
  return drawing.kind === 'ellipse'
    ? ellipsePolyline(box, aspect)
    : boxPolyline(box, aspect)
}

export function drawingHit(
  drawing: Drawing,
  point: DrawingPoint,
  aspect: number
): boolean {
  const polyline = drawingPolyline(drawing, aspect)
  if (polyline.length === 0) return false
  const target: Point2 = [point.x, point.y * aspect]
  const threshold = Math.max(0.007, drawing.style.width / 2 + 0.005)
  if (polyline.length === 1) {
    const only = polyline[0]
    return only !== undefined && Math.hypot(target[0] - only[0], target[1] - only[1]) <= threshold
  }
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1]
    const end = polyline[index]
    if (start !== undefined && end !== undefined && pointSegmentDistance(target, start, end) <= threshold) {
      return true
    }
  }
  return false
}
