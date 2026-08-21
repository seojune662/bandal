import { describe, expect, test } from 'vitest'
import {
  clampToArea,
  defaultOrbPosition,
  orbPositionFromCursor,
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
      x: -64,
      y: 736
    })
  })

  test('places a popup above and left of the orb by default', () => {
    expect(
      placePopup(
        { x: 900, y: 700, width: 64, height: 64 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 500, y: 140, width: 400, height: 560 })
  })

  test('flips below and right when the orb is near the top-left', () => {
    expect(
      placePopup(
        { x: 20, y: 30, width: 64, height: 64 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 84, y: 94, width: 400, height: 560 })
  })

  test('clamps a popup into a work area smaller than the popup', () => {
    expect(
      placePopup(
        { x: 110, y: 120, width: 64, height: 64 },
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
      orbPositionFromCursor({ x: 1010, y: 400 }, { x: 32, y: 32 }, areas)
    ).toEqual({ x: 1000, y: 368 })
    expect(
      orbPositionFromCursor({ x: 990, y: 400 }, { x: 32, y: 32 }, areas)
    ).toEqual({ x: 936, y: 368 })
  })
})
