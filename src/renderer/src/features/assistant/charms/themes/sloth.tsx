import type { CharmTheme } from '../types'
import { laggedRotation, part } from './parts'

function Body(): JSX.Element {
  return (
    <>
      <g data-part="arms">
        <path
          d="M-6 -28 q-2 14 -4 26 M6 -28 q2 14 4 26"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M-8 -30 l-3 4 M-6 -31 l-1 4 M8 -30 l3 4 M6 -31 l1 4"
          stroke="var(--text-secondary)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
      <g data-part="body">
        <ellipse cx="0" cy="10" rx="14" ry="16" fill="var(--text-secondary)" />
        <ellipse cx="0" cy="0" rx="11" ry="10" fill="var(--bg-raised)" stroke="var(--border-strong)" />
        <path
          d="M-7 -2 q3 -5 5 0 M2 -2 q3 -5 5 0"
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        />
        <circle cx="-4" cy="-1" r="1.3" fill="var(--text-primary)" />
        <circle cx="4" cy="-1" r="1.3" fill="var(--text-primary)" />
        <ellipse cx="0" cy="4" rx="2" ry="1.3" fill="var(--text-primary)" />
        <path
          d="M-4 7 q4 3 8 0"
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
    </>
  )
}

export const slothTheme: CharmTheme = {
  id: 'sloth',
  anchor: 'below',
  attachInsetRatio: 0.1,
  rope: {
    segments: 3,
    segmentLength: 10,
    gravity: 700,
    drag: 3,
    iterations: 4,
    tipMass: 3
  },
  ropeStyle: 'none',
  Character: Body,
  bindPose: (root) => {
    // The whole body lags behind the arms — everything about a sloth is late.
    const body = laggedRotation(part(root, 'body'), {
      gain: 0.2, response: 2.5, limit: 0.5, cx: 0, cy: -6
    })
    return (pose, dt) => {
      body(pose, dt)
    }
  },
  Preview: Body
}
