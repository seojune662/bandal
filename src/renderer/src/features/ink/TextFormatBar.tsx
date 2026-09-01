import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { DrawingBox, DrawingColor, DrawingStyle } from '../../../../shared/types/drawing'

/** 스테퍼 래더 — 레거시 임의 fontScale 은 최근접 값으로 스냅 후 이동한다. */
export const TEXT_FONT_SCALE_STEPS: readonly number[] =
  [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]

const BAR_COLORS: readonly DrawingColor[] = [
  'ink', 'red', 'orange', 'yellow', 'green', 'blue', 'violet'
]

const COLOR_LABELS: Record<DrawingColor, string> = {
  ink: '기본',
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  violet: '보라'
}

/** 위/아래 플립 기준 — 박스 위 여백이 이보다 좁으면 아래로 연다. */
const FLIP_THRESHOLD_PX = 48
/** left 캡 추정치 — 컨테이너가 overflow:hidden 이라 우측 이탈을 막는다. */
const BAR_WIDTH_ESTIMATE_PX = 300

export function nearestFontScaleIndex(scale: number | undefined): number {
  const value = Number.isFinite(scale) && (scale ?? 0) > 0 ? (scale as number) : 1
  let best = 0
  for (let index = 1; index < TEXT_FONT_SCALE_STEPS.length; index += 1) {
    if (
      Math.abs(TEXT_FONT_SCALE_STEPS[index]! - value) <
      Math.abs(TEXT_FONT_SCALE_STEPS[best]! - value)
    ) {
      best = index
    }
  }
  return best
}

export function steppedFontScale(
  scale: number | undefined,
  direction: 1 | -1
): number {
  const index = nearestFontScaleIndex(scale)
  const next = Math.min(
    TEXT_FONT_SCALE_STEPS.length - 1,
    Math.max(0, index + direction)
  )
  return TEXT_FONT_SCALE_STEPS[next]!
}

export interface TextFormatBarProps {
  box: DrawingBox
  aspect: number
  baseWidthPx: number
  style: DrawingStyle
  onChange: (patch: Partial<DrawingStyle>) => void
  barRef: RefObject<HTMLDivElement>
}

/**
 * 선택/편집 중 텍스트박스 위에 뜨는 서식 바. svg 의 "형제" HTML 이라
 * foreignObject 좌표 함정이 없다. 모든 버튼이 mousedown/pointerdown 기본
 * 동작을 막아 편집 textarea 의 blur(=확정)를 일으키지 않는다.
 */
export function TextFormatBar({
  box,
  aspect,
  baseWidthPx,
  style,
  onChange,
  barRef
}: TextFormatBarProps): JSX.Element {
  const keepFocus = (event: React.MouseEvent | ReactPointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  const flipBelow = box.y * baseWidthPx * aspect < FLIP_THRESHOLD_PX
  const maxLeft = Math.max(
    0,
    1 - (baseWidthPx > 0 ? BAR_WIDTH_ESTIMATE_PX / baseWidthPx : 0)
  )
  const barStyle: CSSProperties = {
    left: `${Math.min(box.x, maxLeft) * 100}%`,
    top: `${(flipBelow ? box.y + box.height : box.y) * 100}%`,
    transform: flipBelow ? 'translateY(6px)' : 'translateY(calc(-100% - 6px))'
  }
  const scalePercent = Math.round(
    TEXT_FONT_SCALE_STEPS[nearestFontScaleIndex(style.fontScale)]! * 100
  )
  const isBold = style.bold === true

  return (
    <div
      ref={barRef}
      className="ink-layer__format-bar"
      role="toolbar"
      aria-label="텍스트 서식"
      style={barStyle}
      onMouseDown={keepFocus}
      onPointerDown={keepFocus}
    >
      <button
        type="button"
        className="ink-layer__format-button"
        aria-label="글자 작게"
        title="글자 작게"
        onMouseDown={keepFocus}
        onClick={() => onChange({ fontScale: steppedFontScale(style.fontScale, -1) })}
      >
        −
      </button>
      <span className="ink-layer__format-scale" aria-label="글자 크기">
        {scalePercent}%
      </span>
      <button
        type="button"
        className="ink-layer__format-button"
        aria-label="글자 크게"
        title="글자 크게"
        onMouseDown={keepFocus}
        onClick={() => onChange({ fontScale: steppedFontScale(style.fontScale, 1) })}
      >
        +
      </button>
      <span className="ink-layer__format-divider" aria-hidden="true" />
      <button
        type="button"
        className="ink-layer__format-button ink-layer__format-bold"
        aria-label="굵게"
        title="굵게"
        aria-pressed={isBold}
        onMouseDown={keepFocus}
        onClick={() => onChange({ bold: !isBold })}
      >
        B
      </button>
      <span className="ink-layer__format-divider" aria-hidden="true" />
      {BAR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="ink-layer__format-swatch"
          data-color={color}
          aria-label={COLOR_LABELS[color]}
          title={COLOR_LABELS[color]}
          aria-pressed={style.color === color}
          onMouseDown={keepFocus}
          onClick={() => onChange({ color })}
        />
      ))}
    </div>
  )
}
