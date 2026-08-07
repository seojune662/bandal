import { describe, expect, test } from 'vitest'
import type {
  DrawingPoint,
  DrawingShape
} from '../../../src/shared/types/drawing'
import {
  arrowHeadPoints,
  drawingHit,
  moveDrawingBox,
  normalizedBox,
  normalizedPoint,
  resizeDrawingBox,
  strokePath
} from '../../../src/renderer/src/features/ink/inkGeometry'

const start: DrawingPoint = { x: 0.8, y: 0.7, p: 0.4 }
const end: DrawingPoint = { x: 0.2, y: 0.1, p: 0.9 }

function shape(overrides: Partial<DrawingShape>): DrawingShape {
  return {
    id: 'shape-1',
    kind: 'ink',
    data: { points: [start, end] },
    style: { color: 'ink', width: 0.006, opacity: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('inkGeometry', () => {
  test('normalizes reverse drags to a positive top-left box', () => {
    expect(normalizedBox(start, end)).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.6000000000000001,
      height: 0.6
    })
  })

  test('creates a pressure-aware closed perfect-freehand path', () => {
    const path = strokePath([start, end], shape({}).style, Math.SQRT2, false)

    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith(' Z')).toBe(true)
    expect(path).toContain(' Q ')
  })

  test('hits an ink polyline within the eraser threshold', () => {
    const ink = shape({})

    expect(drawingHit(ink, { x: 0.5, y: 0.4, p: 0.5 }, Math.SQRT2)).toBe(true)
    expect(drawingHit(ink, { x: 0.05, y: 0.9, p: 0.5 }, Math.SQRT2)).toBe(false)
  })

  test('hits shape outlines without treating their center as a stroke', () => {
    const rect = shape({
      kind: 'rect',
      data: { box: { x: 0.2, y: 0.2, width: 0.4, height: 0.3 } }
    })

    expect(drawingHit(rect, { x: 0.4, y: 0.2, p: 0.5 }, Math.SQRT2)).toBe(true)
    expect(drawingHit(rect, { x: 0.4, y: 0.35, p: 0.5 }, Math.SQRT2)).toBe(false)
  })

  test('arrow head keeps the normalized end point for reverse directions', () => {
    expect(arrowHeadPoints(start, end, 0.006, Math.SQRT2)).toContain(`${end.x},${end.y}`)
  })

  test('preserves points and boxes beyond 0..1 when bounds clamping is disabled', () => {
    const surface = {
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 400, height: 200 })
    } as SVGSVGElement
    const point = normalizedPoint(surface, 540, 180, 0.5, false)
    const box = { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }

    expect(point.x).toBeCloseTo(1.1)
    expect(point.y).toBeCloseTo(-0.1)
    const moved = moveDrawingBox(box, 0.25, -1, false)
    const resized = resizeDrawingBox(box, 0.3, 0.4, false)

    expect(moved.x).toBeCloseTo(1.05)
    expect(moved.y).toBeCloseTo(-0.2)
    expect(resized.width).toBeCloseTo(0.5)
    expect(resized.height).toBeCloseTo(0.6)
  })
})
