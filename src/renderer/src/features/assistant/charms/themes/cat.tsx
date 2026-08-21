import type { CharmTheme } from '../types'
import { laggedRotation, part, setTransform, speedRamp } from './parts'

function Body(): JSX.Element {
  return (
    <>
      <g data-part="paws">
        <circle cx="-7" cy="0" r="3.5" fill="var(--accent)" />
        <circle cx="7" cy="0" r="3.5" fill="var(--accent)" />
        <path
          d="M-7 2 L-7 16 M7 2 L7 16"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <g data-part="tail">
        <path
          d="M6 24 q12 4 10 -10"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
      <g data-part="body">
        <rect x="-11" y="-4" width="22" height="30" rx="10" fill="var(--accent)" />
        <g data-part="ears">
          <path d="M-10 -2 L-11 -14 L-2 -6Z M10 -2 L11 -14 L2 -6Z" fill="var(--accent)" />
        </g>
        <circle cx="0" cy="2" r="11" fill="var(--accent)" />
        <circle cx="-4" cy="1" r="1.5" fill="var(--bg-app)" />
        <circle cx="4" cy="1" r="1.5" fill="var(--bg-app)" />
        <path
          d="M-3 6 q3 3 6 0"
          fill="none"
          stroke="var(--bg-app)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M-12 4 l-6 -1 M-12 6 l-6 1 M12 4 l6 -1 M12 6 l6 1"
          stroke="var(--text-secondary)"
          strokeWidth="0.8"
          opacity="0.7"
        />
      </g>
    </>
  )
}

export const catTheme: CharmTheme = {
  id: 'cat',
  anchor: 'below',
  attachInsetRatio: 0.12,
  rope: {
    segments: 2,
    segmentLength: 10,
    gravity: 1600,
    drag: 1.8,
    iterations: 4,
    tipMass: 3
  },
  ropeStyle: 'none',
  Character: Body,
  bindPose: (root) => {
    const tail = laggedRotation(part(root, 'tail'), {
      gain: 0.12, response: 6, limit: 0.7, cx: 6, cy: 24
    })
    const ears = part(root, 'ears')
    return (pose, dt) => {
      tail(pose, dt)
      const flatten = 1 - 0.6 * speedRamp(pose, 800)
      setTransform(ears, `translate(0 -2) scale(1 ${flatten.toFixed(3)}) translate(0 2)`)
    }
  },
  Preview: Body
}
