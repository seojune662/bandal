import { useEffect } from 'react'
import type { RefObject } from 'react'
import { CharmEngine } from './charmEngine'
import type { CharmSink, SubRopeFrame } from './charmEngine'
import type {
  CharmAnchor,
  CharmPose,
  CharmTheme,
  RopeState,
  RopeStyle,
  Vec2
} from './types'

const RAD_TO_DEG = 180 / Math.PI
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export interface CharmTargets {
  rope: RefObject<SVGGraphicsElement>
  character: RefObject<SVGGElement>
  /** One <g> per sub rope: first child = polyline, second = piece <g>. */
  subRopes: RefObject<SVGGElement>
}

function readPivot(orb: HTMLElement | null, theme: CharmTheme): Vec2 | null {
  if (orb === null) return null
  const rect = orb.getBoundingClientRect()
  if (rect.width === 0) return null
  const inset = rect.width * theme.attachInsetRatio
  return {
    x: rect.left + rect.width / 2,
    y: theme.anchor === 'below' ? rect.bottom - inset : rect.top + inset
  }
}

function writeRope(
  element: SVGGraphicsElement | null,
  style: RopeStyle,
  state: RopeState
): void {
  if (element === null || style === 'none') return
  if (style === 'chain') {
    const links = element.children
    for (let i = 1; i < state.x.length; i += 1) {
      const link = links[i - 1]
      if (link === undefined) break
      const x0 = state.x[i - 1] ?? 0
      const y0 = state.y[i - 1] ?? 0
      const x1 = state.x[i] ?? 0
      const y1 = state.y[i] ?? 0
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      const deg = Math.atan2(x1 - x0, y1 - y0) * -RAD_TO_DEG
      link.setAttribute(
        'transform',
        `translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${deg.toFixed(2)})`
      )
    }
    return
  }
  let points = ''
  for (let i = 0; i < state.x.length; i += 1) {
    points += `${(state.x[i] ?? 0).toFixed(2)},${(state.y[i] ?? 0).toFixed(2)} `
  }
  element.setAttribute('points', points)
}

function poseTransform(anchor: CharmAnchor, pose: CharmPose): string {
  const rotation = (anchor === 'below' ? pose.angle : -pose.angle) * RAD_TO_DEG
  return `translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)}) rotate(${rotation.toFixed(2)})`
}

function writeSubRopes(
  container: SVGGElement | null,
  theme: CharmTheme,
  frames: readonly SubRopeFrame[]
): void {
  const subs = theme.subRopes
  if (container === null || subs === undefined) return
  frames.forEach((frame, i) => {
    const group = container.children[i]
    if (group === undefined) return
    const rope = group.children[0]
    const piece = group.children[1]
    if (rope instanceof SVGGraphicsElement) writeRope(rope, subs.ropeStyle, frame.state)
    piece?.setAttribute('transform', poseTransform('below', frame.pose))
  })
}

/**
 * Runs one CharmEngine against the mounted SVG. The engine is woken by the
 * orb's inline-style mutations (React rewrites `transform` on every move),
 * by viewport resizes, and by the tab becoming visible again.
 */
export function useCharmEngine(
  theme: CharmTheme,
  orbRef: RefObject<HTMLElement>,
  targets: CharmTargets
): void {
  useEffect(() => {
    const orb = orbRef.current
    const character = targets.character.current
    if (orb === null || character === null) return
    const updatePose = theme.bindPose(character)
    const sink: CharmSink = {
      readPivot: () => readPivot(orbRef.current, theme),
      writeFrame: (state, pose, dt, subRopes) => {
        writeRope(targets.rope.current, theme.ropeStyle, state)
        character.setAttribute('transform', poseTransform(theme.anchor, pose))
        writeSubRopes(targets.subRopes.current, theme, subRopes)
        updatePose(pose, dt)
      }
    }
    const engine = new CharmEngine(theme, sink)
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    engine.setReducedMotion(media.matches)

    const wake = (): void => engine.wake()
    const observer = new MutationObserver(wake)
    observer.observe(orb, { attributes: true, attributeFilter: ['style'] })
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') engine.pause()
      else engine.wake()
    }
    const onMedia = (event: MediaQueryListEvent): void => {
      engine.setReducedMotion(event.matches)
      engine.wake()
    }
    window.addEventListener('resize', wake)
    document.addEventListener('visibilitychange', onVisibility)
    media.addEventListener('change', onMedia)
    engine.wake()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', wake)
      document.removeEventListener('visibilitychange', onVisibility)
      media.removeEventListener('change', onMedia)
      engine.dispose()
    }
  }, [theme, orbRef, targets.rope, targets.character, targets.subRopes])
}
