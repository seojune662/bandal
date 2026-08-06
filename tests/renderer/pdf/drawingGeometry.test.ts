import { describe, expect, test } from 'vitest'
import type { Drawing, DrawingPoint } from '../../../src/shared/types/drawing'
import {
  arrowHeadPoints,
  drawingHit,
  normalizedBox,
  strokePath
} from '../../../src/renderer/src/features/pdf/tools/drawingGeometry'

const start: DrawingPoint = { x: 0.8, y: 0.7, p: 0.4 }
const end: DrawingPoint = { x: 0.2, y: 0.1, p: 0.9 }

function drawing(overrides: Partial<Drawing>): Drawing {
  return {
    id: 'drawing-1',
    courseId: 'course-1',
    relPath: 'slides.pdf',
    page: 1,
    kind: 'ink',
    data: { points: [start, end] },
    style: { color: 'ink', width: 0.006, opacity: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('drawingGeometry', () => {
  test('normalizes reverse drags to a positive top-left box', () => {
    expect(normalizedBox(start, end)).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.6000000000000001,
      height: 0.6
    })
  })

  test('creates a pressure-aware closed perfect-freehand path', () => {
    const path = strokePath([start, end], drawing({}).style, Math.SQRT2, false)

    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith(' Z')).toBe(true)
    expect(path).toContain(' Q ')
  })

  test('hits an ink polyline within the eraser threshold', () => {
    const ink = drawing({})

    expect(drawingHit(ink, { x: 0.5, y: 0.4, p: 0.5 }, Math.SQRT2)).toBe(true)
    expect(drawingHit(ink, { x: 0.05, y: 0.9, p: 0.5 }, Math.SQRT2)).toBe(false)
  })

  test('hits shape outlines without treating their center as a stroke', () => {
    const rect = drawing({
      kind: 'rect',
      data: { box: { x: 0.2, y: 0.2, width: 0.4, height: 0.3 } }
    })

    expect(drawingHit(rect, { x: 0.4, y: 0.2, p: 0.5 }, Math.SQRT2)).toBe(true)
    expect(drawingHit(rect, { x: 0.4, y: 0.35, p: 0.5 }, Math.SQRT2)).toBe(false)
  })

  test('arrow head keeps the normalized end point for reverse directions', () => {
    expect(arrowHeadPoints(start, end, 0.006, Math.SQRT2)).toContain(`${end.x},${end.y}`)
  })
})
