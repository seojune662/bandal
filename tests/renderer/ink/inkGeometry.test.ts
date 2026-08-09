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

  test('does not create a path for empty, one-point, or zero-length strokes', () => {
    expect(strokePath([], shape({}).style, Math.SQRT2, false)).toBe('')
    expect(strokePath([start], shape({}).style, Math.SQRT2, false)).toBe('')
    expect(strokePath([start, { ...start }], shape({}).style, Math.SQRT2, false)).toBe('')
  })

  test.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not throw or draw with an invalid aspect (%s)',
    (aspect) => {
      expect(() => strokePath([start, end], shape({}).style, aspect, false)).not.toThrow()
      expect(strokePath([start, end], shape({}).style, aspect, false)).toBe('')
    }
  )

  test('does not draw a stroke whose width is zero', () => {
    const zeroWidth = shape({ style: { color: 'ink', width: 0, opacity: 1 } })

    expect(strokePath([start, end], zeroWidth.style, Math.SQRT2, false)).toBe('')
  })

  test('hits an ink polyline within the eraser threshold', () => {
    const ink = shape({})

    expect(drawingHit(ink, { x: 0.5, y: 0.4, p: 0.5 }, Math.SQRT2)).toBe(true)
    expect(drawingHit(ink, { x: 0.05, y: 0.9, p: 0.5 }, Math.SQRT2)).toBe(false)
  })

  test('keeps degenerate saved shapes reachable by the eraser', () => {
    const onePointInk = shape({ data: { points: [start] } })
    const emptyInk = shape({ id: 'empty-shape', data: { points: [] } })
    const zeroSizeRect = shape({
      kind: 'rect',
      data: { box: { x: start.x, y: start.y, width: 0, height: 0 } }
    })

    expect(drawingHit(onePointInk, start, Number.NaN)).toBe(true)
    expect(drawingHit(emptyInk, end, Math.SQRT2)).toBe(true)
    expect(drawingHit(zeroSizeRect, start, Math.SQRT2)).toBe(true)
  })

  test('hits the interior of an invisible empty textbox', () => {
    const textbox = shape({
      kind: 'textbox',
      data: {
        box: { x: 0.2, y: 0.2, width: 0.4, height: 0.3 },
        text: ''
      }
    })

    expect(drawingHit(textbox, { x: 0.4, y: 0.35, p: 0.5 }, Math.SQRT2)).toBe(true)
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

  test.each([
    ['nw', 0.25, 0.3, 0.35, 0.2],
    ['ne', 0.2, 0.3, 0.45, 0.2],
    ['sw', 0.25, 0.25, 0.35, 0.3],
    ['se', 0.2, 0.25, 0.45, 0.3]
  ] as const)(
    'resizes from the %s handle while keeping its opposite corner fixed',
    (handle, x, y, width, height) => {
      const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.25 }
      const resized = resizeDrawingBox(original, 0.05, 0.05, true, handle)

      expect(resized.x).toBeCloseTo(x)
      expect(resized.y).toBeCloseTo(y)
      expect(resized.width).toBeCloseTo(width)
      expect(resized.height).toBeCloseTo(height)

      const originalOppositeX = handle === 'nw' || handle === 'sw'
        ? original.x + original.width
        : original.x
      const resizedOppositeX = handle === 'nw' || handle === 'sw'
        ? resized.x + resized.width
        : resized.x
      const originalOppositeY = handle === 'nw' || handle === 'ne'
        ? original.y + original.height
        : original.y
      const resizedOppositeY = handle === 'nw' || handle === 'ne'
        ? resized.y + resized.height
        : resized.y
      expect(resizedOppositeX).toBeCloseTo(originalOppositeX)
      expect(resizedOppositeY).toBeCloseTo(originalOppositeY)
    }
  )

  test('keeps the old southeast resize behavior as the default', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.25 }

    expect(resizeDrawingBox(original, 0.05, 0.05)).toEqual(
      resizeDrawingBox(original, 0.05, 0.05, true, 'se')
    )
  })
})
