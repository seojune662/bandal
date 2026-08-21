import type { CharmTheme } from '../types'

const TUBE_COUNT = 5
const TUBE_SPACING = 7
const TUBE_LENGTHS = [14, 20, 26, 20, 14]

function Bar(): JSX.Element {
  return (
    <g data-part="bar">
      <path
        d="M-16 4 L16 4"
        stroke="var(--text-secondary)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M0 0 L-14 4 M0 0 L14 4"
        stroke="var(--text-secondary)"
        strokeWidth="1"
        opacity="0.6"
      />
    </g>
  )
}

function Tube({ index }: { index: number }): JSX.Element {
  const length = TUBE_LENGTHS[index] ?? 16
  return (
    <g>
      <rect x="-1.8" y="0" width="3.6" height={length} rx="1.8" fill="var(--accent)" opacity="0.9" />
      <path
        d={`M-0.6 2 L-0.6 ${length - 2}`}
        stroke="var(--bg-overlay)"
        strokeWidth="0.6"
        opacity="0.5"
      />
    </g>
  )
}

function Preview(): JSX.Element {
  return (
    <>
      <Bar />
      {TUBE_LENGTHS.map((length, i) => (
        <g key={i} transform={`translate(${(i - 2) * TUBE_SPACING} 4)`}>
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="10"
            stroke="var(--text-secondary)"
            strokeWidth="1"
            opacity="0.6"
          />
          <rect x="-1.8" y="10" width="3.6" height={length} rx="1.8" fill="var(--accent)" opacity="0.9" />
        </g>
      ))}
    </>
  )
}

export const windchimeTheme: CharmTheme = {
  id: 'windchime',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 5,
    segmentLength: 8,
    gravity: 1600,
    drag: 1.6,
    iterations: 6,
    tipMass: 5
  },
  ropeStyle: 'thread',
  subRopes: {
    count: TUBE_COUNT,
    config: {
      segments: 2,
      segmentLength: 5,
      gravity: 1400,
      drag: 0.8,
      iterations: 4,
      tipMass: 1.5
    },
    offset: (index) => ({ x: (index - 2) * TUBE_SPACING, y: 4 }),
    ropeStyle: 'thread',
    Piece: Tube
  },
  Character: Bar,
  bindPose: () => () => {
    // Tubes are driven by their own ropes; the bar just rides the main one.
  },
  Preview
}
