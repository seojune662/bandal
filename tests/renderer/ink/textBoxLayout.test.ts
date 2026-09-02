import { describe, expect, test } from 'vitest'
import {
  TEXT_BASE_FONT_RATIO,
  TEXT_BOX_BORDER_EM,
  TEXT_BOX_PADDING_EM,
  TEXT_LINE_HEIGHT,
  textBoxFontPx
} from '../../../src/shared/textBoxMetrics'
import {
  defaultTextBoxSize,
  grownTextBoxHeight,
  healedTextBox,
  textBoxAtClick
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

describe('textBoxAtClick', () => {
  const aspect = 0.75
  const baseWidthPx = 800
  const fontScale = 1

  test('keeps the click inside the box and anchors it to the first-line center', () => {
    const point = { x: 0.42, y: 0.38, p: 0.5 }
    const placed = textBoxAtClick(
      point,
      aspect,
      baseWidthPx,
      fontScale,
      true
    )

    expect(point.x).toBeGreaterThanOrEqual(placed.x)
    expect(point.x).toBeLessThanOrEqual(placed.x + placed.width)
    expect(point.y).toBeGreaterThanOrEqual(placed.y)
    expect(point.y).toBeLessThanOrEqual(placed.y + placed.height)

    const fontPx = textBoxFontPx(baseWidthPx, fontScale)
    const insetPx = fontPx * (TEXT_BOX_PADDING_EM + TEXT_BOX_BORDER_EM)
    const firstLineCenter = placed.y +
      (insetPx + fontPx * TEXT_LINE_HEIGHT / 2) / (baseWidthPx * aspect)
    const onePixelNormalized = 1 / (baseWidthPx * aspect)
    expect(Math.abs(firstLineCenter - point.y)).toBeLessThanOrEqual(
      onePixelNormalized
    )
  })

  test('shrinks at the right edge without sliding the x anchor left', () => {
    const point = { x: 0.95, y: 0.4, p: 0.5 }
    const fontPx = textBoxFontPx(baseWidthPx, fontScale)
    const insetPx = fontPx * (TEXT_BOX_PADDING_EM + TEXT_BOX_BORDER_EM)
    const expectedX = point.x - insetPx / baseWidthPx
    const placed = textBoxAtClick(
      point,
      aspect,
      baseWidthPx,
      fontScale,
      true
    )

    expect(placed.x).toBeCloseTo(expectedX)
    expect(placed.width).toBeCloseTo(1 - expectedX)
    expect(placed.width).toBeLessThan(0.26)
    expect(point.x).toBeLessThanOrEqual(placed.x + placed.width)
  })

  test('floors a click beyond the top-left to zero when clamped', () => {
    const placed = textBoxAtClick(
      { x: -0.1, y: -0.1, p: 0.5 },
      aspect,
      baseWidthPx,
      fontScale,
      true
    )

    expect(placed.x).toBe(0)
    expect(placed.y).toBe(0)
  })

  test('allows a negative origin when bounds clamping is disabled', () => {
    const placed = textBoxAtClick(
      { x: 0, y: 0, p: 0.5 },
      aspect,
      baseWidthPx,
      fontScale,
      false
    )

    expect(placed.x).toBeLessThan(0)
    expect(placed.y).toBeLessThan(0)
  })
})

describe('healedTextBox (손상 박스 자가 치유)', () => {
  test('leaves an in-bounds box alone', () => {
    expect(healedTextBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 })).toBeNull()
  })

  test('shrinks a box wider than the page and pulls it inside', () => {
    // 예전 리사이즈 점프가 커밋하던 형태 — 페이지 절반 이상을 덮어
    // 그 영역의 클릭을 전부 흡수하던 박스.
    const healed = healedTextBox({ x: -0.2, y: 0.3, width: 1.4, height: 0.4 })
    expect(healed).not.toBeNull()
    expect(healed!.width).toBeLessThanOrEqual(1)
    expect(healed!.x).toBeGreaterThanOrEqual(0)
    expect(healed!.x + healed!.width).toBeLessThanOrEqual(1)
  })

  test('pulls an off-page box back to the edge', () => {
    const healed = healedTextBox({ x: 0.9, y: 1.2, width: 0.3, height: 0.2 })
    expect(healed).toEqual({ x: 0.7, y: 0.8, width: 0.3, height: 0.2 })
  })

  test('ignores tiny drift and degenerate boxes (no heal loop)', () => {
    expect(
      healedTextBox({ x: 1 - 0.3 + 0.0005, y: 0, width: 0.3, height: 0.1 })
    ).toBeNull()
    expect(healedTextBox({ x: 0, y: 0, width: 0, height: 0.1 })).toBeNull()
    expect(healedTextBox({ x: Number.NaN, y: 0, width: 0.3, height: 0.1 })).toBeNull()
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
