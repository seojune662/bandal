import { describe, expect, test } from 'vitest'
import {
  clampPopupGeometry,
  resizePopupGeometry
} from '../../../src/renderer/src/features/assistant/popupGeometry'

const viewport = { width: 1200, height: 800 }
const limits = {
  minWidth: 360,
  minHeight: 320,
  maxWidth: 1000,
  maxHeight: 700
}

describe('assistant popup geometry', () => {
  test('clamps restored size and position completely inside the viewport', () => {
    expect(
      clampPopupGeometry(
        { x: 900, y: -40, width: 900, height: 100 },
        viewport,
        limits
      )
    ).toEqual({ x: 300, y: 0, width: 900, height: 320 })
  })

  test('shrinks below configured minimum only when the viewport requires it', () => {
    expect(
      clampPopupGeometry(
        { x: 20, y: 20, width: 500, height: 500 },
        { width: 300, height: 240 },
        limits
      )
    ).toEqual({ x: 0, y: 0, width: 300, height: 240 })
  })

  test('resizes from the top-left while keeping the bottom-right fixed', () => {
    expect(
      resizePopupGeometry(
        { x: 500, y: 300, width: 500, height: 400 },
        'top-left',
        -120,
        -80,
        viewport,
        limits
      )
    ).toEqual({ x: 380, y: 220, width: 620, height: 480 })
  })

  test('top-left resizing stops at screen and minimum-size boundaries', () => {
    const start = { x: 100, y: 100, width: 500, height: 400 }

    expect(
      resizePopupGeometry(start, 'top-left', -900, -900, viewport, limits)
    ).toEqual({ x: 0, y: 0, width: 600, height: 500 })
    expect(
      resizePopupGeometry(start, 'top-left', 900, 900, viewport, limits)
    ).toEqual({ x: 240, y: 180, width: 360, height: 320 })
  })

  test('bottom-right resizing cannot cross the viewport edge', () => {
    expect(
      resizePopupGeometry(
        { x: 500, y: 300, width: 400, height: 350 },
        'bottom-right',
        900,
        900,
        viewport,
        limits
      )
    ).toEqual({ x: 500, y: 300, width: 700, height: 500 })
  })
})
