import type { CharmTheme } from '../types'

function Body(): JSX.Element {
  return (
    <g data-part="charm">
      <circle cx="0" cy="6" r="6" fill="none" stroke="var(--border-strong)" strokeWidth="1.8" />
      <path d="M0 12 A8 8 0 0 1 0 28 A3.5 8 0 0 0 0 12Z" fill="var(--accent)" />
      <circle cx="0" cy="20" r="8" fill="none" stroke="var(--accent)" strokeWidth="0.9" opacity="0.5" />
    </g>
  )
}

export const chainTheme: CharmTheme = {
  id: 'chain',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 12,
    segmentLength: 7,
    gravity: 1800,
    drag: 1.6,
    iterations: 6,
    tipMass: 4
  },
  ropeStyle: 'chain',
  Character: Body,
  bindPose: () => () => {
    // Pure physics: the links and the tip transform are written by the layer.
  },
  Preview: Body
}
