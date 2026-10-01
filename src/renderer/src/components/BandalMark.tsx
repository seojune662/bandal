import { useEffect, useRef } from 'react'
import { MOON_SHAPES, MOON_VIEWBOX, MOON_LOOP_MS, MOON_INTRO_MS, moonPose, moonTransform } from '../../../shared/brandMark'

interface BandalMarkProps {
  size?: number
  className?: string
  title?: string
  motion?: 'idle' | 'loop' | 'intro'
}

/** Both moons rotate around their own fixed centres along the approved path. */
export function BandalMark({ size = 18, className, title, motion = size >= 48 ? 'intro' : 'idle' }: BandalMarkProps): JSX.Element {
  const svg = useRef<SVGSVGElement>(null)
  const desired = useRef(motion)
  const wake = useRef<() => void>(() => {})
  desired.current = motion
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const paths = element.querySelectorAll('path')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, elapsed = 0, last = 0, inView = true, finishedIntro = false
    const paint = (progress: number): void => { const pose = moonPose(progress); paths.forEach((path, i) => path.setAttribute('transform', moonTransform(i, pose[i]))) }
    const tick = (now: number): void => {
      frame = 0
      if (document.hidden || !inView || reduced.matches) { last = 0; return }
      if (last) elapsed += Math.min(now - last, 100)
      last = now
      const intro = desired.current === 'intro' && !finishedIntro
      const duration = intro ? MOON_INTRO_MS : MOON_LOOP_MS
      if (elapsed >= duration && (intro || desired.current === 'idle')) {
        paint(0); elapsed = 0; last = 0; finishedIntro = intro || finishedIntro; return
      }
      if (desired.current === 'loop') elapsed %= duration
      let t = (elapsed % duration) / duration
      if (intro) t = t * t * t * (t * (t * 6 - 15) + 10)
      paint(t)
      if (desired.current === 'loop' || elapsed > 0 || intro) frame = requestAnimationFrame(tick)
    }
    const start = (): void => {
      if (reduced.matches) { cancelAnimationFrame(frame); frame = 0; elapsed = 0; last = 0; paint(0); return }
      if (!frame && !document.hidden && inView && (elapsed > 0 || desired.current === 'loop' || (desired.current === 'intro' && !finishedIntro))) frame = requestAnimationFrame(tick)
    }
    wake.current = start
    const visibility = (): void => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; last = 0 } else start() }
    const observer = new IntersectionObserver(([entry]) => { inView = entry?.isIntersecting ?? false; if (!inView) { cancelAnimationFrame(frame); frame = 0; last = 0 } else start() })
    observer.observe(element)
    document.addEventListener('visibilitychange', visibility)
    reduced.addEventListener('change', start)
    start()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', start); wake.current = () => {} }
  }, [])
  useEffect(() => { wake.current() }, [motion])
  return <svg ref={svg} width={size} height={size} viewBox={MOON_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} focusable="false" fill="currentColor">
    {title && <title>{title}</title>}
    {MOON_SHAPES.map((shape, i) => <path key={shape.name} d={shape.path} transform={moonTransform(i)} />)}
  </svg>
}
