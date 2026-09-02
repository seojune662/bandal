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

  test('clamps a move derived from off-surface pointer samples into the page', () => {
    const surface = {
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 400, height: 200 })
    } as SVGSVGElement
    const pointerStart = normalizedPoint(surface, 220, 260, 0.5, false)
    const pointerOutside = normalizedPoint(surface, -300, 700, 0.5, false)
    const original = { x: 0.2, y: 0.25, width: 0.3, height: 0.2 }
    const moved = moveDrawingBox(
      original,
      pointerOutside.x - pointerStart.x,
      pointerOutside.y - pointerStart.y
    )

    expect(moved.x).toBeGreaterThanOrEqual(0)
    expect(moved.y).toBeGreaterThanOrEqual(0)
    expect(moved.x + moved.width).toBeLessThanOrEqual(1)
    expect(moved.y + moved.height).toBeLessThanOrEqual(1)
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

  test.each([
    ['nw', 0.1, 0.02, 0.288, 0.294, 0.312, 0.156],
    ['ne', 0.1, 0.02, 0.2, 0.214, 0.472, 0.236],
    ['sw', -0.1, 0.02, 0.112, 0.25, 0.488, 0.244],
    ['se', 0.1, 0.02, 0.2, 0.25, 0.488, 0.244]
  ] as const)(
    'locks image aspect from the %s handle via diagonal projection',
    (handle, dx, dy, x, y, width, height) => {
      const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
      const resized = resizeDrawingBox(original, dx, dy, true, handle, true)

      expect(resized.x).toBeCloseTo(x)
      expect(resized.y).toBeCloseTo(y)
      expect(resized.width).toBeCloseTo(width)
      expect(resized.height).toBeCloseTo(height)
      expect(resized.width / resized.height).toBeCloseTo(
        original.width / original.height
      )
    }
  )

  test('blends vertical-leaning drags instead of snapping to one axis', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    const resized = resizeDrawingBox(original, 0.01, 0.1, true, 'se', true)

    // 사영 스케일 1 + (0.4·0.01 + 0.2·0.1)/0.2 = 1.12.
    expect(resized.width).toBeCloseTo(0.448)
    expect(resized.height).toBeCloseTo(0.224)
    expect(resized.width / resized.height).toBeCloseTo(2)
  })

  test('a locked resize is continuous across the old dominant-axis boundary', () => {
    // 납작한 텍스트박스 + 45° 화면 드래그가 정확히 예전 지배축 경계였다 —
    // 경계 양쪽의 거의 같은 델타가 프레임마다 수 배씩 튀던 회귀 시나리오.
    const squat = { x: 0.3, y: 0.3, width: 0.26, height: 0.107 }
    const aspect = 0.75
    const below = resizeDrawingBox(squat, 0.1, 0.133, true, 'se', true, aspect)
    const above = resizeDrawingBox(squat, 0.1, 0.134, true, 'se', true, aspect)

    expect(Math.abs(above.width - below.width)).toBeLessThan(0.005)
    expect(Math.abs(above.height - below.height)).toBeLessThan(0.005)
  })

  test.each(['nw', 'ne', 'sw', 'se'] as const)(
    'keeps image minimum dimensions and aspect at the %s handle',
    (handle) => {
      const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
      const dx = handle === 'nw' || handle === 'sw' ? 0.5 : -0.5
      const resized = resizeDrawingBox(original, dx, 0, true, handle, true)

      expect(resized.width).toBeCloseTo(0.05)
      expect(resized.height).toBeCloseTo(0.025)
      expect(resized.width / resized.height).toBeCloseTo(2)
    }
  )
})

