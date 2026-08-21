/**
 * Shared helpers for theme `bindPose` closures. Everything here mutates SVG
 * attributes only — no layout properties, no React.
 */

import { lagAngle } from '../physics/pose'
import type { CharmPose } from '../physics/pose'

const RAD_TO_DEG = 180 / Math.PI

/** Looks a `data-part` child up once; missing parts become no-op targets. */
export function part(root: SVGGElement, name: string): SVGGraphicsElement | null {
  return root.querySelector<SVGGraphicsElement>(`[data-part="${name}"]`)
}

export function setRotate(
  element: SVGGraphicsElement | null,
  radians: number,
  cx = 0,
  cy = 0
): void {
  element?.setAttribute(
    'transform',
    `rotate(${(radians * RAD_TO_DEG).toFixed(2)} ${cx} ${cy})`
  )
}

export function setTransform(
  element: SVGGraphicsElement | null,
  value: string
): void {
  element?.setAttribute('transform', value)
}

export interface LaggedPartOptions {
  /** Multiplies `angularVelocity` (rad/s) into a target angle (rad). */
  gain: number
  /** Adds this multiple of the body angle so the part also hangs with it. */
  followAngle?: number
  /** Responsiveness, 1/s — lower trails longer. */
  response: number
  /** Clamp, rad. */
  limit: number
  /** Pivot for the rotation, in the part's own coordinates. */
  cx?: number
  cy?: number
}

/**
 * A part whose angle chases the body's angular velocity with a lag. Returns
 * a per-frame updater; call it with the pose and dt.
 */
export function laggedRotation(
  element: SVGGraphicsElement | null,
  options: LaggedPartOptions
): (pose: CharmPose, dt: number) => number {
  let current = 0
  return (pose, dt) => {
    const target =
      -pose.angularVelocity * options.gain +
      pose.angle * (options.followAngle ?? 0)
    current = lagAngle(target, current, dt, options.response, options.limit)
    setRotate(element, current, options.cx, options.cy)
    return current
  }
}

/** 0..1 ramp of tip speed, for squash / tuck effects. */
export function speedRamp(pose: CharmPose, fullAt: number): number {
  return Math.min(1, pose.speed / fullAt)
}
