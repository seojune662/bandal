import { describe, expect, test } from 'vitest'
import type { DrawingPoint } from '../../src/shared/types/drawing'
import { assertDrawingData } from '../../src/main/features/drawingValidation'
import { strokePolygonsV4 } from '../../src/shared/inkV4'
import { diameterFactorsV5, filteredPressureV5, predictionPolygonsV5, renderProfileV5, strokePathV5, strokePolygonsV5 } from '../../src/shared/inkV5'

const measured: DrawingPoint[] = [
  { x: .1, y: .2, p: 0, t: 0, tiltX: -30, tiltY: 10 },
  { x: .3, y: .4, p: 1, t: 4, tiltX: 45, tiltY: -20 },
  { x: .7, y: .3, p: .4, t: 8, tiltX: 10, tiltY: 30 }
]

describe('iPad-compatible ink v5', () => {
  test('keeps measured pressure, timestamps and tilt through validation and rendering', () => {
    const input = { inkVersion: 5, points: measured }, before = JSON.stringify(input)
    expect(assertDrawingData(input, 'ink')).toEqual(input)
    expect(strokePathV5(measured, .004, 1.5, false)).toMatch(/^M /)
    expect(JSON.stringify(input)).toBe(before)
    expect(() => assertDrawingData({ ...input, inkVersion: 6 }, 'ink')).toThrow()
    expect(() => assertDrawingData({ inkVersion: 5, box: { x: 0, y: 0, width: .1, height: .1 } }, 'rect')).toThrow()
  })

  test('uses causal measured pressure and does not let dwelling thicken a stable tip', () => {
    expect(filteredPressureV5(measured, 1)).toBeCloseTo(1 / (1 + Math.exp(-.5)), 14)
    expect(diameterFactorsV5([{ x: .5, y: .5, p: 0 }], .01, 1, false)).toEqual([.18])
    const path = Array.from({ length: 20 }, (_, i) => ({ x: .1 + i * .02, y: .4, p: .6, t: i * 4 }))
    const dwell = [...path, ...Array.from({ length: 40 }, (_, i) => ({ ...path.at(-1)!, t: 80 + i * 4 }))]
    expect(renderProfileV5(dwell, .004, 1.5, false).points).toHaveLength(path.length)
    expect(strokePathV5(dwell, .004, 1.5, false)).toBe(strokePathV5(path, .004, 1.5, false))
  })

  test('retains fixed highlighter geometry and ignores prediction force', () => {
    expect(strokePolygonsV5(measured, .02, 1.5, true)).toEqual(strokePolygonsV4(measured, .02, 1.5, true))
    const predictions = [{ x: .8, y: .3, p: 0, t: 12 }, { x: .9, y: .3, p: 1, t: 16 }]
    expect(predictionPolygonsV5(measured, predictions, .004, 1.5, false)).toEqual(
      predictionPolygonsV5(measured, predictions.map(point => ({ ...point, p: NaN, t: -1 })), .004, 1.5, false)
    )
  })
})
