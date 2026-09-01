import { describe, expect, test } from 'vitest'
import { healedImageBox, imageBoxAtPoint } from '../../../src/renderer/src/features/ink/imagePlacement'

describe('PDF image placement', () => {
  test('preserves the image screen ratio on a portrait page', () => {
    const box = imageBoxAtPoint({ x: 0.5, y: 0.5 }, Math.SQRT2, 0.5)

    expect(box.width).toBe(0.4)
    expect(box.height * Math.SQRT2 / box.width).toBeCloseTo(0.5)
  })

  test('fits tall images and clamps drops to page edges', () => {
    const box = imageBoxAtPoint({ x: 0.99, y: 0.01 }, Math.SQRT2, 3)

    expect(box.height).toBeCloseTo(0.4)
    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y).toBe(0)
  })

  test('falls back safely when dimensions are not measurable', () => {
    const box = imageBoxAtPoint({ x: 0.5, y: 0.5 }, 0, Number.NaN)

    expect(box).toEqual({ x: 0.3, y: 0.3, width: 0.4, height: 0.4 })
  })
})

describe('healedImageBox', () => {
  test('returns null when the box already matches within 1%', () => {
    // width 0.4, surface √2 → height = width·imageAspect/surface
    const imageAspect = 0.5
    const box = { x: 0.3, y: 0.3, width: 0.4, height: (0.4 * imageAspect) / Math.SQRT2 }
    expect(healedImageBox(box, Math.SQRT2, imageAspect)).toBeNull()
  })

  test('restores the natural ratio for a square fallback box, keeping the center', () => {
    const square = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }
    const healed = healedImageBox(square, Math.SQRT2, 0.5)

    expect(healed).not.toBeNull()
    expect(healed!.width).toBeCloseTo(0.4)
    expect((healed!.height * Math.SQRT2) / healed!.width).toBeCloseTo(0.5)
    // 세로 중심 유지
    expect(healed!.y + healed!.height / 2).toBeCloseTo(0.5)
  })

  test('re-feeding a healed box yields null — no update loop', () => {
    const square = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }
    const healed = healedImageBox(square, Math.SQRT2, 0.5)
    expect(healed).not.toBeNull()
    expect(healedImageBox(healed!, Math.SQRT2, 0.5)).toBeNull()
  })

  test('clamps to the page and shrinks width when the healed height overflows', () => {
    const wide = { x: 0.05, y: 0.9, width: 0.9, height: 0.05 }
    const healed = healedImageBox(wide, 1, 2)

    expect(healed).not.toBeNull()
    expect(healed!.height).toBeLessThanOrEqual(1)
    expect(healed!.y).toBeGreaterThanOrEqual(0)
    expect(healed!.y + healed!.height).toBeLessThanOrEqual(1)
    expect((healed!.height * 1) / healed!.width).toBeCloseTo(2)
  })

  test('ignores unmeasurable inputs', () => {
    const box = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }
    expect(healedImageBox(box, 0, 0.5)).toBeNull()
    expect(healedImageBox(box, Math.SQRT2, Number.NaN)).toBeNull()
  })
})
