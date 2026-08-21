import type { CharmTheme } from '../types'
import { laggedRotation, part, speedRamp, setTransform } from './parts'

const LEG = {
  fill: 'none',
  stroke: 'var(--text-primary)',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const
}

function Body(): JSX.Element {
  return (
    <>
      <g data-part="legs-back-l">
        <path d="M-3 6 q-9 -6 -14 -1" {...LEG} />
        <path d="M-3 9 q-10 1 -14 7" {...LEG} />
      </g>
      <g data-part="legs-back-r">
        <path d="M3 6 q9 -6 14 -1" {...LEG} />
        <path d="M3 9 q10 1 14 7" {...LEG} />
      </g>
      <g data-part="legs-front-l">
        <path d="M-3 4 q-8 -9 -12 -8" {...LEG} />
        <path d="M-3 11 q-8 6 -12 13" {...LEG} />
      </g>
      <g data-part="legs-front-r">
        <path d="M3 4 q8 -9 12 -8" {...LEG} />
        <path d="M3 11 q8 6 12 13" {...LEG} />
      </g>
      <g data-part="body">
        <ellipse cx="0" cy="14" rx="7" ry="8.5" fill="var(--danger)" />
        <circle cx="0" cy="4.5" r="5.5" fill="var(--accent)" />
        <circle cx="-2" cy="3.5" r="1.3" fill="var(--bg-overlay)" />
        <circle cx="2" cy="3.5" r="1.3" fill="var(--bg-overlay)" />
        <path
          d="M-3 11 L3 11 M-2.5 14 L2.5 14"
          stroke="var(--bg-overlay)"
          strokeWidth="1"
          opacity="0.6"
        />
      </g>
    </>
  )
}

export const spiderTheme: CharmTheme = {
  id: 'spider',
  anchor: 'below',
  attachInsetRatio: 0.04,
  rope: {
    segments: 10,
    segmentLength: 8,
    gravity: 1400,
    drag: 1.1,
    iterations: 6,
    tipMass: 2.5
  },
  ropeStyle: 'thread',
  Character: Body,
  bindPose: (root) => {
    const backL = laggedRotation(part(root, 'legs-back-l'), {
      gain: 0.05, response: 12, limit: 0.5, cx: -3, cy: 7
    })
    const backR = laggedRotation(part(root, 'legs-back-r'), {
      gain: 0.05, response: 12, limit: 0.5, cx: 3, cy: 7
    })
    const frontL = part(root, 'legs-front-l')
    const frontR = part(root, 'legs-front-r')
    return (pose, dt) => {
      backL(pose, dt)
      backR(pose, dt)
      // Fast swing → legs tuck toward the body (scale about the shoulder).
      const tuck = 1 - 0.35 * speedRamp(pose, 900)
      setTransform(frontL, `translate(-3 7) scale(${tuck.toFixed(3)}) translate(3 -7)`)
      setTransform(frontR, `translate(3 7) scale(${tuck.toFixed(3)}) translate(-3 -7)`)
    }
  },
  Preview: Body
}
