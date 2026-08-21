import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { BandalOrbMark, type BandalOrbState } from '../assistant/BandalOrbMark'
import { useAssistantActivity } from '../assistant/useAssistantActivity'
import { invoke } from '../../lib/ipc'
import { useOverlayState } from './useOverlayState'

interface OrbPointerGesture {
  pointerId: number
  screenX: number
  screenY: number
}

const CLICK_DISTANCE = 4

function reportOrbError(error: unknown): void {
  console.error('[Bandal] 데스크톱 오브 동작을 처리하지 못했습니다.', error)
}

export function OverlayOrbApp(): JSX.Element {
  const state = useOverlayState()
  const { busy, alert } = useAssistantActivity({
    courseId: state.courseId,
    popupOpen: state.popupOpen
  })
  const [hovered, setHovered] = useState(false)
  const gestureRef = useRef<OrbPointerGesture | null>(null)

  const markState: BandalOrbState = alert
    ? 'alert'
    : busy
      ? 'busy'
      : hovered
        ? 'hover'
        : 'idle'

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    gestureRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    void invoke('overlay:orbDragBegin', {
      grabX: event.clientX,
      grabY: event.clientY
    }).catch(reportOrbError)
  }

  const finishDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean
  ): void => {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const moved = Math.hypot(
      event.screenX - gesture.screenX,
      event.screenY - gesture.screenY
    )
    void (async () => {
      try {
        await invoke('overlay:orbDragEnd', {})
      } finally {
        if (!cancelled && moved < CLICK_DISTANCE) {
          await invoke('overlay:togglePopup', {})
        }
      }
    })().catch(reportOrbError)
  }

  const activateFromKeyboard = (
    event: ReactMouseEvent<HTMLButtonElement>
  ): void => {
    if (event.detail !== 0) return
    void invoke('overlay:togglePopup', {}).catch(reportOrbError)
  }

  return (
    <button
      type="button"
      className="overlay-orb"
      aria-label="반달 AI"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={beginDrag}
      onPointerUp={(event) => finishDrag(event, false)}
      onPointerCancel={(event) => finishDrag(event, true)}
      onClick={activateFromKeyboard}
    >
      <BandalOrbMark size={48} state={markState} />
    </button>
  )
}