describe('resizeDrawingBox — 경계·최소 크기 충돌·aspect 지배축', () => {
  test('locked resize never grows past the page bounds', () => {
    const original = { x: 0.7, y: 0.8, width: 0.29, height: 0.19 }
    const resized = resizeDrawingBox(original, 0.5, 0.5, true, 'se', true)

    expect(resized.x + resized.width).toBeLessThanOrEqual(1)
    expect(resized.y + resized.height).toBeLessThanOrEqual(1)
    expect(resized.x).toBeGreaterThanOrEqual(0)
    expect(resized.y).toBeGreaterThanOrEqual(0)
  })

  test('the bounds win when the minimum size cannot fit (thin banner in a corner)', () => {
    // width 0.4 는 남은 공간 0.02 를 넘고, height 0.01 은 최소 높이(0.025)보다
    // 작아 minimumScale > maximumScale 이 된다 — 경계가 이겨야 한다.
    const original = { x: 0.98, y: 0.98, width: 0.4, height: 0.01 }
    const resized = resizeDrawingBox(original, 0.5, 0.5, true, 'se', true)

    expect(resized.x + resized.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(resized.y + resized.height).toBeLessThanOrEqual(1 + 1e-9)
    expect(resized.x).toBeGreaterThanOrEqual(0)
    expect(resized.y).toBeGreaterThanOrEqual(0)
  })

  test('the surface aspect weights dy in the projection', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    // 세로로 긴 표면(√2)에서는 같은 dy 도 화면 픽셀로 더 길다 — 사영에
    // aspect 가 반영돼 결과가 달라져야 한다.
    const withAspect = resizeDrawingBox(
      original, 0.05, 0.1, true, 'se', true, Math.SQRT2
    )
    const withoutAspect = resizeDrawingBox(original, 0.05, 0.1, true, 'se', true)

    expect(withAspect.width).toBeCloseTo(0.5)
    expect(withAspect.height).toBeCloseTo(0.25)
    expect(withoutAspect.width).toBeCloseTo(0.48)
    expect(withAspect.width).not.toBeCloseTo(withoutAspect.width)
  })

  test('the e handle changes width only (reflow resize)', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    const resized = resizeDrawingBox(original, 0.1, 0.3, true, 'e')

    expect(resized.width).toBeCloseTo(0.5)
    expect(resized.height).toBeCloseTo(0.2)
    expect(resized.x).toBeCloseTo(0.2)
    expect(resized.y).toBeCloseTo(0.25)
  })

  test('the w handle moves x and keeps the right edge fixed', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    const resized = resizeDrawingBox(original, 0.1, -0.3, true, 'w')

    expect(resized.x).toBeCloseTo(0.3)
    expect(resized.width).toBeCloseTo(0.3)
    expect(resized.x + resized.width).toBeCloseTo(0.6)
    expect(resized.height).toBeCloseTo(0.2)
    expect(resized.y).toBeCloseTo(0.25)
  })

  test('edge handles respect the minimum width and the page bound', () => {
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    expect(resizeDrawingBox(original, -0.9, 0, true, 'e').width).toBeCloseTo(0.03)
    const grown = resizeDrawingBox(original, 0.9, 0, true, 'e')
    expect(grown.x + grown.width).toBeLessThanOrEqual(1 + 1e-9)
  })

  test('lockAspectRatio with an edge handle still changes one axis only', () => {
    // 텍스트박스는 잠금이 아니지만, 방어적으로 엣지+잠금은 축별 분기로 흘러야
    // 한다 — 균일 스케일은 엣지 핸들을 표현할 수 없다.
    const original = { x: 0.2, y: 0.25, width: 0.4, height: 0.2 }
    const resized = resizeDrawingBox(original, 0.1, 0, true, 'e', true)
    expect(resized.height).toBeCloseTo(0.2)
    expect(resized.width).toBeCloseTo(0.5)
  })

  test('moveDrawingBox never returns a negative origin for oversized boxes', () => {
    const oversized = { x: 0, y: 0, width: 1.2, height: 0.5 }
    const moved = moveDrawingBox(oversized, 0.3, 0.2)

    expect(moved.x).toBeGreaterThanOrEqual(0)
    expect(moved.y).toBeGreaterThanOrEqual(0)
  })
})
