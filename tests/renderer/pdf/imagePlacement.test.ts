import { describe, expect, test } from 'vitest'
import { imageBoxAtPoint } from '../../../src/renderer/src/features/ink/imagePlacement'

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
