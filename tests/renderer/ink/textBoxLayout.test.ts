import { describe, expect, test } from 'vitest'
import {
  TEXT_BASE_FONT_RATIO,
  defaultTextBoxSize,
  grownTextBoxHeight,
  scaledFontScale
} from '../../../src/renderer/src/features/ink/textBoxLayout'

describe('defaultTextBoxSize', () => {
  test('yields the same on-screen height regardless of surface aspect', () => {
    // 화면 높이 = height(정규화) × aspect. A4 세로와 16:9 슬라이드가 같아야
    // 슬라이드에서 한 줄짜리 납작한 박스가 나오지 않는다.
    const a4 = defaultTextBoxSize(Math.SQRT2)
    const slide = defaultTextBoxSize(0.5625)
    expect(a4.height * Math.SQRT2).toBeCloseTo(slide.height * 0.5625)
    expect(a4.width).toBe(slide.width)
  })

  test('the default box fits more than one line of the base font', () => {
    const { height } = defaultTextBoxSize(Math.SQRT2)
    const screenHeight = height * Math.SQRT2
    expect(screenHeight).toBeGreaterThan(TEXT_BASE_FONT_RATIO * 1.4)
  })

  test('survives a degenerate aspect', () => {
    const size = defaultTextBoxSize(0)
    expect(Number.isFinite(size.height)).toBe(true)
    expect(size.height).toBeGreaterThan(0)
  })
})

describe('scaledFontScale', () => {
  const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

  test('scales the font by the box width ratio', () => {
    expect(scaledFontScale(1, box, { ...box, width: 0.6 })).toBeCloseTo(2)
    expect(scaledFontScale(2, box, { ...box, width: 0.15 })).toBeCloseTo(1)
  })

  test('treats a missing scale as 1', () => {
    expect(scaledFontScale(undefined, box, { ...box, width: 0.6 })).toBeCloseTo(2)
  })

  test('clamps extreme results and rejects degenerate boxes', () => {
    expect(scaledFontScale(1, { ...box, width: 0 }, box)).toBe(1)
    expect(
      scaledFontScale(19, box, { ...box, width: box.width * 10 })
    ).toBeLessThanOrEqual(20)
  })
})

describe('grownTextBoxHeight', () => {
  const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }

  test('returns null while the content still fits', () => {
    // 필요 높이 = 40 / (800·1) = 0.05 < 0.1
    expect(grownTextBoxHeight(40, box, 800, 1)).toBeNull()
  })

  test('grows to the content height when it overflows', () => {
    // 필요 높이 = 120 / (800·1) = 0.15 > 0.1
    expect(grownTextBoxHeight(120, box, 800, 1)).toBeCloseTo(0.15)
  })

  test('never grows past the page bottom', () => {
    const nearBottom = { ...box, y: 0.95 }
    const grown = grownTextBoxHeight(400, nearBottom, 800, 1)
    expect(grown).not.toBeNull()
    expect(grown!).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  test('ignores unmeasurable inputs', () => {
    expect(grownTextBoxHeight(Number.NaN, box, 800, 1)).toBeNull()
    expect(grownTextBoxHeight(120, box, 0, 1)).toBeNull()
  })
})
