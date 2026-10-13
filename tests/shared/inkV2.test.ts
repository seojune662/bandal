import { describe, expect, test } from 'vitest'
import { strokePolygonsV2, strokePathV2 } from '../../src/shared/inkV2'
import { assertDrawingData } from '../../src/main/features/drawingValidation'

describe('portable native ink v2', () => {
  test('caps remain round in physical page coordinates on non-square pages', () => {
    const [dot] = strokePolygonsV2([{x:.2,y:.4,p:1}], .02, 2, false)
    expect(dot).toHaveLength(24)
    expect(dot![0]![0]).toBeCloseTo(.21)
    expect(dot![0]![1]).toBeCloseTo(.4)
    expect(dot![6]![0]).toBeCloseTo(.2)
    expect(dot![6]![1]).toBeCloseTo(.405)
    expect(strokePathV2([{x:.2,y:.4,p:0}],.02,2,false)).toMatch(/^M /)
  })
  test('all polygons wind alike so one nonzero fill has uniform alpha at joints', () => {
    const polys = strokePolygonsV2([{x:.1,y:.1,p:0},{x:.5,y:.3,p:1},{x:.1,y:.1,p:.5}], .02, 1.5, false)
    expect(polys).toHaveLength(5)
    for (const polygon of polys) {
      const area = polygon.reduce((sum, p, i) => { const q = polygon[(i+1)%polygon.length]!; return sum+p[0]*q[1]-q[0]*p[1] },0)
      expect(area).toBeGreaterThan(0)
    }
  })
  test('highlighter width is pressure independent; pen is pressure sensitive', () => {
    const low=[{x:.5,y:.5,p:0}], high=[{x:.5,y:.5,p:1}]
    expect(strokePolygonsV2(low,.02,1,true)).toEqual(strokePolygonsV2(high,.02,1,true))
    expect(strokePolygonsV2(low,.02,1,false)).not.toEqual(strokePolygonsV2(high,.02,1,false))
  })
  test('metadata survives canonical storage validation while unknown versions fail', () => {
    const data={inkVersion:2 as const,points:[{x:.2,y:.3,p:0,t:0,tiltX:30,tiltY:-20}]}
    expect(assertDrawingData(data,'ink')).toEqual(data)
    expect(() => assertDrawingData({...data,inkVersion:3},'ink')).toThrow()
    expect(() => assertDrawingData({...data,points:[{...data.points[0],tiltX:91}]},'ink')).toThrow()
  })
})
