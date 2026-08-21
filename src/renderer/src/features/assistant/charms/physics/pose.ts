/**
 * Turns rope geometry into the few numbers a character needs: where its
 * hang point is, how far it has swung, and how fast it is swinging.
 */

import type { RopeState } from './rope'

export type CharmAnchor = 'below' | 'above'

export interface CharmPose {
  /** Hang point (rope tip), viewport px. */
  x: number
  y: number
  /** Tip link vs the hanging direction, radians. 0 = hanging straight. */
  angle: number
  /** Low-pass filtered d(angle)/dt, rad/s. */
  angularVelocity: number
  /** Tip speed, px/s. */
  speed: number
}

const ANGULAR_VELOCITY_SMOOTHING = 0.35

/** Wrap to (−π, π]. */
function wrapAngle(value: number): number {
  let a = value
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

export function computePose(
  state: RopeState,
  prev: CharmPose | null,
  dt: number,
  anchor: CharmAnchor
): CharmPose {
  const last = state.x.length - 1
  const x = state.x[last] ?? 0
  const y = state.y[last] ?? 0
  const dx = x - (state.x[last - 1] ?? 0)
  const dy = y - (state.y[last - 1] ?? 0)
  // atan2(dx, dy) measures against +y (hanging down); flip for 'above'.
  const raw = anchor === 'below' ? Math.atan2(dx, dy) : Math.atan2(dx, -dy)
  const angle = wrapAngle(raw)
  const vx = (x - (state.px[last] ?? 0)) / dt
  const vy = (y - (state.py[last] ?? 0)) / dt
  const speed = Math.hypot(vx, vy)
  const instantaneous = prev === null ? 0 : wrapAngle(angle - prev.angle) / dt
  const angularVelocity =
    prev === null
      ? 0
      : prev.angularVelocity +
        (instantaneous - prev.angularVelocity) * ANGULAR_VELOCITY_SMOOTHING
  return { x, y, angle, angularVelocity, speed }
}

/**
 * First-order lag towards `target`, clamped to ±limit. Limbs call this each
 * frame so they trail the body by a fraction of a second.
 */
export function lagAngle(
  target: number,
  current: number,
  dt: number,
  response: number,
  limit: number
): number {
  const clampedTarget = Math.max(-limit, Math.min(limit, target))
  const alpha = 1 - Math.exp(-response * dt)
  return current + (clampedTarget - current) * alpha
}
