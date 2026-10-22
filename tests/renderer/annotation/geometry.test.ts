import { expect, test } from 'vitest'
import { dragBounds, intersectBounds, normalizeBounds } from '../../../src/renderer/src/features/annotation/geometry'
import { boundedCaptureRect } from '../../../src/main/features/browser/annotationCapture'

test('normalizes a clipped PDF region independently of screen scale and split-pane offset', () => {
  const page = { x: 340, y: 120, width: 600, height: 800 }
  const rect = intersectBounds(dragBounds({ x: 700, y: 450 }, { x: 400, y: 200 }), page)!
  expect(normalizeBounds(rect, page)).toEqual({ x: .1, y: .1, width: .5, height: .3125 })
  expect(normalizeBounds({ x: 100, y: 0, width: 500, height: 400 }, page)).toEqual({ x: 0, y: 0, width: 260 / 600, height: 280 / 800 })
})

test('converts viewport CSS pixels to capture DIP and clips only at its own viewport', () => {
  expect(boundedCaptureRect({ x: 12.4, y: 20.2, width: 20.2, height: 30.4 }, { width: 100, height: 100 }, 1.25)).toEqual({ x: 15, y: 25, width: 26, height: 39 })
  expect(() => boundedCaptureRect({ x: 500, y: 0, width: 5, height: 5 }, { width: 100, height: 100 })).toThrow()
})
