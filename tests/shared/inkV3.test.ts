import { describe, expect, test } from 'vitest'
import type { DrawingPoint } from '../../src/shared/types/drawing'
import { strokePolygonsV2 } from '../../src/shared/inkV2'
import { filteredPressuresV3, strokePolygonsV3, strokePathV3 } from '../../src/shared/inkV3'

const golden: DrawingPoint[] = [
  { x: .1, y: .2, p: 0, t: 0 }, { x: .103, y: .202, p: .8, t: 4 },
  { x: .106, y: .203, p: .2, t: 12 }, { x: .107, y: .203, p: 1, t: 12 },
  { x: .12, y: .22, p: .6, t: 100 }
]

describe('causal native ink v3', () => {
  test('matches the Swift golden pressure and external tangent vertices', () => {
    const expected = [0, .12281462008750875, .14469425857416682, .14469425857416682, .47998270959249123]
    filteredPressuresV3(golden).forEach((p, i) => expect(p).toBeCloseTo(expected[i]!, 12))
    const quad = strokePolygonsV3(golden, .01, 1.5, false)[1]!
    const vertices = [[.10144131683328605, .19898180862176848], [.1045256095853364, .20092226158019996],
      [.10138339237029992, .20301707305689096], [.09847271293265271, .20096087788885736]]
    quad.forEach((point, i) => point.forEach((value, axis) => expect(value).toBeCloseTo(vertices[i]![axis]!, 12)))
  })
  test('uses 4ms without timing, holds at dt0, and caps long gaps at 32ms', () => {
    const at = (p: number, t?: number): DrawingPoint => ({ x: .2, y: .3, p, ...(t === undefined ? {} : { t }) })
    expect(filteredPressuresV3([at(0), at(1)])[1]).toBeCloseTo(-Math.expm1(-4 / 24), 14)
    expect(filteredPressuresV3([at(.3, 10), at(1, 10), at(0, 8)])).toEqual([.3, .3, .3])
    expect(filteredPressuresV3([at(0, 0), at(1, 1000)])[1]).toBeCloseTo(-Math.expm1(-32 / 24), 14)
  })
  test('preserves every measured prefix and never modifies raw pressure or metadata', () => {
    const points = golden.map(p => Object.freeze({ ...p, tiltX: 12, tiltY: -21 }))
    Object.freeze(points)
    const before = JSON.stringify(points), prefix = strokePolygonsV3(points.slice(0, 3), .004, 2, false)
    const full = strokePolygonsV3(points, .004, 2, false)
    expect(full.slice(0, prefix.length)).toEqual(prefix)
    expect(filteredPressuresV3(points).slice(0, 3)).toEqual(filteredPressuresV3(points.slice(0, 3)))
    expect(JSON.stringify(points)).toBe(before)
  })
  test('reduces synthetic 240Hz pressure jitter without delaying positions or widening normal ink', () => {
    const points = Array.from({ length: 240 }, (_, i): DrawingPoint => ({ x: .1 + i * .0005, y: .3, p: i % 2 ? .2 : .1, t: i * 4 }))
    const radii = (polygons: [number, number][][]): number[] => polygons.filter(p => p.length > 4).map((polygon, i) => polygon[0]![0] - points[i]!.x)
    const old = radii(strokePolygonsV2(points, .004, 1.5, false)), next = radii(strokePolygonsV3(points, .004, 1.5, false))
    const changes = (values: number[]): number[] => values.slice(1).map((value, i) => value - values[i]!)
    const rms = (values: number[]): number => Math.sqrt(values.reduce((sum, n) => sum + n * n, 0) / values.length)
    expect(rms(changes(next))).toBeLessThan(rms(changes(old)) * .1)
    expect(Math.max(...changes(next).map(Math.abs))).toBeLessThan(Math.max(...changes(old).map(Math.abs)) * .1)
    const nominal = .004 * (.42 + .20 * .137) / 2, previous = .004 * (.35 + .65 * .137) / 2
    expect(nominal / previous).toBeGreaterThan(.98); expect(nominal / previous).toBeLessThan(1.03)
    const polygons = strokePolygonsV3(points, .004, 1.5, false).filter(p => p.length > 4)
    polygons.forEach((polygon, i) => {
      expect((polygon[0]![0] + polygon[16]![0]) / 2).toBeCloseTo(points[i]!.x, 14)
      expect((polygon[8]![1] + polygon[24]![1]) / 2).toBeCloseTo(points[i]!.y, 14)
    })
  })
  test('follows a slow pressure ramp causally with a bounded 24ms response', () => {
    const points = Array.from({ length: 241 }, (_, i): DrawingPoint => ({ x: .3, y: .4, p: i / 240, t: i * 4 }))
    const filtered = filteredPressuresV3(points)
    filtered.forEach((p, i) => { expect(p).toBeLessThanOrEqual(points[i]!.p); if (i) expect(p).toBeGreaterThan(filtered[i - 1]!) })
    expect(filtered.at(-1)).toBeGreaterThan(.97)
  })
  test('external bridges touch both radii tangentially and all polygons wind alike', () => {
    const polys = strokePolygonsV3(golden, .01, 1.5, false)
    const quad = polys[1]!, p0 = golden[0]!, p1 = golden[1]!
    const edge = [quad[1]![0] - quad[0]![0], (quad[1]![1] - quad[0]![1]) * 1.5]
    for (const [vertex, center] of [[quad[0]!, p0], [quad[1]!, p1]] as const) {
      const radius = [vertex[0] - center.x, (vertex[1] - center.y) * 1.5]
      expect(edge[0]! * radius[0]! + edge[1]! * radius[1]!).toBeCloseTo(0, 14)
    }
    for (const polygon of polys) {
      const area = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]!; return sum + p[0] * q[1] - q[0] * p[1] }, 0)
      expect(area).toBeGreaterThan(0)
    }
  })
  test('contained circles skip degenerate bridges and pressure-only dots remain finite', () => {
    const points = [{ x: .2, y: .4, p: 0, t: 0 }, { x: .201, y: .4, p: 1, t: 32 }]
    expect(strokePolygonsV3(points, .1, 2, false).map(p => p.length)).toEqual([32, 32])
    const dot = strokePolygonsV3([{ x: .2, y: .4, p: 0 }], .02, 2, false)[0]!
    expect(dot[0]![0]).toBeCloseTo(.2042, 14); expect(dot[8]![1]).toBeCloseTo(.4021, 14)
    expect(strokePathV3(points, .1, 2, false)).not.toMatch(/NaN|Infinity/)
  })
  test('highlighter geometry remains independent of pressure and rejects invalid geometry', () => {
    expect(strokePolygonsV3(golden, .02, 2, true)).toEqual(strokePolygonsV3(golden.map(p => ({ ...p, p: 1 })), .02, 2, true))
    expect(strokePolygonsV3(golden, NaN, 2, false)).toEqual([])
    expect(strokePolygonsV3([{ x: NaN, y: .2, p: .2 }], .01, 2, false)).toEqual([])
    expect(strokePolygonsV3([], .01, 2, false)).toEqual([])
    expect(strokePathV3([], .01, 2, false)).toBe('')
  })
})
