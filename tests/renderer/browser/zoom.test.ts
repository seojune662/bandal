import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ZOOM_LEVEL,
  isDefaultZoom,
  zoomIn,
  zoomOut,
  zoomPercent
} from '../../../src/renderer/src/features/browser/zoom'

describe('zoom', () => {
  test('level 0 is 100%', () => {
    expect(zoomPercent(DEFAULT_ZOOM_LEVEL)).toBe(100)
    expect(isDefaultZoom(DEFAULT_ZOOM_LEVEL)).toBe(true)
  })

  test('steps land on the percentages a browser user expects', () => {
    const one = zoomIn(DEFAULT_ZOOM_LEVEL)
    expect(zoomPercent(one)).toBe(110)
    expect(zoomPercent(zoomIn(one))).toBe(125)
    expect(zoomPercent(zoomOut(DEFAULT_ZOOM_LEVEL))).toBe(90)
  })

  test('in and out are inverses across the range', () => {
    let level = DEFAULT_ZOOM_LEVEL
    for (let i = 0; i < 4; i += 1) level = zoomIn(level)
    for (let i = 0; i < 4; i += 1) level = zoomOut(level)
    expect(isDefaultZoom(level)).toBe(true)
  })

  test('clamps instead of drifting past the ends', () => {
    let level = DEFAULT_ZOOM_LEVEL
    for (let i = 0; i < 50; i += 1) level = zoomIn(level)
    const ceiling = level
    expect(zoomIn(ceiling)).toBe(ceiling)
    expect(zoomPercent(ceiling)).toBeLessThan(600)

    let low = DEFAULT_ZOOM_LEVEL
    for (let i = 0; i < 50; i += 1) low = zoomOut(low)
    expect(zoomOut(low)).toBe(low)
    expect(zoomPercent(low)).toBeGreaterThan(20)
  })

  test('a level off the stop list still moves in the right direction', () => {
    // A page could hand us any level; stepping must not get stuck.
    expect(zoomIn(0.1)).toBeGreaterThan(0.1)
    expect(zoomOut(0.1)).toBeLessThan(0.1)
  })
})
