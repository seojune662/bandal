import { useEffect, useRef, useState } from 'react'
import type { TourAnchorKey, TourAnchorRect } from './tourTypes'

const POLL_INTERVAL_MS = 150
const MISSING_TIMEOUT_MS = 4_000
const RAF_MEASURE_INTERVAL_MS = 100

function rectOf(element: HTMLElement): TourAnchorRect {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height
  }
}

function sameRect(
  current: TourAnchorRect | null,
  next: TourAnchorRect
): boolean {
  return (
    current !== null &&
    current.top === next.top &&
    current.right === next.right &&
    current.bottom === next.bottom &&
    current.left === next.left &&
    current.width === next.width &&
    current.height === next.height
  )
}

function outsideViewport(rect: TourAnchorRect): boolean {
  const horizontallyOutside =
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    (rect.width <= window.innerWidth &&
      (rect.left < 0 || rect.right > window.innerWidth))
  const verticallyOutside =
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight ||
    (rect.height <= window.innerHeight &&
      (rect.top < 0 || rect.bottom > window.innerHeight))
  return horizontallyOutside || verticallyOutside
}

function findRenderedAnchor(target: TourAnchorKey): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(
    `[data-tour="${target}"]`
  )
  if (element === null || element.getClientRects().length === 0) return null
  const styles = window.getComputedStyle(element)
  if (styles.display === 'none' || styles.visibility === 'hidden') return null
  return element
}

/**
 * Tracks a live `data-tour` anchor without ever trapping the tour on a UI
 * variant that does not render it. Missing anchors are polled briefly and
 * then advance through the supplied callback.
 */
export function useTourAnchor(
  target: TourAnchorKey | null,
  onMissingTimeout: () => void,
  fallbackTarget: TourAnchorKey | null = null
): TourAnchorRect | null {
  const [rect, setRect] = useState<TourAnchorRect | null>(null)
  const elementRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const missingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutCallbackRef = useRef(onMissingTimeout)

  useEffect(() => {
    timeoutCallbackRef.current = onMissingTimeout
  }, [onMissingTimeout])

  useEffect(() => {
    setRect(null)
    elementRef.current = null
    observerRef.current?.disconnect()
    observerRef.current = null

    if (target === null) return

    let disposed = false
    let measureFrame: number | null = null
    let loopFrame: number | null = null
    let lastLoopMeasure = 0
    let primaryMisses = 0

    const clearMissingTimer = (): void => {
      if (missingTimerRef.current === null) return
      clearTimeout(missingTimerRef.current)
      missingTimerRef.current = null
    }

    const startMissingTimer = (): void => {
      if (missingTimerRef.current !== null) return
      missingTimerRef.current = setTimeout(() => {
        missingTimerRef.current = null
        if (!disposed && elementRef.current === null) {
          timeoutCallbackRef.current()
        }
      }, MISSING_TIMEOUT_MS)
    }

    const measure = (): void => {
      const element = elementRef.current
      if (element === null || !element.isConnected) return
      let next = rectOf(element)
      if (outsideViewport(next)) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        next = rectOf(element)
      }
      setRect((current) => (sameRect(current, next) ? current : next))
    }

    const scheduleMeasure = (): void => {
      if (measureFrame !== null) return
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = null
        measure()
      })
    }

    const connect = (element: HTMLElement | null): void => {
      if (elementRef.current === element) return
      observerRef.current?.disconnect()
      observerRef.current = null
      elementRef.current = element

      if (element === null) {
        setRect(null)
        startMissingTimer()
        return
      }

      clearMissingTimer()
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(scheduleMeasure)
        observer.observe(element)
        if (document.body !== element) observer.observe(document.body)
        observerRef.current = observer
      }
      measure()
    }

    const findAnchor = (): void => {
      const primary = findRenderedAnchor(target)
      if (primary !== null) {
        primaryMisses = 0
        connect(primary)
        return
      }

      // Favorites can disappear while the selected course/rail is rendering.
      // Give that surface one polling interval before falling back to the rail.
      if (fallbackTarget !== null && primaryMisses === 0) {
        primaryMisses += 1
        connect(null)
        return
      }

      const fallback =
        fallbackTarget === null
          ? null
          : findRenderedAnchor(fallbackTarget)
      connect(fallback)
      if (fallback === null) startMissingTimer()
    }

    const loop = (now: number): void => {
      if (disposed) return
      if (now - lastLoopMeasure >= RAF_MEASURE_INTERVAL_MS) {
        lastLoopMeasure = now
        const element = elementRef.current
        if (element !== null && !element.isConnected) connect(null)
        else measure()
      }
      loopFrame = window.requestAnimationFrame(loop)
    }

    findAnchor()
    const pollTimer = window.setInterval(findAnchor, POLL_INTERVAL_MS)
    loopFrame = window.requestAnimationFrame(loop)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)

    return () => {
      disposed = true
      window.clearInterval(pollTimer)
      clearMissingTimer()
      observerRef.current?.disconnect()
      observerRef.current = null
      elementRef.current = null
      if (measureFrame !== null) window.cancelAnimationFrame(measureFrame)
      if (loopFrame !== null) window.cancelAnimationFrame(loopFrame)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
    }
  }, [fallbackTarget, target])

  return rect
}
