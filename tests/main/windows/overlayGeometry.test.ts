import { describe, expect, test } from 'vitest'
import {
  clampOrbToArea,
  clampToArea,
  defaultOrbPosition,
  normalizeOrbWindowBounds,
  ORB_VISUAL_SIZE,
  ORB_WINDOW_SIZE,
  orbPositionFromCursor,
  orbVisualBounds,
  placePopup
} from '../../../src/main/windows/overlayGeometry'

describe('overlay geometry', () => {
  test('clamps a rectangle to a work area without changing its size', () => {
    expect(
      clampToArea(
        { x: -50, y: 760, width: 400, height: 300 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 0, y: 600, width: 400, height: 300 })
  })

  test('anchors an oversized rectangle at the work-area origin', () => {
    expect(
      clampToArea(
        { x: 900, y: 500, width: 500, height: 700 },
        { x: 1000, y: -40, width: 300, height: 600 }
      )
    ).toEqual({ x: 1000, y: -40, width: 500, height: 700 })
  })

  test('uses the work-area bottom-right as the default orb position', () => {
    expect(defaultOrbPosition({ x: -1280, y: 24, width: 1280, height: 776 })).toEqual({
      x: -148,
      y: 652
    })
  })

  test('centres the 56px visual inside the 240px transparent window', () => {
    expect(orbVisualBounds({ x: 100, y: 200, width: 240, height: 240 })).toEqual({
      x: 192,
      y: 292,
      width: ORB_VISUAL_SIZE,
      height: ORB_VISUAL_SIZE
    })
  })

  test('migrates persisted 64px bounds without moving their centre', () => {
    expect(
      normalizeOrbWindowBounds({ x: 900, y: 700, width: 64, height: 64 })
    ).toEqual({ x: 812, y: 612, width: ORB_WINDOW_SIZE, height: ORB_WINDOW_SIZE })
  })

  test('clamps the visible orb instead of its transparent window', () => {
    expect(
      clampOrbToArea(
        { x: -200, y: 780, width: 240, height: 240 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: -92, y: 752, width: 240, height: 240 })
  })

  test('places a popup above and left of the orb by default', () => {
    expect(
      placePopup(
        { x: 812, y: 612, width: 240, height: 240 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 504, y: 144, width: 400, height: 560 })
  })

  test('flips below and right when the orb is near the top-left', () => {
    expect(
      placePopup(
        { x: -72, y: -62, width: 240, height: 240 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 76, y: 86, width: 400, height: 560 })
  })

  test('clamps a popup into a work area smaller than the popup', () => {
    expect(
      placePopup(
        { x: 18, y: 28, width: 240, height: 240 },
        { width: 400, height: 560 },
        { x: 100, y: 100, width: 240, height: 300 }
      )
    ).toEqual({ x: 100, y: 100, width: 400, height: 560 })
  })

  test('moves a crossing orb wholly onto the display containing the cursor', () => {
    const areas = [
      { x: 0, y: 0, width: 1000, height: 800 },
      { x: 1000, y: 0, width: 1200, height: 900 }
    ]

    expect(
      orbPositionFromCursor({ x: 1010, y: 400 }, { x: 120, y: 120 }, areas)
    ).toEqual({ x: 908, y: 280 })
    expect(
      orbPositionFromCursor({ x: 990, y: 400 }, { x: 120, y: 120 }, areas)
    ).toEqual({ x: 852, y: 280 })
  })
})
