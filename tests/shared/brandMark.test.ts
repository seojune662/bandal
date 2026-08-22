import { describe, expect, it } from 'vitest'
import {
  ICON_MOON_CX,
  ICON_MOON_CY,
  MARK_CX,
  MARK_CY,
  MARK_RADIUS,
  MOON_TILT,
  TERMINATOR_BULGE,
  litHalfPath
} from '../../src/shared/brandMark'

describe('brand mark geometry', () => {
  it('keeps the React mark path stable', () => {
    expect(
      litHalfPath(
        MARK_CX,
        MARK_CY,
        MARK_RADIUS,
        MOON_TILT,
        TERMINATOR_BULGE
      )
    ).toMatchInlineSnapshot(
      `"M 12 3 A 9 9 0 0 1 12 21 A 1.3 9 0 0 1 12 3 Z"`
    )
  })

  it('keeps the full icon path stable', () => {
    expect(
      litHalfPath(
        ICON_MOON_CX,
        ICON_MOON_CY,
        236,
        MOON_TILT,
        TERMINATOR_BULGE
      )
    ).toMatchInlineSnapshot(
      `"M 512 262 A 236 236 0 0 1 512 734 A 35.4 236 0 0 1 512 262 Z"`
    )
  })
})
