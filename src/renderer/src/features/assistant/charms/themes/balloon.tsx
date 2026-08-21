import type { CharmTheme } from '../types'
import { part, setTransform, speedRamp } from './parts'

function Body(): JSX.Element {
  return (
    <g data-part="body">
      <ellipse cx="0" cy="-22" rx="14" ry="17" fill="var(--danger)" />
      <path
        d="M-8 -32 q4 -4 9 -3"
        fill="none"
        stroke="var(--bg-overlay)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path d="M-2.5 -5 L2.5 -5 L0 -1Z" fill="var(--danger)" />
    </g>
  )
}

export const balloonTheme: CharmTheme = {
  id: 'balloon',
  anchor: 'above',
  attachInsetRatio: 0.04,
  rope: {
    segments: 6,
    segmentLength: 9,
    gravity: -900,
    drag: 2.2,
    iterations: 6,
    tipMass: 1.5
  },
  ropeStyle: 'string',
  Character: Body,
  bindPose: (root) => {
    const body = part(root, 'body')
    return (pose) => {
      // Air drag squashes the balloon a touch when it is yanked along.
      const squash = 1 - 0.08 * speedRamp(pose, 1200)
      setTransform(body, `scale(${(2 - squash).toFixed(3)} ${squash.toFixed(3)})`)
    }
  },
  Preview: Body
}
