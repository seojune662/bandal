import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { ChatSurface } from '../chat/ChatSurface'
import { useCoursesStore } from '../../stores/coursesStore'
import { BandalOrbMark } from './BandalOrbMark'
import {
  clampPopupGeometry,
  resizePopupGeometry,
  type PopupGeometry,
  type PopupResizeCorner,
  type PopupSizeLimits,
  type PopupViewport
} from './popupGeometry'

const STORAGE_KEY = 'bandal:assistant-popup-geometry:v1'
const OPACITY_STORAGE_KEY = 'bandal:assistant-popup-opacity:v1'
/** 이 밑으로 내리면 텍스트까지 안 보인다 — 배경이 "비치는" 최저선. */
const MIN_POPUP_ALPHA = 0.4

function clampPopupAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(MIN_POPUP_ALPHA, value))
}

function readPopupAlpha(): number {
  try {
    const raw = localStorage.getItem(OPACITY_STORAGE_KEY)
    if (raw === null) return 1
    return clampPopupAlpha(Number.parseFloat(raw))
  } catch {
    return 1
  }
}

function persistPopupAlpha(alpha: number): void {
  try {
    localStorage.setItem(OPACITY_STORAGE_KEY, String(alpha))
  } catch {
    // 저장이 안 돼도 이번 세션의 투명도는 유지된다.
  }
}

interface PointerGesture {
  pointerId: number
  startX: number
  startY: number
  geometry: PopupGeometry
}

interface ResizeGesture extends PointerGesture {
  corner: PopupResizeCorner
}

export interface AssistantPopupProps {
  visible: boolean
  conversationId: string | null
  onClose: () => void
}

function validGeometry(value: unknown): value is PopupGeometry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as PopupGeometry
  return (
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    candidate.width > 0 &&
    candidate.height > 0
  )
}

function readGeometry(): PopupGeometry | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return validGeometry(parsed) ? parsed : null
  } catch {
    return null
  }
}

function persistGeometry(geometry: PopupGeometry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry))
  } catch {
    // The popup remains fully usable when storage is unavailable.
  }
}

