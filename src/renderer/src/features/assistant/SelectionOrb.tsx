import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { BandalOrbMark } from './BandalOrbMark'
import type { AnchoredSelection } from './useSelectionAnchor'

interface Point {
  x: number
  y: number
}

export interface SelectionOrbProps {
  selection: AnchoredSelection
  courseAvailable: boolean
  onPick: (selection: AnchoredSelection) => void
}

function anchorPoint(selection: AnchoredSelection, element: HTMLElement): Point {
  const computed = window.getComputedStyle(element)
  const gap = Number.parseFloat(computed.getPropertyValue('--assistant-selection-gap')) || 0
  const { rect } = selection
  let x = rect.left + rect.width + gap
  let y = rect.top + rect.height + gap
  if (x + element.offsetWidth > window.innerWidth) {
    x = rect.left - element.offsetWidth - gap
  }
  if (y + element.offsetHeight > window.innerHeight) {
    y = rect.top - element.offsetHeight - gap
  }
  return {
    x: Math.min(Math.max(x, 0), Math.max(window.innerWidth - element.offsetWidth, 0)),
    y: Math.min(Math.max(y, 0), Math.max(window.innerHeight - element.offsetHeight, 0))
  }
}

export function SelectionOrb({
  selection,
  courseAvailable,
  onPick
}: SelectionOrbProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<Point | null>(null)

  useLayoutEffect(() => {
    const element = buttonRef.current
    if (element === null) return
    const update = (): void => setPosition(anchorPoint(selection, element))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [selection])

  const style: CSSProperties | undefined =
    position === null
      ? undefined
      : { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }

  const preserveSelection = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
  }

  return (
    <span
      className="assistant-selection-anchor"
      data-ready={position === null ? undefined : 'true'}
      style={style}
    >
      <button
        ref={buttonRef}
        type="button"
        className="assistant-selection-orb"
        aria-label={
          courseAvailable
            ? '선택한 내용을 반달 AI에게 인용하기'
            : '채팅을 열고 과목 선택 안내 보기'
        }
        title="반달 AI에게 인용"
        onPointerDown={preserveSelection}
        onClick={() => onPick(selection)}
      >
        <BandalOrbMark state="hover" />
      </button>
    </span>
  )
}
