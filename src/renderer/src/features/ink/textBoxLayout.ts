/**
 * 텍스트박스 배치·스케일의 순수 로직.
 *
 * 좌표계 주의: InkLayer 의 정규화 좌표는 x=폭 기준, y=높이 기준이라
 * "화면에서 같은 높이"는 aspect(세로/가로)에 반비례하는 정규화 높이다.
 * 예전 TEXT_BOX_HEIGHT=0.08 고정값은 16:9 슬라이드에서 한 줄 높이밖에
 * 안 됐다 — 화면 높이가 표면 비율과 무관하게 일정하도록 계산한다.
 */

import type { DrawingBox } from '../../../../shared/types/drawing'

export const TEXT_BOX_WIDTH = 0.26
/** 폭 대비 기본 폰트 비율 — fontSize = baseWidthPx · ratio · fontScale. */
export const TEXT_BASE_FONT_RATIO = 0.026
/** 기본 박스에 담을 줄 수(줄높이 1.4 가정) + 패딩 여유. */
const DEFAULT_LINES = 2.2
const LINE_HEIGHT = 1.4

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** 표면 비율과 무관하게 화면상 같은 높이가 나오는 기본 박스 크기. */
export function defaultTextBoxSize(aspect: number): {
  width: number
  height: number
} {
  const safeAspect = finitePositive(aspect) ? aspect : 1
  const screenHeightRatio = TEXT_BASE_FONT_RATIO * LINE_HEIGHT * DEFAULT_LINES
  return {
    width: TEXT_BOX_WIDTH,
    height: Math.min(1, screenHeightRatio / safeAspect)
  }
}

/**
 * 코너 리사이즈로 박스가 스케일된 만큼 글자도 따라 스케일한다
 * (GoodNotes 관례 — 박스와 글자가 한 몸).
 */
export function scaledFontScale(
  oldScale: number | undefined,
  oldBox: DrawingBox,
  newBox: DrawingBox
): number {
  const base = finitePositive(oldScale ?? 1) ? (oldScale ?? 1) : 1
  if (!finitePositive(oldBox.width) || !finitePositive(newBox.width)) {
    return base
  }
  const next = (base * newBox.width) / oldBox.width
  return finitePositive(next) ? Math.min(20, Math.max(0.05, next)) : base
}

/**
 * 타이핑으로 내용이 박스보다 길어지면 박스 높이를 내용에 맞춘다.
 * scrollHeightPx 는 foreignObject 내부 CSS px(= 정규화 × baseWidthPx·aspect).
 * 성장이 필요 없으면 null.
 */
export function grownTextBoxHeight(
  scrollHeightPx: number,
  box: DrawingBox,
  baseWidthPx: number,
  aspect: number
): number | null {
  if (
    !finitePositive(scrollHeightPx) ||
    !finitePositive(baseWidthPx) ||
    !finitePositive(aspect)
  ) {
    return null
  }
  const neededHeight = scrollHeightPx / (baseWidthPx * aspect)
  if (neededHeight <= box.height) return null
  return Math.min(neededHeight, Math.max(0, 1 - box.y))
}
