import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  RAIL_WIDTH_LIMITS,
  RAIL_WIDTH_VARIABLES,
  clampRailWidth,
  persistRailWidth,
  type RailSide
} from './railWidth'

interface RailResizerProps {
  side: RailSide
}

/**
 * 사이드바 안쪽 모서리의 드래그 핸들. move 중에는 리렌더 없이 documentElement
 * 의 CSS 변수를 직접 갱신하고(소비처 전부 실시간 추종), 놓을 때 저장한다.
 * 더블클릭 = 기본 폭 복원.
 */
export function RailResizer({ side }: RailResizerProps): JSX.Element {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  const applyWidth = useCallback((px: number): number => {
    const clamped = clampRailWidth(side, px)
    document.documentElement.style.setProperty(
      RAIL_WIDTH_VARIABLES[side],
      `${clamped}px`
    )
    return clamped
  }, [side])

  const currentWidth = useCallback((): number => {
    // 리사이저는 그리드 경계에 절대배치된 형제라, 실제 폭은 rail 요소를 잰다.
    const rail = document.querySelector(`.app-rail--${side}`)
    return rail instanceof HTMLElement
      ? rail.getBoundingClientRect().width
      : RAIL_WIDTH_LIMITS[side].default
  }, [side])

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const delta = side === 'left'
      ? event.clientX - drag.startX
      : drag.startX - event.clientX
    persistRailWidth(side, applyWidth(drag.startWidth + delta))
  }, [applyWidth, side])

  return (
    <div
      className={`rail-resizer rail-resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '과목 사이드바 폭 조절' : '자료 사이드바 폭 조절'}
      title="드래그해서 폭 조절 · 더블클릭하면 기본 폭"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: currentWidth()
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (drag === null || drag.pointerId !== event.pointerId) return
        const delta = side === 'left'
          ? event.clientX - drag.startX
          : drag.startX - event.clientX
        applyWidth(drag.startWidth + delta)
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={() => {
        persistRailWidth(side, applyWidth(RAIL_WIDTH_LIMITS[side].default))
      }}
    />
  )
}
