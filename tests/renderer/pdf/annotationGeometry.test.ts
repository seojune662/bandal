import { describe, expect, test } from 'vitest'
import {
  denormalizeRect,
  mergeRects,
  normalizeRect,
  normalizeSelectionRects,
  rectsBoundingBox,
  rectsContainPoint,
  type RectLike
} from '../../../src/renderer/src/features/pdf/lib/annotationGeometry'
import type { AnnotationRect } from '../../../src/shared/types/annotation'

const page: RectLike = { left: 100, top: 200, width: 800, height: 1000 }

describe('normalizeRect', () => {
  test('converts client coordinates into page-relative fractions', () => {
    // Arrange
    const rect: RectLike = { left: 300, top: 450, width: 200, height: 20 }

    // Act
    const normalized = normalizeRect(rect, page)

    // Assert
    expect(normalized.x).toBeCloseTo(0.25, 9)
    expect(normalized.y).toBeCloseTo(0.25, 9)
    expect(normalized.width).toBeCloseTo(0.25, 9)
    expect(normalized.height).toBeCloseTo(0.02, 9)
  })

  test('clamps rects that spill outside the page to 0..1', () => {
    const rect: RectLike = { left: 0, top: 100, width: 2000, height: 2000 }

    const normalized = normalizeRect(rect, page)

    expect(normalized.x).toBe(0)
    expect(normalized.y).toBe(0)
    expect(normalized.x + normalized.width).toBeLessThanOrEqual(1)
    expect(normalized.y + normalized.height).toBeLessThanOrEqual(1)
  })

  test('degenerate page produces a zero rect instead of NaN', () => {
    const rect: RectLike = { left: 10, top: 10, width: 5, height: 5 }

    const normalized = normalizeRect(rect, {
      left: 0,
      top: 0,
      width: 0,
      height: 0
    })

    expect(normalized).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('round-trip', () => {
  test('normalize → denormalize reproduces the original page-space box', () => {
    // Arrange
    const rect: RectLike = { left: 260, top: 730, width: 313, height: 17 }

    // Act
    const normalized = normalizeRect(rect, page)
    const roundTripped = denormalizeRect(normalized, page.width, page.height)

    // Assert (page-space: original minus page origin)
    expect(roundTripped.left).toBeCloseTo(rect.left - page.left, 6)
    expect(roundTripped.top).toBeCloseTo(rect.top - page.top, 6)
    expect(roundTripped.width).toBeCloseTo(rect.width, 6)
    expect(roundTripped.height).toBeCloseTo(rect.height, 6)
  })

  test('denormalizing at a different zoom scales proportionally', () => {
    const normalized: AnnotationRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.05 }

    const atZoom = denormalizeRect(normalized, 1600, 2000)

    expect(atZoom).toEqual({ left: 160, top: 400, width: 800, height: 100 })
  })
})

describe('mergeRects', () => {
  test('unions overlapping fragments on the same text line', () => {
    // Arrange: two fragments of one line, as Range.getClientRects produces
    const fragments: AnnotationRect[] = [
      { x: 0.1, y: 0.5, width: 0.2, height: 0.02 },
      { x: 0.3, y: 0.5, width: 0.15, height: 0.02 }
    ]

    // Act
    const merged = mergeRects(fragments)

    // Assert
    expect(merged).toHaveLength(1)
    expect(merged[0]?.x).toBeCloseTo(0.1, 9)
    expect(merged[0]?.y).toBeCloseTo(0.5, 9)
    expect(merged[0]?.width).toBeCloseTo(0.35, 9)
    expect(merged[0]?.height).toBeCloseTo(0.02, 9)
  })

  test('keeps rects on different lines separate', () => {
    const lines: AnnotationRect[] = [
      { x: 0.1, y: 0.5, width: 0.4, height: 0.02 },
      { x: 0.1, y: 0.55, width: 0.4, height: 0.02 }
    ]

    expect(mergeRects(lines)).toHaveLength(2)
  })

  test('drops sub-pixel noise rects', () => {
    const rects: AnnotationRect[] = [
      { x: 0.1, y: 0.5, width: 0.0001, height: 0.02 },
      { x: 0.1, y: 0.5, width: 0.2, height: 0.0002 }
    ]

    expect(mergeRects(rects)).toHaveLength(0)
  })
})

describe('normalizeSelectionRects', () => {
  test('full pipeline normalizes then merges line fragments', () => {
    const clientRects: RectLike[] = [
      { left: 180, top: 700, width: 160, height: 20 },
      { left: 340, top: 700, width: 120, height: 20 }
    ]

    const result = normalizeSelectionRects(clientRects, page)

    expect(result).toHaveLength(1)
    expect(result[0]?.x).toBeCloseTo(0.1, 6)
    expect(result[0]?.width).toBeCloseTo(0.35, 6)
  })

  test('returns empty array when nothing usable remains', () => {
    expect(normalizeSelectionRects([], page)).toEqual([])
  })
})

describe('hit testing', () => {
  const rects: AnnotationRect[] = [
    { x: 0.1, y: 0.5, width: 0.2, height: 0.02 },
    { x: 0.1, y: 0.55, width: 0.3, height: 0.02 }
  ]

  test('detects points inside any rect', () => {
    expect(rectsContainPoint(rects, 0.15, 0.51)).toBe(true)
    expect(rectsContainPoint(rects, 0.35, 0.56)).toBe(true)
  })

  test('rejects points outside all rects', () => {
    expect(rectsContainPoint(rects, 0.5, 0.5)).toBe(false)
    expect(rectsContainPoint(rects, 0.15, 0.6)).toBe(false)
  })

  test('bounding box spans all rects', () => {
    const box = rectsBoundingBox(rects)
    expect(box.x).toBeCloseTo(0.1, 9)
    expect(box.y).toBeCloseTo(0.5, 9)
    expect(box.width).toBeCloseTo(0.3, 9)
    expect(box.height).toBeCloseTo(0.07, 9)
  })

  test('bounding box of no rects is the zero rect', () => {
    expect(rectsBoundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
