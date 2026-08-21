import type { CharmTheme } from '../types'
import { laggedRotation, part } from './parts'

function Body(): JSX.Element {
  return (
    <>
      <g data-part="skirt">
        <path
          d="M-8 10 q-9 14 -12 26 q12 -5 20 0 q8 -5 20 0 q-3 -12 -12 -26Z"
          fill="var(--bg-raised)"
          stroke="var(--border-strong)"
        />
      </g>
      <g data-part="body">
        <circle cx="0" cy="4" r="10" fill="var(--bg-raised)" stroke="var(--border-strong)" />
        <path
          d="M-9 11 q9 5 18 0"
          fill="none"
          stroke="var(--danger)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M-4 2 q2 -3 4 0 M2 2 q2 -3 4 0"
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M-2 7 q2 2 4 0"
          fill="none"
          stroke="var(--danger)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
    </>
  )
}

export const teruTheme: CharmTheme = {
  id: 'teru',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 8,
    segmentLength: 7.5,
    gravity: 1000,
    drag: 1.4,
    iterations: 5,
    tipMass: 2
  },
  ropeStyle: 'thread',
  Character: Body,
  bindPose: (root) => {
    // Cloth trails opposite to the swing, pivoting at the neck.
    const skirt = laggedRotation(part(root, 'skirt'), {
      gain: 0.14, response: 5, limit: 0.6, cx: 0, cy: 10
    })
    return (pose, dt) => {
      skirt(pose, dt)
    }
  },
  Preview: Body
}
