import type { CharmTheme } from '../types'
import { laggedRotation, part } from './parts'

function Body(): JSX.Element {
  return (
    <g data-part="body">
      <rect x="-5" y="0" width="10" height="3" fill="var(--text-secondary)" />
      <ellipse data-part="glow" cx="0" cy="15" rx="15" ry="16" fill="var(--accent)" opacity="0" />
      <ellipse cx="0" cy="15" rx="12" ry="13" fill="var(--accent)" opacity="0.9" />
      <ellipse cx="0" cy="15" rx="12" ry="13" fill="none" stroke="var(--bg-app)" strokeWidth="0.8" opacity="0.5" />
      <path
        d="M-4 2 q-12 13 0 26 M4 2 q12 13 0 26"
        fill="none"
        stroke="var(--bg-app)"
        strokeWidth="0.8"
        opacity="0.45"
      />
      <rect x="-5" y="27" width="10" height="3" fill="var(--text-secondary)" />
      <g data-part="tassel">
        <path d="M0 30 L0 40" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M-2 38 L-3 46 M0 39 L0 47 M2 38 L3 46"
          stroke="var(--danger)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
    </g>
  )
}

export const lanternTheme: CharmTheme = {
  id: 'lantern',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 6,
    segmentLength: 8,
    gravity: 1200,
    drag: 1.4,
    iterations: 5,
    tipMass: 4
  },
  ropeStyle: 'string',
  Character: Body,
  bindPose: (root) => {
    const tassel = laggedRotation(part(root, 'tassel'), {
      gain: 0.1, response: 7, limit: 0.8, cx: 0, cy: 30
    })
    return (pose, dt) => {
      tassel(pose, dt)
    }
  },
  Preview: Body
}
