import type { CharmTheme, RopeConfig } from '../types'
import { part, setRotate } from './parts'

const REST_SEGMENT = 3
const DROPPED_SEGMENT = 11
/** Tip speed at which the string is fully let out. */
const DROP_SPEED = 700
/** How fast the string winds back in, 1/s. */
const WIND_RESPONSE = 2.5
const LET_OUT_RESPONSE = 9

function Body(): JSX.Element {
  return (
    <g data-part="disc">
      <circle cx="0" cy="7" r="8" fill="var(--danger)" />
      <circle cx="0" cy="7" r="8" fill="none" stroke="var(--bg-app)" strokeWidth="0.8" opacity="0.5" />
      <circle cx="0" cy="7" r="3.2" fill="var(--bg-overlay)" />
      <path d="M0 1.5 L0 4.5" stroke="var(--bg-overlay)" strokeWidth="1" strokeLinecap="round" />
    </g>
  )
}

export const yoyoTheme: CharmTheme = {
  id: 'yoyo',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 6,
    segmentLength: REST_SEGMENT,
    gravity: 1500,
    drag: 1.2,
    iterations: 5,
    tipMass: 3
  },
  ropeStyle: 'thread',
  // Fast moves let the string out; it winds back once things calm down.
  adjustRope: (config: RopeConfig, pose, dt): RopeConfig => {
    const speed = pose?.speed ?? 0
    const target =
      REST_SEGMENT +
      (DROPPED_SEGMENT - REST_SEGMENT) * Math.min(1, speed / DROP_SPEED)
    const response =
      target > config.segmentLength ? LET_OUT_RESPONSE : WIND_RESPONSE
    const alpha = 1 - Math.exp(-response * dt)
    const next = config.segmentLength + (target - config.segmentLength) * alpha
    if (Math.abs(next - config.segmentLength) < 1e-4) return config
    return { ...config, segmentLength: next }
  },
  Character: Body,
  bindPose: (root) => {
    const disc = part(root, 'disc')
    let spin = 0
    return (pose, dt) => {
      // Spins faster while the string is running out.
      spin += pose.speed * dt * 0.08
      setRotate(disc, spin, 0, 7)
    }
  },
  Preview: Body
}
