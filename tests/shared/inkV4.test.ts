import { describe, expect, test } from 'vitest'
import type { DrawingPoint } from '../../src/shared/types/drawing'
import { filteredPressuresV3, strokePolygonsV3 } from '../../src/shared/inkV3'
import { cubicControlsV4, predictionPolygonsV4, segmentSamplesV4, strokeCenterlineV4, strokePathV4, strokePolygonsV4, strokeSegmentsV4 } from '../../src/shared/inkV4'

const point = (x: number, y: number, p = .4, t = 0): DrawingPoint => ({ x, y, p, t })
const arch = [point(.1, .4, 0, 0), point(.3, .2, 1, 4), point(.7, .2, 0, 8), point(.9, .4, 1, 12)]

describe('render-only centripetal ink v4', () => {
  test('uses centripetal Hermite controls for unequal collinear intervals', () => {
    const controls = cubicControlsV4([point(0, 0), point(1, 0), point(5, 0), point(6, 0)], 1, 1)!
    expect(controls.control1[0]).toBeCloseTo(17 / 9, 14)
    expect(controls.control2[0]).toBeCloseTo(37 / 9, 14)
    expect(controls.control1[1]).toBe(0); expect(controls.control2[1]).toBe(0)
  })
  test('sharp corners and duplicate neighbors have zero endpoint handles', () => {
    const elbow = [point(-1, 0), point(0, 0), point(1, 0), point(1, 1)]
    const controls = cubicControlsV4(elbow, 1, 1)!
    expect(controls.control2).toEqual(controls.end)
    expect(segmentSamplesV4(elbow, 1, .004, 1, [1, 1, 1, 1]).every(p => p.y === 0)).toBe(true)
    const sixty = [point(.125, .25), point(.375, .25), point(.5, .25 + Math.sqrt(3) / 8)]
    expect(cubicControlsV4(sixty, 0, 1)!.control2).toEqual([.375, .25])
    const reversal = [point(0, 0), point(1, 0), point(0, 0)]
    expect(cubicControlsV4(reversal, 0, 1)!.control2).toEqual([1, 0])
    const duplicate = [point(0, 0), point(0, 0), point(1, 0)]
    expect(cubicControlsV4(duplicate, 1, 1)!.control1).toEqual([0, 0])
  })
  test('shows one- and two-point input immediately and preserves pressure-only dots', () => {
    const dot = [point(.3, .4, .2)]
    expect(strokePolygonsV4(dot, .004, 2, false)).toEqual(strokePolygonsV3(dot, .004, 2, false))
    const line = [...dot, point(.7, .4, .8, 4)]
    expect(strokeCenterlineV4(line, .004, 2)).toEqual(line.map((p, i) => ({ x: p.x, y: p.y, p: filteredPressuresV3(line)[i]! })))
    const stationary = [point(.3, .4, 0, 0), point(.3, .4, 1, 32)]
    expect(strokePolygonsV4(stationary, .004, 2, false)).toEqual(strokePolygonsV3(stationary, .004, 2, false))
  })
  test('smooths sparse circles with lower radial error while keeping every measured endpoint exact', () => {
    const circle = Array.from({ length: 19 }, (_, i) => point(Math.cos((i - 1) * Math.PI / 8), Math.sin((i - 1) * Math.PI / 8), .4, i * 4))
    const samples = segmentSamplesV4(circle, 4, .004, 1, filteredPressuresV3(circle))
    const curveError = Math.max(...samples.map(p => Math.abs(1 - Math.hypot(p.x, p.y))))
    const a = circle[4]!, b = circle[5]!, chordError = 1 - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2)
    expect(curveError).toBeLessThan(chordError / 20)
    for (const { index, samples: part } of strokeSegmentsV4(circle, .004, 1)) {
      expect(part.at(-1)).toEqual({ x: circle[index + 1]!.x, y: circle[index + 1]!.y, p: .4 })
      expect(part.length).toBeLessThanOrEqual(33)
    }
  })
  test('checks both controls for S-curve flatness even when its midpoint lies on the chord', () => {
    const points = [point(-1, -.5), point(0, 0), point(1, 0), point(2, .5)]
    const samples = segmentSamplesV4(points, 1, .004, 1, [1, 1, 1, 1])
    expect(samples.length).toBeGreaterThan(3)
    expect(Math.min(...samples.map(p => p.y))).toBeLessThan(-.01)
    expect(Math.max(...samples.map(p => p.y))).toBeGreaterThan(.01)
  })
  test('filters raw force exactly once, interpolates it, and leaves coordinates and metadata untouched', () => {
    const raw = Object.freeze(arch.map(p => Object.freeze({ ...p, tiltX: 12, tiltY: -21 })))
    const before = JSON.stringify(raw), pressures = filteredPressuresV3(raw)
    for (const { index, samples } of strokeSegmentsV4(raw, .004, 1.5)) {
      expect(samples[0]!.p).toBe(pressures[index])
      expect(samples.at(-1)!.p).toBe(pressures[index + 1])
      for (const sample of samples) {
        expect(sample.p).toBeGreaterThanOrEqual(Math.min(pressures[index]!, pressures[index + 1]!))
        expect(sample.p).toBeLessThanOrEqual(Math.max(pressures[index]!, pressures[index + 1]!))
      }
    }
    strokePathV4(raw, .004, 1.5, false)
    expect(JSON.stringify(raw)).toBe(before)
  })
  test('appending measured points only revises the previous trailing segment', () => {
    const full = [...arch, point(1.1, .5, .2, 16)]
    const oldSegments = [...strokeSegmentsV4(arch, .004, 1)]
    const nextSegments = [...strokeSegmentsV4(full, .004, 1)]
    expect(nextSegments.slice(0, -2)).toEqual(oldSegments.slice(0, -1))
    expect(nextSegments.at(-2)).not.toEqual(oldSegments.at(-1))
  })
  test('emits convex consistently wound disks/tangents suitable for one SVG fill and triangle fans', () => {
    for (const polygon of strokePolygonsV4(arch, .004, 1.5, false)) {
      expect([4, 32]).toContain(polygon.length)
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, c = polygon[(i + 2) % polygon.length]!
        expect((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])).toBeGreaterThanOrEqual(-1e-15)
      }
    }
  })
  test('prediction pressure never changes the measured curve or the constant filtered-force tail', () => {
    const predictions = Array.from({ length: 12 }, (_, i) => point(.92 + i * .01, .42 + i * .01, i % 2, 16 + i * 4))
    const before = strokePathV4(arch, .004, 1.5, false)
    const tail = predictionPolygonsV4(arch, predictions, .004, 1.5, false)
    expect(tail).toEqual(predictionPolygonsV4(arch, predictions.map(p => ({ ...p, p: NaN })), .004, 1.5, false))
    expect(tail).toHaveLength(16)
    const pressure = filteredPressuresV3(arch).at(-1)!, radius = .004 * (.42 + .2 * pressure) / 2
    expect(tail.filter(p => p.length === 32).map((p, i) => p[0]![0] - predictions[i]!.x)).toEqual(Array(8).fill(radius).map((_, i) => predictions[i]!.x + radius - predictions[i]!.x))
    expect(strokePathV4(arch, .004, 1.5, false)).toBe(before)
  })
  test('rejects invalid metric geometry, preserves highlighter width, and is deterministic', () => {
    expect(strokePolygonsV4([point(.2, 1e308)], .004, 2, false)).toEqual([])
    expect(strokePathV4(arch, NaN, 1, false)).toBe('')
    expect(strokePolygonsV4([], .004, 1, false)).toEqual([])
    expect(strokePolygonsV4(arch, .004, 1.5, true)).toEqual(strokePolygonsV4(arch.map(p => ({ ...p, p: 1 })), .004, 1.5, true))
    expect(strokePathV4(arch, .004, 1.5, false)).toBe(strokePathV4(arch, .004, 1.5, false))
  })
})
