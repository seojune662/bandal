import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { BandalOrbMark, type BandalOrbState } from './BandalOrbMark'

const STORAGE_KEY = 'bandal:assistant-orb-position:v1'
const CLICK_DISTANCE_PX = 4

interface Point {
  x: number
  y: number
}

interface DragState {
  pointerId: number
  origin: Point
  start: Point
  current: Point
  moved: boolean
}

export interface AssistantOrbProps {
  open: boolean
  state: BandalOrbState
  onToggle: () => void
}

function readPosition(): Point | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Number.isFinite((parsed as Point).x) &&
      Number.isFinite((parsed as Point).y)
    ) {
      return parsed as Point
    }
  } catch {
    // Corrupt or unavailable storage should never prevent the orb rendering.
  }
  return null
}

function persistPosition(position: Point): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Persistence is best-effort (private windows may reject localStorage).
  }
}

function clampPosition(position: Point, element: HTMLElement): Point {
  return {
    x: Math.min(Math.max(position.x, 0), Math.max(window.innerWidth - element.offsetWidth, 0)),
    y: Math.min(
      Math.max(position.y, 0),
      Math.max(window.innerHeight - element.offsetHeight, 0)
    )
  }
}

function samePoint(left: Point | null, right: Point): boolean {
  return left !== null && left.x === right.x && left.y === right.y
}

export function AssistantOrb({
  open,
  state,
  onToggle
}: AssistantOrbProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [position, setPosition] = useState<Point | null>(readPosition)

  const clampCurrentPosition = useCallback((): void => {
    const element = buttonRef.current
    if (element === null) return
    const fallback = element.getBoundingClientRect()
    const next = clampPosition(
      position ?? { x: fallback.left, y: fallback.top },
      element
    )
    if (!samePoint(position, next)) setPosition(next)
    persistPosition(next)
  }, [position])

  useLayoutEffect(() => {
    clampCurrentPosition()
  }, [clampCurrentPosition])

  useLayoutEffect(() => {
    const onResize = (): void => clampCurrentPosition()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampCurrentPosition])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const element = buttonRef.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    const origin = position ?? { x: rect.left, y: rect.top }
    dragRef.current = {
      pointerId: event.pointerId,
      origin,
      start: { x: event.clientX, y: event.clientY },
      current: origin,
      moved: false
    }
    element.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    const element = buttonRef.current
    if (drag === null || element === null || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.start.x
    const dy = event.clientY - drag.start.y
    if (Math.hypot(dx, dy) > CLICK_DISTANCE_PX) drag.moved = true
    const next = clampPosition(
      { x: drag.origin.x + dx, y: drag.origin.y + dy },
      element
    )
    drag.current = next
    setPosition(next)
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    const element = buttonRef.current
    if (element?.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    persistPosition(drag.current)
    if (event.type === 'pointerup' && !drag.moved) onToggle()
  }

  const style: CSSProperties | undefined =
    position === null
      ? undefined
      : { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="assistant-orb"
      data-tour="assistant-orb"
      data-positioned={position === null ? undefined : 'true'}
      style={style}
      aria-label={
        open
          ? '반달 AI 채팅 닫기'
          : state === 'alert'
            ? '반달 AI 새 답변 열기'
            : '반달 AI 채팅 열기'
      }
      aria-expanded={open}
      aria-controls="assistant-popup"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onClick={(event) => {
        // Pointer activation is handled on pointerup so a drag cannot click.
        // Keyboard and assistive-technology activation arrives with detail 0.
        if (event.detail === 0) onToggle()
      }}
    >
      <BandalOrbMark state={state} />
    </button>
  )
}
