import type { CharmTheme } from '../types'

function Body(): JSX.Element {
  return (
    <g data-part="body">
      <circle cx="0" cy="8" r="9" fill="var(--bg-raised)" stroke="var(--border-strong)" />
      <path d="M0 0 A8 8 0 0 1 0 16 A3 8 0 0 0 0 0Z" fill="var(--accent)" opacity="0.92" />
      <circle cx="0" cy="8" r="8" fill="none" stroke="var(--accent)" strokeWidth="0.9" opacity="0.5" />
    </g>
  )
}

export const bungeeTheme: CharmTheme = {
  id: 'bungee',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 8,
    segmentLength: 9,
    gravity: 1500,
    drag: 0.9,
    iterations: 5,
    tipMass: 3,
    stretch: 0.4
  },
  ropeStyle: 'thread',
  Character: Body,
  bindPose: () => () => {
    // The elastic rope is the whole act; the half-moon just rides it.
  },
  Preview: Body
}
