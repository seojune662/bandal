import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/bandal-test') },
  screen: { getAllDisplays: vi.fn(() => []) }
}))

import {
  isWindowBoundsVisible,
  sanitizeWindowBounds
} from '../../../src/main/windows/windowBounds'

describe('window bounds validation', () => {
  test('sanitizes finite bounds that meet the configured minimum', () => {
    expect(
      sanitizeWindowBounds(
        { x: 1.4, y: -2.6, width: 320.2, height: 400.4 },
        320,
        400
      )
    ).toEqual({ x: 1, y: -3, width: 320, height: 400 })
  })

  test('rejects malformed and undersized bounds', () => {
    expect(
      sanitizeWindowBounds({ x: 0, y: 0, width: 319, height: 400 }, 320, 400)
    ).toBeNull()
    expect(
      sanitizeWindowBounds({ x: 0, y: Number.NaN, width: 320, height: 400 }, 320, 400)
    ).toBeNull()
  })

  test('requires the configured overlap on both axes', () => {
    const areas = [{ x: 0, y: 0, width: 1000, height: 800 }]
    expect(
      isWindowBoundsVisible(
        { x: 936, y: 736, width: 64, height: 64 },
        areas,
        64
      )
    ).toBe(true)
    expect(
      isWindowBoundsVisible(
        { x: 950, y: 736, width: 64, height: 64 },
        areas,
        64
      )
    ).toBe(false)
  })
})
