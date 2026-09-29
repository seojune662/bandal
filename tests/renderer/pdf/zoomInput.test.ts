import { expect, test } from 'vitest'
import { wheelZoomFactor } from '../../../src/renderer/src/features/pdf/lib/zoomInput'

test('zoom respects gesture magnitude and normalizes line/page wheel units', () => {
  expect(wheelZoomFactor(-20, 0, 800)).toBeGreaterThan(wheelZoomFactor(-2, 0, 800))
  expect(wheelZoomFactor(1, 1, 800)).toBe(wheelZoomFactor(16, 0, 800))
  expect(wheelZoomFactor(.1, 2, 800)).toBe(wheelZoomFactor(80, 0, 800))
  expect(wheelZoomFactor(-20, 0, 800) * wheelZoomFactor(20, 0, 800)).toBeCloseTo(1)
  expect(wheelZoomFactor(Number.NaN, 0, 800)).toBe(1)
})