function currentGeometry(element: HTMLElement): PopupGeometry {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function viewport(): PopupViewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

function parsedPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sizeLimits(element: HTMLElement): PopupSizeLimits {
  const computed = window.getComputedStyle(element)
  return {
    minWidth: parsedPixels(computed.minWidth, 0),
    minHeight: parsedPixels(computed.minHeight, 0),
    maxWidth: parsedPixels(computed.maxWidth, window.innerWidth),
    maxHeight: parsedPixels(computed.maxHeight, window.innerHeight)
  }
}

function sameGeometry(
  left: PopupGeometry | null,
  right: PopupGeometry
): boolean {
  return (
    left !== null &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function AssistantPopup({
  visible,
  conversationId,
  onClose
}: AssistantPopupProps): JSX.Element {
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const popupRef = useRef<HTMLElement>(null)
  const geometryRef = useRef<PopupGeometry | null>(null)
  const moveRef = useRef<PointerGesture | null>(null)
  const resizeRef = useRef<ResizeGesture | null>(null)
  const [geometry, setGeometry] = useState<PopupGeometry | null>(readGeometry)
  const [popupAlpha, setPopupAlpha] = useState<number>(readPopupAlpha)
  geometryRef.current = geometry

  const updateGeometry = useCallback((next: PopupGeometry): void => {
    geometryRef.current = next
    setGeometry(next)
  }, [])

  const clampCurrent = useCallback((): void => {
    const element = popupRef.current
    if (element === null) return
    const next = clampPopupGeometry(
      geometryRef.current ?? currentGeometry(element),
      viewport(),
      sizeLimits(element)
    )
    if (!sameGeometry(geometryRef.current, next)) updateGeometry(next)
    persistGeometry(next)
  }, [updateGeometry])

  useLayoutEffect(() => {
    clampCurrent()
  }, [clampCurrent])

  useLayoutEffect(() => {
    window.addEventListener('resize', clampCurrent)
    return () => window.removeEventListener('resize', clampCurrent)
  }, [clampCurrent])

  useLayoutEffect(() => {
    if (!visible) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, visible])

  useLayoutEffect(() => {
    const element = popupRef.current
    if (element === null) return
    if (visible) element.removeAttribute('inert')
    else element.setAttribute('inert', '')
  }, [visible])

  const beginMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || resizeRef.current !== null) return
    const target = event.target
    if (target instanceof Element && target.closest('button') !== null) return
    const element = popupRef.current
    if (element === null) return
    const current = geometryRef.current ?? currentGeometry(element)
    moveRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: current
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const move = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = moveRef.current
    const element = popupRef.current
    if (gesture === null || element === null || gesture.pointerId !== event.pointerId) return
    updateGeometry(
      clampPopupGeometry(
        {
          ...gesture.geometry,
          x: gesture.geometry.x + event.clientX - gesture.startX,
          y: gesture.geometry.y + event.clientY - gesture.startY
        },
        viewport(),
        sizeLimits(element)
      )
    )
  }

  const finishMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = moveRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    moveRef.current = null
    if (geometryRef.current !== null) persistGeometry(geometryRef.current)
  }

  const beginResize = (
    corner: PopupResizeCorner,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void => {
    if (event.button !== 0 || moveRef.current !== null) return
    const element = popupRef.current
    if (element === null) return
    const current = geometryRef.current ?? currentGeometry(element)
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: current,
      corner
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const resize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = resizeRef.current
    const element = popupRef.current
    if (gesture === null || element === null || gesture.pointerId !== event.pointerId) return
    updateGeometry(
      resizePopupGeometry(
        gesture.geometry,
        gesture.corner,
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
        viewport(),
        sizeLimits(element)
      )
    )
  }

  const finishResize = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = resizeRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeRef.current = null
    if (geometryRef.current !== null) persistGeometry(geometryRef.current)
  }

  const style: CSSProperties = {
    // 표시 전환용 opacity(페이드 인)와 별개로 배경 알파만 조절한다.
    ['--assistant-popup-alpha' as string]: popupAlpha,
    ...(geometry === null
      ? {}
      : {
          left: geometry.x,
          top: geometry.y,
          right: 'auto',
          bottom: 'auto',
          width: geometry.width,
          height: geometry.height
        })
  }

  return (
    <section
      id="assistant-popup"
      ref={popupRef}
      className="assistant-popup"
      data-visible={visible ? 'true' : undefined}
      style={style}
      aria-label="반달 AI 채팅"
      aria-hidden={!visible}
    >
      <header
        className="assistant-popup__header"
        onPointerDown={beginMove}
        onPointerMove={move}
        onPointerUp={finishMove}
        onPointerCancel={finishMove}
      >
        <span className="assistant-popup__identity">
          <BandalOrbMark />
          <span>반달 AI</span>
        </span>
        <span
          className="assistant-popup__opacity"
          // 헤더 드래그(창 이동)와 분리 — 슬라이더 조작이 이동으로 새지 않게.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="assistant-popup__opacity-mark"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
          </svg>
          <input
            type="range"
            min={MIN_POPUP_ALPHA * 100}
            max={100}
            step={5}
            value={Math.round(popupAlpha * 100)}
            aria-label="채팅창 투명도"
            title="채팅창 투명도"
            onChange={(event) => {
              const next = clampPopupAlpha(Number(event.target.value) / 100)
              setPopupAlpha(next)
              persistPopupAlpha(next)
            }}
          />
        </span>
        <button
          type="button"
          className="assistant-popup__close"
          aria-label="반달 AI 채팅 닫기"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </header>

      <div className="assistant-popup__body">
        {selectedCourseId === null || conversationId === null ? (
          <div className="assistant-popup__empty" role="status">
            <BandalOrbMark />
            <p>과목을 먼저 고르세요</p>
          </div>
        ) : (
          <ChatSurface
            courseId={selectedCourseId}
            conversationId={conversationId}
            variant="popup"
          />
        )}
      </div>

      <button
        type="button"
        className="assistant-popup__resize"
        data-corner="top-left"
        aria-label="왼쪽 위에서 채팅창 크기 조절"
        onPointerDown={(event) => beginResize('top-left', event)}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 13h8V5M9 13l4-4" />
        </svg>
      </button>

      <button
        type="button"
        className="assistant-popup__resize"
        data-corner="bottom-right"
        aria-label="오른쪽 아래에서 채팅창 크기 조절"
        onPointerDown={(event) => beginResize('bottom-right', event)}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 13h8V5M9 13l4-4" />
        </svg>
      </button>
    </section>
  )
}
