import { describe, expect, test } from 'vitest'
import {
  clampOrbToArea,
  clampToArea,
  defaultOrbPosition,
  normalizeOrbWindowBounds,
  ORB_DEFAULT_MARGIN,
  ORB_VISUAL_CENTER_Y,
  ORB_VISUAL_SIZE,
  ORB_WINDOW_HEIGHT,
  ORB_WINDOW_WIDTH,
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
      x: -284,
      y: 436
    })
    expect(ORB_DEFAULT_MARGIN).toBe(24)
  })

  test('keeps the full default window inside a 1512x982 work area', () => {
    const position = defaultOrbPosition({
      x: 0,
      y: 0,
      width: 1512,
      height: 982
    })

    expect(position).toEqual({ x: 1228, y: 618 })
    expect(position.y + ORB_WINDOW_HEIGHT).toBe(
      982 - ORB_DEFAULT_MARGIN
    )
  })

  test('places the 56px visual at x center and y 120 in the 260x340 window', () => {
    expect(orbVisualBounds({ x: 100, y: 200, width: 260, height: 340 })).toEqual({
      x: 202,
      y: 292,
      width: ORB_VISUAL_SIZE,
      height: ORB_VISUAL_SIZE
    })
    expect(ORB_VISUAL_CENTER_Y).toBe(120)
  })

  test('migrates persisted 64px and 240px bounds without moving the visual centre', () => {
    expect(
      normalizeOrbWindowBounds({ x: 900, y: 700, width: 64, height: 64 })
    ).toEqual({
      x: 802,
      y: 612,
      width: ORB_WINDOW_WIDTH,
      height: ORB_WINDOW_HEIGHT
    })
    expect(
      normalizeOrbWindowBounds({ x: 812, y: 612, width: 240, height: 240 })
    ).toEqual({
      x: 802,
      y: 612,
      width: ORB_WINDOW_WIDTH,
      height: ORB_WINDOW_HEIGHT
    })
  })

  test('clamps sides and top by the visual orb but the bottom by the full window', () => {
    expect(
      clampOrbToArea(
        { x: -200, y: 780, width: 260, height: 340 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: -102, y: 560, width: 260, height: 340 })
  })

  test('places a popup above and left of the orb by default', () => {
    expect(
      placePopup(
        { x: 802, y: 560, width: 260, height: 340 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 504, y: 92, width: 400, height: 560 })
  })

  test('flips below and right when the orb is near the top-left', () => {
    expect(
      placePopup(
        { x: -82, y: -62, width: 260, height: 340 },
        { width: 400, height: 560 },
        { x: 0, y: 0, width: 1200, height: 900 }
      )
    ).toEqual({ x: 76, y: 86, width: 400, height: 560 })
  })

  test('clamps a popup into a work area smaller than the popup', () => {
    expect(
      placePopup(
        { x: 8, y: 28, width: 260, height: 340 },
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
      orbPositionFromCursor({ x: 1010, y: 400 }, { x: 130, y: 120 }, areas)
    ).toEqual({ x: 898, y: 280 })
    expect(
      orbPositionFromCursor({ x: 990, y: 400 }, { x: 130, y: 120 }, areas)
    ).toEqual({ x: 842, y: 280 })
  })

  test('keeps the visual centre under the cursor for a centre grab', () => {
    expect(
      orbPositionFromCursor(
        { x: 500, y: 500 },
        { x: 130, y: 120 },
        [{ x: 0, y: 0, width: 1200, height: 900 }]
      )
    ).toEqual({ x: 370, y: 380 })
  })

  test('keeps the full charm window above the display bottom while dragging', () => {
    const position = orbPositionFromCursor(
      { x: 500, y: 890 },
      { x: 130, y: 120 },
      [{ x: 0, y: 0, width: 1200, height: 900 }]
    )

    expect(position).toEqual({ x: 370, y: 560 })
    expect(position.y + ORB_WINDOW_HEIGHT).toBe(900)
  })
})
