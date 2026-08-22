import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { BandalOrbMark, type BandalOrbState } from '../assistant/BandalOrbMark'
import { CharmLayer } from '../assistant/charms'
import { orbStateForActivity } from '../assistant/orbActivityState'
import { useAssistantActivity } from '../assistant/useAssistantActivity'
import { invoke } from '../../lib/ipc'
import { useOverlayState } from './useOverlayState'

interface OrbPointerGesture {
  pointerId: number
  screenX: number
  screenY: number
}

const CLICK_DISTANCE = 4

interface HitRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type OrbHitTestInvoke = (
  channel: 'overlay:setOrbHitTest',
  req: { hit: boolean }
) => Promise<{ ok: true }>

const invokeOrbHitTest = invoke as unknown as OrbHitTestInvoke

export function isOverlayOrbHit(
  point: { x: number; y: number },
  orb: HitRect | null,
  charm: HitRect | null
): boolean {
  if (orb !== null) {
    const radius = Math.min(orb.width, orb.height) / 2
    const dx = point.x - (orb.left + orb.width / 2)
    const dy = point.y - (orb.top + orb.height / 2)
    if (dx * dx + dy * dy <= radius * radius) return true
  }
  return (
    charm !== null &&
    charm.width > 0 &&
    charm.height > 0 &&
    point.x >= charm.left &&
    point.x <= charm.right &&
    point.y >= charm.top &&
    point.y <= charm.bottom
  )
}

export async function reportOverlayOrbHitTest(hit: boolean): Promise<void> {
  await invokeOrbHitTest('overlay:setOrbHitTest', { hit })
}

function reportOrbError(error: unknown): void {
  console.error('[Bandal] 데스크톱 오브 동작을 처리하지 못했습니다.', error)
}

export function OverlayOrbApp(): JSX.Element {
  const state = useOverlayState()
  const activity = useAssistantActivity({
    courseId: state.courseId,
    popupOpen: state.popupOpen
  })
  const [hovered, setHovered] = useState(false)
  const gestureRef = useRef<OrbPointerGesture | null>(null)
  const orbRef = useRef<HTMLButtonElement>(null)
  const lastHitRef = useRef<boolean | null>(null)

  const markState: BandalOrbState = orbStateForActivity(activity, hovered)

  useEffect(() => {
    const updateHitTest = (hit: boolean): void => {
      if (lastHitRef.current === hit) return
      lastHitRef.current = hit
      void reportOverlayOrbHitTest(hit).catch(reportOrbError)
    }
    const onMouseMove = (event: MouseEvent): void => {
      const charm = document.querySelector<SVGGraphicsElement>(
        '.assistant-charm__character'
      )
      updateHitTest(
        isOverlayOrbHit(
          { x: event.clientX, y: event.clientY },
          orbRef.current?.getBoundingClientRect() ?? null,
          charm?.getBoundingClientRect() ?? null
        )
      )
    }
    const onMouseLeave = (): void => updateHitTest(false)
    window.addEventListener('mousemove', onMouseMove)
    document.documentElement.addEventListener('mouseleave', onMouseLeave)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onMouseLeave)
      if (lastHitRef.current === true) {
        void reportOverlayOrbHitTest(false).catch(reportOrbError)
      }
    }
  }, [])

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
    <>
      <CharmLayer orbRef={orbRef} orbState={markState} />
      <button
        ref={orbRef}
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
        <BandalOrbMark state={markState} />
      </button>
    </>
  )
}
